import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Source-only check. No environment files, credentials, database or HTTP access.
export const BASELINE = "15915ddb4fc9453b671ba7772a2924acbfa91503";
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const original = file => JSON.parse(git("show", `${BASELINE}:${file}`));
const current = file => JSON.parse(readFileSync(file, "utf8"));
const shared = new Set([
  ".env.example", "package.json", "package-lock.json", "prisma/schema.prisma",
  "scripts/check-monthly-migration-lineage.mjs", "scripts/check-monthly-migration-lineage.test.ts",
  "src/app/(marketing)/clases/[id]/page.tsx",
  "src/app/api/admin/booking/route.ts", "src/app/api/admin/bookings/[id]/route.ts", "src/app/api/admin/bookings/route.ts",
  "src/app/api/admin/classes/[id]/add-guest/route.ts", "src/app/api/admin/classes/[id]/add-user/route.ts",
  "src/app/api/admin/classes/[id]/cancel/route.ts", "src/app/api/admin/classes/[id]/route.ts",
  "src/app/api/admin/classes/[id]/waitlist/[entryId]/promote/route.ts", "src/app/api/admin/classes/route.ts",
  "src/app/api/bookings/[id]/cancel/route.ts", "src/app/api/bookings/route.ts",
  "src/app/api/classes/[id]/route.ts", "src/app/api/classes/route.ts",
  "src/app/api/integrations/wellhub/webhook/route.ts", "src/app/api/integrations/wellhub/webhook/route.test.ts",
  "src/lib/class-deletion-response.ts", "src/lib/class-deletion.ts", "src/lib/env.ts",
  "src/lib/monthly-unlimited.database.test.ts",
]);
const additions = file => /^(src\/lib\/wellhub\/|docs\/integrations\/wellhub-)/.test(file)
  || /^(scripts\/(check-wellhub.*|sync-wellhub-booking.*|test-wellhub-production\.mjs)|src\/lib\/wellhub-production\.database\.test\.ts|src\/app\/api\/integrations\/wellhub\/webhook\/route\.integration\.test\.ts)$/.test(file)
  || /^prisma\/migrations\/20261026(?:000000_add_wellhub_checkin|010000_add_wellhub_booking)_production\/migration\.sql$/.test(file);

const changed = [...new Set([...git("diff", "--name-only", BASELINE).split("\n"), ...git("ls-files", "--others", "--exclude-standard").split("\n")].filter(Boolean))].sort();
for (const file of changed) assert.ok(shared.has(file) || additions(file), `Unrelated change: ${file}`);
const baseLock = original("package-lock.json"), lock = current("package-lock.json");
for (const [name, value] of Object.entries(baseLock.packages)) if (name) assert.deepEqual(lock.packages[name], value, `Existing dependency changed: ${name}`);
for (const name of Object.keys(lock.packages)) if (!Object.hasOwn(baseLock.packages, name)) assert.ok(/^node_modules\/(tsx$|esbuild$|@esbuild\/)/.test(name), `Unrelated new dependency: ${name}`);
const basePackage = original("package.json"), pkg = current("package.json");
assert.deepEqual(pkg.dependencies, basePackage.dependencies);
for (const [key, value] of Object.entries(basePackage.devDependencies)) assert.equal(pkg.devDependencies[key], value);
for (const [key, value] of Object.entries(basePackage.scripts)) assert.equal(pkg.scripts[key], value, `Existing command changed: ${key}`);
assert.equal(pkg.devDependencies.tsx, "4.23.12");

// The only adaptation to MAIN's existing monthly DB test is its disabled-webhook contract.
const monthly = "src/lib/monthly-unlimited.database.test.ts";
const mainTest = git("show", `${BASELINE}:${monthly}`).replace(/\r\n/g, "\n");
const adapted = mainTest
  .replace("the existing Wellhub webhook remains an inert production stub", "the Wellhub webhook stays inert with both feature flags disabled")
  .replace('json(wellhubStub(req("/api/integrations/wellhub/webhook", { event: "booking" })))', 'json(await wellhubStub(req("/api/integrations/wellhub/webhook", { event: "booking" })))')
  .replace('expect(response).toMatchObject({ status: 503, body: { ok: false, code: "WELLHUB_NOT_CONFIGURED" } });', 'expect(response).toMatchObject({ status: 200, body: { ok: true, result: "DISABLED" } });');
assert.equal(readFileSync(monthly, "utf8").replace(/\r\n/g, "\n").trim(), adapted.trim());
console.log(JSON.stringify({ ok: true, baseline: BASELINE, changedFiles: changed.length, existingDependenciesPreserved: Object.keys(baseLock.packages).length - 1, mainBusinessLogicPreserved: true }, null, 2));
