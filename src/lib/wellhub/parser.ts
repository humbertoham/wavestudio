import { createHash } from "node:crypto";

import { z } from "zod";

const externalInteger = z
  .union([
    z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    z.string().regex(/^[1-9]\d{0,19}$/),
  ])
  .transform((value) => String(value));

const checkinSchema = z
  .object({
    event_type: z.literal("checkin"),
    event_data: z.object({
      user: z.object({
        unique_token: z.string().regex(/^\d{13}$/),
        first_name: z.string().trim().min(1).max(200).optional(),
        last_name: z.string().trim().min(1).max(200).optional(),
        email: z.string().trim().email().max(320).optional(),
        phone_number: z.string().trim().min(1).max(40).optional(),
      }),
      location: z
        .object({
          lat: z.number().finite(),
          lon: z.number().finite(),
        })
        .optional(),
      gym: z.object({
        id: externalInteger,
        title: z.string().max(300).optional(),
        product: z.object({
          id: externalInteger,
          description: z.string().max(500).optional(),
        }),
      }),
      timestamp: externalInteger,
    }),
  })
  .passthrough();

export type WellhubCheckinEvent = {
  eventType: "checkin";
  externalEventId: string;
  externalUserId: string;
  externalGymId: string;
  externalProductId: string;
  eventTimestamp: string;
  email?: string;
};

export type WellhubEventParseResult =
  | { ok: true; kind: "checkin"; event: WellhubCheckinEvent }
  | { ok: true; kind: "unsupported"; eventType: string }
  | {
      ok: false;
      code: "INVALID_JSON" | "INVALID_EVENT_ENVELOPE" | "INVALID_CHECKIN_EVENT";
    };

function eventIdFor(fields: readonly string[]) {
  return createHash("sha256")
    .update(JSON.stringify(fields), "utf8")
    .digest("hex");
}

export function parseWellhubEvent(rawBody: string): WellhubEventParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { ok: false, code: "INVALID_JSON" };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, code: "INVALID_EVENT_ENVELOPE" };
  }

  const eventType = (parsed as { event_type?: unknown }).event_type;
  if (typeof eventType !== "string" || !eventType.trim() || eventType.length > 100) {
    return { ok: false, code: "INVALID_EVENT_ENVELOPE" };
  }

  if (eventType !== "checkin") {
    return { ok: true, kind: "unsupported", eventType };
  }

  const result = checkinSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, code: "INVALID_CHECKIN_EVENT" };
  }

  const data = result.data.event_data;
  const externalUserId = data.user.unique_token;
  const externalGymId = data.gym.id;
  const externalProductId = data.gym.product.id;
  const eventTimestamp = data.timestamp;

  return {
    ok: true,
    kind: "checkin",
    event: {
      eventType: "checkin",
      externalEventId: eventIdFor([
        "wellhub",
        "checkin",
        externalUserId,
        externalGymId,
        externalProductId,
        eventTimestamp,
      ]),
      externalUserId,
      externalGymId,
      externalProductId,
      eventTimestamp,
      ...(data.user.email
        ? { email: data.user.email.trim().toLowerCase() }
        : {}),
    },
  };
}
