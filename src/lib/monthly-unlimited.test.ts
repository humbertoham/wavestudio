import { describe, expect, it } from "vitest";
import { businessClassDay, monthlyPeriod } from "@/lib/unlimited-calendar";
import { packageSnapshot, readPackageSnapshot } from "@/lib/monthly-unlimited";
import { packConfigurationSchema } from "@/lib/package-config";

describe("monthly unlimited calendar and configuration", () => {
  it.each([
    ["2026-10-01T05:59:59Z", "2026-09-30"],
    ["2026-10-01T06:00:00Z", "2026-10-01"],
    ["2026-11-01T05:59:59Z", "2026-10-31"],
    ["2026-11-01T06:00:00Z", "2026-11-01"],
    ["2027-01-01T05:59:59Z", "2026-12-31"],
    ["2027-01-01T06:00:00Z", "2027-01-01"],
    ["2028-03-01T05:59:59Z", "2028-02-29"],
  ])("uses the Monterrey class day for %s", (iso, expected) => {
    expect(businessClassDay(new Date(iso)).key).toBe(expected);
  });
  it.each([
    [2026, 2, 28],
    [2028, 2, 29],
    [2026, 10, 31],
    [2026, 12, 31],
  ])("uses calendar boundaries %i/%i", (year, month, days) => {
    const period = monthlyPeriod(year, month);
    expect(period.expiresAt.getTime() - period.startsAt.getTime()).toBe(
      days * 86_400_000,
    );
    expect(businessClassDay(period.startsAt)).toMatchObject({ year, month });
    expect(
      businessClassDay(new Date(period.expiresAt.getTime() - 1)),
    ).toMatchObject({ year, month });
    expect(businessClassDay(period.expiresAt).month).toBe(
      month === 12 ? 1 : month + 1,
    );
  });
  it.each([
    [2026, 0],
    [2026, 13],
    [1999, 10],
    [2201, 1],
    [2026, 1.5],
  ])("rejects invalid period %i/%s", (y, m) => {
    expect(() => monthlyPeriod(y, m)).toThrow("INVALID_UNLIMITED_MONTH");
  });
  const standard = {
    name: "Cinco clases",
    classes: 5,
    price: 600,
    validityDays: 30,
  };
  const unlimited = {
    name: "Ilimitado octubre",
    type: "MONTHLY_UNLIMITED",
    price: 1500,
    unlimitedMonth: 10,
    unlimitedYear: 2026,
  };
  it("defaults existing package requests to standard", () => {
    expect(packConfigurationSchema.parse(standard)).toMatchObject({
      type: "STANDARD",
      classes: 5,
      validityDays: 30,
      unlimitedMonth: null,
      unlimitedYear: null,
    });
  });
  it("accepts classesCount aliases for existing clients", () => {
    expect(
      packConfigurationSchema.parse({
        ...standard,
        classes: undefined,
        classesCount: 7,
      }).classes,
    ).toBe(7);
  });
  it("retains legacy standard flag coercion and description normalization", () => {
    expect(packConfigurationSchema.parse({ ...standard, isActive: 0, oncePerUser: 1, description: [" A ", 7, null, ""] })).toMatchObject({ isActive: false, oncePerUser: true, description: ["A"] });
  });
  it("creates unlimited without a count or rolling validity", () => {
    expect(packConfigurationSchema.parse(unlimited)).toMatchObject({
      type: "MONTHLY_UNLIMITED",
      classes: 0,
      validityDays: 0,
      unlimitedMonth: 10,
      unlimitedYear: 2026,
    });
  });
  it.each(["unlimitedMonth", "unlimitedYear"])("requires %s", (field) => {
    expect(
      packConfigurationSchema.safeParse({ ...unlimited, [field]: undefined })
        .success,
    ).toBe(false);
  });
  it.each([
    { classes: 0 },
    { validityDays: 0 },
    { type: "FAKE" },
    { price: -1 },
  ])("rejects unsafe standard configuration %j", (invalid) => {
    expect(
      packConfigurationSchema.safeParse({ ...standard, ...invalid }).success,
    ).toBe(false);
  });
  it("snapshots terms independently of mutable catalog rows", () => {
    const pack = packConfigurationSchema.parse(unlimited);
    const snapshot = packageSnapshot(pack);
    pack.type = "STANDARD";
    pack.unlimitedMonth = null;
    pack.name = "Edited";
    expect(snapshot).toMatchObject({
      type: "MONTHLY_UNLIMITED",
      name: "Ilimitado octubre",
      unlimitedMonth: 10,
      unlimitedYear: 2026,
      classes: 0,
      periodKey: "2026-10",
    });
    expect(readPackageSnapshot(snapshot)).toEqual(snapshot);
  });
  it.each([
    null,
    {},
    {
      type: "MONTHLY_UNLIMITED",
      name: "Broken",
      price: 1,
      unlimitedMonth: 13,
      unlimitedYear: 2026,
    },
    {
      type: "STANDARD",
      name: "Broken",
      price: 1,
      classes: 0,
      validityDays: 30,
    },
  ])("rejects malformed snapshots %j", (s) => {
    expect(readPackageSnapshot(s)).toBeNull();
  });
});
