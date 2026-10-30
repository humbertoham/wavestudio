import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  CANCELLATION_CUTOFF_HOURS,
  CANCELLATION_CUTOFF_MINUTES,
  CANCELLATION_CUTOFF_MS,
  CANCELLATION_POLICY_TEXT,
  LATE_CANCELLATION_WARNING,
  isLateCancellation,
} from "./cancellation-policy";

describe("six-hour cancellation policy", () => {
  it("defines six hours / 360 minutes consistently", () => {
    expect(CANCELLATION_CUTOFF_HOURS).toBe(6);
    expect(CANCELLATION_CUTOFF_MINUTES).toBe(360);
    expect(CANCELLATION_CUTOFF_MS).toBe(21_600_000);
  });

  it.each([
    [720, false], [420, false], [360, false], [359, true],
    [240, true], [120, true],
  ])("classifies %i minutes before class as late=%s", (minutes, late) => {
    const start = new Date("2026-10-30T12:00:00-06:00");
    expect(isLateCancellation(start, new Date(start.getTime() - minutes * 60_000))).toBe(late);
  });

  it("uses exact instants across timezone offsets and the Monterrey midnight boundary", () => {
    const start = new Date("2026-10-31T00:00:00-06:00");
    const cutoff = new Date("2026-10-31T00:00:00Z");
    expect(isLateCancellation(start, cutoff)).toBe(false);
    expect(isLateCancellation(start, new Date(cutoff.getTime() - 1))).toBe(false);
    expect(isLateCancellation(start, new Date(cutoff.getTime() + 1))).toBe(true);
  });

  it("provides consistent Spanish policy and warning copy", () => {
    expect(CANCELLATION_POLICY_TEXT).toBe("Puedes cancelar tu reservación hasta 6 horas antes del inicio de la clase.");
    expect(LATE_CANCELLATION_WARNING).toBe("Faltan menos de 6 horas para la clase.");
  });

  it.each([
    "app/(marketing)/clases/page.tsx",
    "app/(app)/mis-clases/page.tsx",
  ])("uses the shared policy and warning in %s", (filename) => {
    const source = readFileSync(path.resolve("src", filename), "utf8");
    expect(source).toContain('from "@/lib/cancellation-policy"');
    expect(source).toContain("isLateCancellation(");
    expect(source).toContain("{LATE_CANCELLATION_WARNING}");
    expect(source).toContain("Ups, estás fuera del tiempo de cancelación");
    // Existing affiliation-specific fee and contact language remains in place.
    expect(source).toContain('affiliation === "WELLHUB" || affiliation === "TOTALPASS"');
    expect(source).toContain("Esta cancelación podría generar un cargo de $100 MXN por");
    expect(source).toContain("Nuestro equipo se pondrá en contacto contigo");
    expect(source).toContain("Este crédito no podrá recuperarse debido a la cancelación tardía.");
  });

  it("uses the standard policy in the FAQ", () => {
    const source = readFileSync(path.resolve("src/components/marketing/FAQ.tsx"), "utf8");
    expect(source).toContain("${CANCELLATION_POLICY_TEXT}");
  });

  it("has no obsolete four-hour policy copy or active cutoff declarations in application source", () => {
    function sources(dir: string): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const filename = path.join(dir, entry.name);
        return entry.isDirectory() ? sources(filename) : /\.tsx?$/.test(filename) && !filename.endsWith(".test.ts") ? [filename] : [];
      });
    }
    const obsolete: string[] = [];
    for (const filename of sources(path.resolve("src"))) {
      const source = readFileSync(filename, "utf8");
      if (/\b(?:4\s+horas|4\s+hours|four\s+hours)\b|CANCEL_WINDOW_MIN\s*=\s*240/.test(source)) {
        obsolete.push(path.relative(process.cwd(), filename));
      }
    }
    expect(obsolete).toEqual([]);
  });
});
