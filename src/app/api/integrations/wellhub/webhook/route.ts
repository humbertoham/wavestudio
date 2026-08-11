import { NextResponse } from "next/server";

import { processWellhubCheckin } from "@/lib/wellhub/checkin";
import {
  getWellhubConfig,
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
    let config;
    try {
      config = getWellhubConfig();
    } catch (error) {
      const code =
        error instanceof WellhubConfigError
          ? error.code
          : "WELLHUB_CONFIG_ERROR";
      console.error("WELLHUB_WEBHOOK_CONFIG_ERROR", { code });
      return json(503, { error: "WELLHUB_NOT_CONFIGURED" });
    }

    if (!config.enabled) {
      return json(503, { error: "WELLHUB_CHECKIN_DISABLED" });
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
      secret: config.webhookSecret,
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

    const result = await processWellhubCheckin(parsed.event, config);
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
