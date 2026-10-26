import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { withoutWellhubBookingIdentifiers, withoutWellhubClassIdentifiers } from "./serialize";

describe("provider reference redaction in nested shared API responses", () => {
  it("redacts nested class references without changing monthly attribution, amounts or dates", () => {
    const date = new Date("2026-10-26T20:00:00Z"), rate = new Prisma.Decimal("275.50");
    const result = withoutWellhubBookingIdentifiers({ id: "booking", source: "WAVE", entitlementType: "MONTHLY_UNLIMITED", wellhubBookingNumber: "private", class: { id: "class", wellhubClassId: "private", wellhubSlotId: "private", wellhubSyncError: "private", payrollRateSnapshot: rate, date } });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(result).toMatchObject({ id: "booking", source: "WAVE", entitlementType: "MONTHLY_UNLIMITED" });
    expect(result.class.date).toBe(date); expect(result.class.payrollRateSnapshot).toBe(rate);
  });
  it("redacts nested attendees while preserving guests and source labels", () => {
    const result = withoutWellhubClassIdentifiers({ id: "class", wellhubClassId: "private", bookings: [{ id: "booking", source: "WELLHUB", guestName: "Partner member", wellhubUserId: "private", wellhubBookingNumber: "private", user: null }], capacity: 12 });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(result.bookings[0]).toMatchObject({ id: "booking", source: "WELLHUB", guestName: "Partner member", user: null });
    expect(result.capacity).toBe(12);
  });
});
