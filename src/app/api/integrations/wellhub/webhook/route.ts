import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { processWellhubCheckin } from "@/lib/wellhub/checkin";
import { processWellhubBookingEvent } from "@/lib/wellhub/booking/service";
import {
  getWellhubBookingConfig,
  getWellhubConfig,
  getWellhubFeatureFlags,
  WellhubConfigError,
} from "@/lib/wellhub/config";
import { parseWellhubEvent } from "@/lib/wellhub/parser";
import {
  verifyWellhubSignature,
  WELLHUB_SIGNATURE_HEADER,
} from "@/lib/wellhub/signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_WEBHOOK_BODY_BYTES = 64 * 1024;

function logReference(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 12);
}

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function readRawBodyLimited(req: Request) {
  const declared = req.headers.get("content-length");
  if (declared) {
    const declaredBytes = Number(declared);
    if (
      Number.isFinite(declaredBytes) &&
      declaredBytes > MAX_WEBHOOK_BODY_BYTES
    ) {
      return { ok: false as const };
    }
  }

  if (!req.body) {
    return { ok: true as const, bytes: Buffer.alloc(0) };
  }

  const reader = req.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_WEBHOOK_BODY_BYTES) {
      await reader.cancel();
      return { ok: false as const };
    }
    chunks.push(Buffer.from(value));
  }

  return { ok: true as const, bytes: Buffer.concat(chunks, total) };
}

