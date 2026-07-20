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

  it("keeps the existing late-cancellation calculation unchanged", () => {
    const classDate = "2026-07-20T20:00:00.000Z";

    expect(isLateCanceledBooking(classDate, "2026-07-20T17:00:00.000Z")).toBe(
      true
    );
    expect(isLateCanceledBooking(classDate, "2026-07-20T15:59:00.000Z")).toBe(
      false
    );
    expect(isLateCanceledBooking(classDate, null)).toBe(false);
  });
});
