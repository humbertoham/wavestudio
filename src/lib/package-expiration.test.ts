import { describe, expect, it } from "vitest";

import {
  BUSINESS_TIME_ZONE,
  formatBusinessDateTime,
  getMonthlyRenewalPeriod,
  getPackageExpirationAt11Pm,
} from "./package-expiration";

describe("package expiration business dates", () => {
  it.each([
    ["February non-leap year", "2025-02-01T06:00:00.000Z", "2025-02-28 23:00"],
    ["February leap year", "2024-02-01T06:00:00.000Z", "2024-02-29 23:00"],
    ["30-day month", "2026-04-01T06:00:00.000Z", "2026-04-30 23:00"],
    ["31-day month", "2026-01-01T06:00:00.000Z", "2026-01-31 23:00"],
  ])("sets monthly expiration to 23:00 in %s", (_label, now, expected) => {
    const period = getMonthlyRenewalPeriod(new Date(now));

    expect(period.businessTimeZone).toBe(BUSINESS_TIME_ZONE);
    expect(formatBusinessDateTime(period.expiresAt)).toBe(expected);
  });

  it("targets the next month when the cron runs at local end-of-month 23:00", () => {
    const period = getMonthlyRenewalPeriod(
      new Date("2026-05-01T05:00:00.000Z")
    );

    expect(period.isAllowedRunWindow).toBe(true);
    expect(period.trigger).toBe("END_OF_MONTH_23");
    expect(period.periodKey).toBe("2026-05");
    expect(formatBusinessDateTime(period.renewalWindowStart)).toBe(
      "2026-04-30 23:00"
    );
    expect(formatBusinessDateTime(period.expiresAt)).toBe("2026-05-31 23:00");
  });

  it("sets ordinary pack validity to the target business date at 23:00", () => {
    const expiresAt = getPackageExpirationAt11Pm(
      new Date("2026-01-15T18:30:00.000Z"),
      31
    );

    expect(formatBusinessDateTime(expiresAt)).toBe("2026-02-15 23:00");
  });
});