export async function POST(req: Request) {
  const startedAt = Date.now();

  try {
    let flags;
    try {
      flags = getWellhubFeatureFlags();
    } catch (error) {
      const code =
        error instanceof WellhubConfigError
          ? error.code
          : "WELLHUB_CONFIG_ERROR";
      console.error("WELLHUB_WEBHOOK_CONFIG_ERROR", { code });
      // An immediate provider retry cannot repair missing or invalid operator
      // configuration. Acknowledge the delivery and rely on preflight/logging
      // so a bad deployment does not create a webhook retry storm.
      return json(200, { ok: true, result: "NOT_CONFIGURED" });
    }

    if (!flags.checkin && !flags.booking) {
      return json(200, { ok: true, result: "DISABLED" });
    }

    let checkinConfig: ReturnType<typeof getWellhubConfig> | null = null;
    let bookingConfig: ReturnType<typeof getWellhubBookingConfig> | null = null;

    if (flags.checkin) {
      try {
        checkinConfig = getWellhubConfig();
      } catch (error) {
        console.error("WELLHUB_CHECKIN_CONFIG_ERROR", {
          code:
            error instanceof WellhubConfigError
              ? error.code
              : "WELLHUB_CONFIG_ERROR",
        });
      }
    }
    if (flags.booking) {
      try {
        bookingConfig = getWellhubBookingConfig();
      } catch (error) {
        console.error("WELLHUB_BOOKING_CONFIG_ERROR", {
          code:
            error instanceof WellhubConfigError
              ? error.code
              : "WELLHUB_CONFIG_ERROR",
        });
      }
    }

    const signatureConfig =
      (checkinConfig?.enabled ? checkinConfig : null) ??
      (bookingConfig?.enabled ? bookingConfig : null);
    if (!signatureConfig) {
      return json(200, { ok: true, result: "NOT_CONFIGURED" });
    }

    const body = await readRawBodyLimited(req);
    if (!body.ok) {
      console.warn("WELLHUB_WEBHOOK_BODY_TOO_LARGE", {
        maxBytes: MAX_WEBHOOK_BODY_BYTES,
      });
      return json(413, { error: "PAYLOAD_TOO_LARGE" });
    }

    const signature = verifyWellhubSignature({
      rawBody: body.bytes,
      signature: req.headers.get(WELLHUB_SIGNATURE_HEADER),
      secret: signatureConfig.webhookSecret,
    });
    if (!signature.ok) {
      console.warn("WELLHUB_WEBHOOK_INVALID_SIGNATURE", {
        reason: signature.reason,
        hasSignature: req.headers.has(WELLHUB_SIGNATURE_HEADER),
        bodyBytes: body.bytes.byteLength,
      });
      return json(401, { error: "INVALID_SIGNATURE" });
    }

    const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.startsWith("application/json")) {
      return json(415, { error: "UNSUPPORTED_MEDIA_TYPE" });
    }

    const parsed = parseWellhubEvent(body.bytes.toString("utf8"));
    if (!parsed.ok) {
      console.warn("WELLHUB_WEBHOOK_MALFORMED_EVENT", { code: parsed.code });
      return json(400, { error: parsed.code });
    }

    if (parsed.kind === "unsupported") {
      console.info("WELLHUB_WEBHOOK_UNSUPPORTED_EVENT", {
        eventType: parsed.eventType,
      });
      return json(200, { ok: true, result: "UNSUPPORTED_EVENT" });
    }


    if (parsed.kind === "booking") {
      if (!bookingConfig?.enabled) {
        console.info("WELLHUB_BOOKING_WEBHOOK_DISABLED", {
          eventType: parsed.event.eventType,
        });
        return json(200, { ok: true, result: "BOOKING_DISABLED" });
      }

      const result = await processWellhubBookingEvent(
        parsed.event,
        bookingConfig
      );
      const logContext = {
        eventType: parsed.event.eventType,
        externalEventHash: logReference(parsed.event.externalEventId),
        bookingReferenceHash: logReference(parsed.event.bookingNumber),
        waveClassId: "classId" in result ? result.classId : undefined,
        result: result.kind,
        latencyMs: Date.now() - startedAt,
      };

      if (result.kind === "error") {
        console.error("WELLHUB_BOOKING_WEBHOOK_ERROR", {
          ...logContext,
          code: result.code,
          retryable: result.retryable,
        });
        return result.retryable
          ? json(503, { ok: false, result: "ERROR", retryable: true })
          : json(200, { ok: true, result: "ERROR", retryable: false });
      }

      console.info("WELLHUB_BOOKING_WEBHOOK_PROCESSED", logContext);
      if (result.kind === "duplicate") {
        if (result.status === "PROCESSING") {
          return json(503, {
            ok: false,
            result: "PROCESSING",
            retryable: true,
          });
        }
        return json(200, {
          ok: true,
          duplicate: true,
          result: result.status,
        });
      }
      if (result.kind === "accepted") {
        return json(200, { ok: true, result: "RESERVED" });
      }
      if (result.kind === "rejected") {
        return json(200, { ok: true, result: "REJECTED", code: result.code });
      }
      return json(200, {
        ok: true,
        result: result.late ? "LATE_CANCELED" : "CANCELED",
      });
    }

    if (!checkinConfig?.enabled) {
      return json(200, { ok: true, result: "CHECKIN_DISABLED" });
    }

    const result = await processWellhubCheckin(parsed.event, checkinConfig);
    const logContext = {
      eventType: parsed.event.eventType,
      externalEventId: parsed.event.externalEventId.slice(0, 16),
      externalGymId: parsed.event.externalGymId,
      externalProductId: parsed.event.externalProductId,
      matchedUserId: result.matchedUserId,
      result: result.kind,
      latencyMs: Date.now() - startedAt,
    };

    if (result.kind === "duplicate") {
      console.info("WELLHUB_WEBHOOK_DUPLICATE", {
        ...logContext,
        status: result.status,
      });
      return json(200, {
        ok: true,
        duplicate: true,
        result: result.status,
      });
    }

    if (result.kind === "authorized") {
      console.info("WELLHUB_WEBHOOK_PROCESSED", logContext);
      return json(200, { ok: true, result: "AUTHORIZED" });
    }

    if (result.kind === "rejected") {
      console.info("WELLHUB_WEBHOOK_PROCESSED", logContext);
      return json(200, { ok: true, result: "REJECTED" });
    }

    console.error("WELLHUB_WEBHOOK_VALIDATION_ERROR", {
      ...logContext,
      code: result.code,
      retryable: result.retryable,
    });

    // Retryable integration failures remain auditable in ERROR and return a
    // temporary failure. Configuration/auth failures are acknowledged to avoid
    // an immediate retry storm that cannot recover without operator action.
    return result.retryable
      ? json(503, { ok: false, result: "ERROR", retryable: true })
      : json(200, { ok: true, result: "ERROR", retryable: false });
  } catch (error) {
    console.error("WELLHUB_WEBHOOK_FATAL", {
      error: error instanceof Error ? error.name : "UNKNOWN_ERROR",
      latencyMs: Date.now() - startedAt,
    });
    return json(503, { error: "INTERNAL_ERROR" });
  }
}
