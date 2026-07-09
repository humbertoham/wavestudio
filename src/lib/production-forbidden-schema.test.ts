import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const scannedRoots = ["prisma", "src"];
const forbidden = [
  "Wellhub" + "Plan",
  "wellhub" + "Plan",
  "affiliationConfirmed" + "At",
  "20260630000000_add_" + "wellhub_plan_affiliation_confirmation",
];

function listFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(fullPath);
    return [fullPath];
  });
}

describe("production schema safety", () => {
  it("does not reintroduce forbidden plan/onboarding identifiers", () => {
    const matches: string[] = [];

    for (const root of scannedRoots) {
      const rootPath = path.join(projectRoot, root);
      for (const filePath of listFiles(rootPath)) {
        const text = fs.readFileSync(filePath, "utf8");
        for (const token of forbidden) {
          if (text.includes(token)) {
            matches.push(`${path.relative(projectRoot, filePath)}: ${token}`);
          }
        }
      }
    }

    expect(matches).toEqual([]);
  });
});
