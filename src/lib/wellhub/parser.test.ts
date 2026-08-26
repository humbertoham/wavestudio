import { describe, expect, it } from "vitest";

import { parseWellhubEvent } from "@/lib/wellhub/parser";

const officialCheckinFixture = {
  event_type: "checkin",
  event_data: {
    user: {
      unique_token: "0123456789012",
      first_name: "Firstname",
      last_name: "Lastname",
      email: "user@email.com",
      phone_number: "447889123456",
    },
    location: { lat: 51.4937541, lon: 0.0633661 },
    gym: {
      id: 123456,
      title: "Name of the Gym",
      product: { id: 1, description: "Description of product" },
    },
    timestamp: 1666629613,
  },
};

function parsedCheckin(payload: unknown) {
  const result = parseWellhubEvent(JSON.stringify(payload));
  if (!result.ok || result.kind !== "checkin") {
    throw new Error("Expected a valid Wellhub check-in fixture");
  }
  return result.event;
}

describe("Wellhub official check-in payload", () => {
  it("parses the current official webhook example shape", () => {
    expect(parsedCheckin(officialCheckinFixture)).toMatchObject({
      eventType: "checkin",
      externalUserId: "0123456789012",
      externalGymId: "123456",
      externalProductId: "1",
      eventTimestamp: "1666629613",
      email: "user@email.com",
    });
  });

  it("derives the same identity for a retry with the same documented event fields", () => {
    const first = parsedCheckin(officialCheckinFixture);
    const retry = parsedCheckin({
      ...officialCheckinFixture,
      event_data: {
        ...officialCheckinFixture.event_data,
        user: {
          ...officialCheckinFixture.event_data.user,
          first_name: "Updated optional profile name",
        },
      },
    });

    expect(retry.externalEventId).toBe(first.externalEventId);
  });

  it("does not suppress a new same-user event with a new event timestamp", () => {
    const first = parsedCheckin(officialCheckinFixture);
    const laterSameDay = parsedCheckin({
      ...officialCheckinFixture,
      event_data: {
        ...officialCheckinFixture.event_data,
        timestamp: officialCheckinFixture.event_data.timestamp + 60,
      },
    });

    expect(laterSameDay.externalEventId).not.toBe(first.externalEventId);
  });
});

describe("Wellhub official booking payloads", () => {
  it("parses a booking request and normalizes the optional match email", () => {
    const result = parseWellhubEvent(
      JSON.stringify({
        event_type: "booking-requested",
        event_data: {
          user: {
            unique_token: "1000000000003",
            name: "Patty Cork",
            email: "MEMBER@example.com",
          },
          slot: {
            id: 9325,
            gym_id: 129,
            class_id: 8268,
            booking_number: "BK_HEQYZMK",
          },
          timestamp: 1664461204015,
          event_id: "45b4b8a4-f2f3-4b33-adf0-504c33f27642",
        },
      })
    );

    expect(result).toEqual({
      ok: true,
      kind: "booking",
      event: {
        eventType: "booking-requested",
        eventKind: "REQUESTED",
        externalEventId: "45b4b8a4-f2f3-4b33-adf0-504c33f27642",
        externalUserId: "1000000000003",
        externalGymId: "129",
        externalClassId: "8268",
        externalSlotId: "9325",
        bookingNumber: "BK_HEQYZMK",
        eventTimestamp: "1664461204015",
        displayName: "Patty Cork",
        email: "member@example.com",
      },
    });
  });

  it.each([
    ["booking-canceled", "CANCELED"],
    ["booking-late-canceled", "LATE_CANCELED"],
  ] as const)("parses %s", (eventType, eventKind) => {
    const result = parseWellhubEvent(
      JSON.stringify({
        event_type: eventType,
        event_data: {
          user: { unique_token: "1000000000003" },
          slot: {
            id: 9325,
            gym_id: 129,
            class_id: 8268,
            booking_number: "BK_HEQYZMK",
          },
          timestamp: 1664461204015,
          event_id: `event-${eventKind}`,
        },
      })
    );
    expect(result).toMatchObject({
      ok: true,
      kind: "booking",
      event: { eventType, eventKind },
    });
  });

  it("rejects malformed known booking events", () => {
    expect(
      parseWellhubEvent(
        JSON.stringify({ event_type: "booking-requested", event_data: {} })
      )
    ).toEqual({ ok: false, code: "INVALID_BOOKING_EVENT" });
  });
});
