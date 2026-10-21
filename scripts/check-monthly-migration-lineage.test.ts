import { afterEach, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { checkMonthlyMigrationLineage } from "./check-monthly-migration-lineage.mjs";

const sourceDirectory = fileURLToPath(new URL("../prisma/migrations/", import.meta.url));
const script = fileURLToPath(new URL("./check-monthly-migration-lineage.mjs", import.meta.url));
const fixtures: string[] = [];

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "wave-monthly-lineage-"));
  fixtures.push(root);
  const directory = path.join(root, "migrations");
  cpSync(sourceDirectory, directory, { recursive: true });
  return directory;
}

afterEach(() => {
  for (const root of fixtures.splice(0)) {
    if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith("wave-monthly-lineage-"))
      throw new Error("Refusing cleanup outside generated fixture directory");
    rmSync(root, { recursive: true, force: true });
  }
});

describe("production monthly migration lineage", () => {
  it("accepts the reviewed main baseline and only the production monthly sequence", () => {
    expect(checkMonthlyMigrationLineage(sourceDirectory)).toEqual({
      ok: true, baselineCount: 21, monthlyCount: 3, errors: [],
    });
  });

  it("rejects a merged DEV base before any migration can run", () => {
    const directory = fixture();
    const dev = path.join(directory, "20261011000000_add_monthly_unlimited_packages");
    mkdirSync(dev);
    writeFileSync(path.join(dev, "migration.sql"), 'CREATE TYPE "PackType" AS ENUM (\'STANDARD\');\n');
    expect(checkMonthlyMigrationLineage(directory)).toMatchObject({
      ok: false, errors: expect.arrayContaining(["DEV_MONTHLY_BASE_FORBIDDEN"]),
    });
  });

  it("rejects an unreviewed Wellhub integration migration", () => {
    const directory = fixture();
    mkdirSync(path.join(directory, "20260825000000_add_wellhub_booking"));
    expect(checkMonthlyMigrationLineage(directory)).toMatchObject({
      ok: false,
      errors: expect.arrayContaining(["UNAPPROVED_MIGRATION_ENTRY:20260825000000_add_wellhub_booking"]),
    });
  });

  it.each([
    "20261011000001_add_monthly_unlimited_production",
    "20261011010000_guard_unlimited_purchase_history",
    "20261011020000_snapshot_existing_purchase_labels",
    "20260905010000_add_accounting_payroll",
  ])("detects source changes to %s", (name) => {
    const directory = fixture();
    const sql = path.join(directory, name, "migration.sql");
    writeFileSync(sql, `${readFileSync(sql, "utf8")}\n-- changed after review\n`);
    expect(checkMonthlyMigrationLineage(directory)).toMatchObject({
      ok: false, errors: expect.arrayContaining([`MIGRATION_SOURCE_CHANGED:${name}`]),
    });
  });

  it("rejects a missing production base or missing historical baseline SQL", () => {
    const directory = fixture();
    rmSync(path.join(directory, "20261011000001_add_monthly_unlimited_production", "migration.sql"));
    rmSync(path.join(directory, "20250917054114_init", "migration.sql"));
    expect(checkMonthlyMigrationLineage(directory)).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        "INVALID_MIGRATION_CONTENTS:20261011000001_add_monthly_unlimited_production",
        "INVALID_MIGRATION_CONTENTS:20250917054114_init",
      ]),
    });
  });

  it("accepts Windows checkout line endings without rewriting the source", () => {
    const directory = fixture();
    const sql = path.join(directory, "20261011010000_guard_unlimited_purchase_history", "migration.sql");
    writeFileSync(sql, readFileSync(sql, "utf8").replace(/\r\n/g, "\n").replace(/\n/g, "\r\n"));
    const before = readFileSync(sql);
    expect(checkMonthlyMigrationLineage(directory).ok).toBe(true);
    expect(readFileSync(sql)).toEqual(before);
  });

  it("rejects a missing migration directory and a changed provider lock", () => {
    const directory = fixture();
    writeFileSync(path.join(directory, "migration_lock.toml"), 'provider = "mysql"\n');
    expect(checkMonthlyMigrationLineage(directory).errors).toContain("MIGRATION_LOCK_CHANGED_OR_MISSING");
    expect(checkMonthlyMigrationLineage(path.join(directory, "absent"))).toMatchObject({
      ok: false, errors: ["MIGRATIONS_DIRECTORY_UNAVAILABLE"],
    });
  });

  it("returns a failing CLI status with read-only diagnostics for an invalid candidate", () => {
    const directory = fixture();
    writeFileSync(path.join(directory, "unapproved.sql"), "SELECT 1;\n");
    const result = spawnSync(process.execPath, [script, "--migrations-dir", directory], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false, errors: expect.arrayContaining(["UNAPPROVED_MIGRATION_ENTRY:unapproved.sql"]),
    });
    expect(result.stderr).toBe("");
  });
});
