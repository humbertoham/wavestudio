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

const bookingIdentifier = z
  .union([
    z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    z.string().regex(/^\d{1,30}$/),
  ])
  .transform((value) => String(value));

const bookingNumber = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9_-]+$/);
const eventId = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9_-]+$/);
const bookingEventType = z.enum([
  "booking-requested",
  "booking-canceled",
  "booking-late-canceled",
]);

const bookingSchema = z
  .object({
    event_type: bookingEventType,
    event_data: z.object({
      user: z
        .object({
          unique_token: z.string().regex(/^\d{1,20}$/),
          name: z.string().trim().min(1).max(200).optional(),
          email: z.string().trim().email().max(320).optional(),
        })
        .passthrough(),
      slot: z.object({
        id: bookingIdentifier,
        gym_id: bookingIdentifier,
        class_id: bookingIdentifier,
        booking_number: bookingNumber,
      }),
      timestamp: z
        .union([
          z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
          z.string().regex(/^\d{1,20}$/),
        ])
        .transform((value) => String(value)),
      event_id: eventId,
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

export type WellhubBookingEvent = {
  eventType:
    | "booking-requested"
    | "booking-canceled"
    | "booking-late-canceled";
  eventKind: "REQUESTED" | "CANCELED" | "LATE_CANCELED";
  externalEventId: string;
  externalUserId: string;
  externalGymId: string;
  externalClassId: string;
  externalSlotId: string;
  bookingNumber: string;
  eventTimestamp: string;
  displayName?: string;
  email?: string;
};

export type WellhubEventParseResult =
  | { ok: true; kind: "checkin"; event: WellhubCheckinEvent }
  | { ok: true; kind: "booking"; event: WellhubBookingEvent }
  | { ok: true; kind: "unsupported"; eventType: string }
  | {
      ok: false;
      code:
        | "INVALID_JSON"
        | "INVALID_EVENT_ENVELOPE"
        | "INVALID_CHECKIN_EVENT"
        | "INVALID_BOOKING_EVENT";
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
  if (
    typeof eventType !== "string" ||
    !eventType.trim() ||
    eventType.length > 100
  ) {
    return { ok: false, code: "INVALID_EVENT_ENVELOPE" };
  }

  if (
    eventType === "booking-requested" ||
    eventType === "booking-canceled" ||
    eventType === "booking-late-canceled"
  ) {
    const result = bookingSchema.safeParse(parsed);
    if (!result.success) {
      return { ok: false, code: "INVALID_BOOKING_EVENT" };
    }

    const data = result.data.event_data;
    const eventKind =
      result.data.event_type === "booking-requested"
        ? "REQUESTED"
        : result.data.event_type === "booking-canceled"
          ? "CANCELED"
          : "LATE_CANCELED";

    return {
      ok: true,
      kind: "booking",
      event: {
        eventType: result.data.event_type,
        eventKind,
        externalEventId: data.event_id,
        externalUserId: data.user.unique_token,
        externalGymId: data.slot.gym_id,
        externalClassId: data.slot.class_id,
        externalSlotId: data.slot.id,
        bookingNumber: data.slot.booking_number,
        eventTimestamp: data.timestamp,
        ...(data.user.name ? { displayName: data.user.name.trim() } : {}),
        ...(data.user.email
          ? { email: data.user.email.trim().toLowerCase() }
          : {}),
      },
    };
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
