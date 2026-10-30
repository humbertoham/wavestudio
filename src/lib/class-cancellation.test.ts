import { describe, expect, it } from "vitest";

import {
  STUDIO_TIME_ZONE,
  formatBookingCancellation,
  isLateCanceledBooking,
} from "./class-cancellation";

describe("class cancellation display", () => {
  it("formats a cancelled booking with the exact Spanish date and time", () => {
    expect(
      formatBookingCancellation("CANCELED", "2026-07-20T16:35:00.000Z")
    ).toBe("Canceló el 20 de julio de 2026 a las 10:35 a. m.");
  });

  it("uses the studio timezone instead of the machine timezone", () => {
    expect(STUDIO_TIME_ZONE).toBe("America/Monterrey");
    expect(
      formatBookingCancellation("CANCELED", "2026-01-01T05:30:00.000Z")
    ).toBe("Canceló el 31 de diciembre de 2025 a las 11:30 p. m.");
  });

  it("returns no fabricated date for null, absent, or invalid timestamps", () => {
    expect(formatBookingCancellation("CANCELED", null)).toBeNull();
    expect(formatBookingCancellation("CANCELED")).toBeNull();
    expect(formatBookingCancellation("CANCELED", "not-a-date")).toBeNull();
  });

  it("does not render cancellation metadata for a non-cancelled booking", () => {
    expect(
      formatBookingCancellation("ACTIVE", "2026-07-20T16:35:00.000Z")
    ).toBeNull();
  });

  it("preserves the legacy display rule for records without a saved decision", () => {
    const classDate = "2026-07-20T20:00:00.000Z";

    expect(isLateCanceledBooking(classDate, "2026-07-20T17:00:00.000Z")).toBe(
      true
    );
    expect(isLateCanceledBooking(classDate, "2026-07-20T15:59:00.000Z")).toBe(
      false
    );
    expect(isLateCanceledBooking(classDate, null)).toBe(false);
  });

  it("does not reclassify historical on-time cancellations between four and six hours", () => {
    const classDate = "2026-07-20T20:00:00.000Z";
    const canceledAt = "2026-07-20T15:00:00.000Z";
    expect(isLateCanceledBooking(classDate, canceledAt, true)).toBe(false);
    expect(isLateCanceledBooking(classDate, canceledAt, null)).toBe(false);
    expect(isLateCanceledBooking(classDate, "2026-07-20T16:00:00.000Z")).toBe(false);
    expect(isLateCanceledBooking(classDate, "2026-07-20T16:00:00.001Z")).toBe(true);
  });

  it("displays a new late cancellation inside six hours using its persisted decision", () => {
    expect(isLateCanceledBooking("2026-10-30T20:00:00Z", "2026-10-30T15:00:00Z", false)).toBe(true);
    expect(isLateCanceledBooking("2026-10-30T20:00:00Z", "2026-10-30T14:00:00Z", true)).toBe(false);
  });

  it("does not fabricate cancellation metadata when a saved decision lacks a valid timestamp", () => {
    expect(isLateCanceledBooking("2026-10-30T20:00:00Z", null, false)).toBe(false);
    expect(isLateCanceledBooking("invalid", "2026-10-30T15:00:00Z", false)).toBe(false);
    expect(isLateCanceledBooking("2026-10-30T20:00:00Z", "invalid", false)).toBe(false);
  });
});
