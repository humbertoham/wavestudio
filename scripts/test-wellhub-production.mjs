import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// This harness can only address its own labeled, localhost-only disposable DB.
const BASELINE = "15915ddb4fc9453b671ba7772a2924acbfa91503";
const APPROVED = [
  "20261026000000_add_wellhub_checkin_production",
  "20261026010000_add_wellhub_booking_production",
];
const DATABASE = "wave_monthly_production_validation";
const RECOVERY = "wave_monthly_production_recovery";
const LABEL = "wellhub-production-validation";
const USER = "wave_release_test";
const full = process.argv.includes("--full");
const build = process.argv.includes("--build");
const git = args => execFileSync("git", args, { encoding: "utf8" }).trim();
assert.ok(["release/wellhub-production-isolated"].includes(git(["branch", "--show-current"])), "Release validation requires the reviewed release branch or main.");
const container = `wave-wellhub-production-${randomUUID()}`;
const password = randomUUID();
const artifactDir = resolve(".env.wellhub-release", `rehearsal-${randomUUID()}`);
mkdirSync(artifactDir, { recursive: true });
assert.ok(git(["check-ignore", artifactDir]), "Rehearsal artifacts must be ignored by git.");
let started = false;
const docker = (args, options = {}) => execFileSync("docker", args, {
  encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024, ...options,
});
const sql = (statement, database = DATABASE) => docker([
  "exec", "-i", container, "psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-U", USER, "-d", database,
], { input: statement }).trim();
const jsonSql = (statement, database) => JSON.parse(sql(statement, database));
const identifier = value => `"${value.replaceAll('"', '""')}"`;
const literal = value => `'${value.replaceAll("'", "''")}'`;
const command = (label, executable, args, env) => {
  const result = spawnSync(executable, args, { env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0)
    throw new Error(`${label} failed.\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
};
const prisma = (args, env) => command("Prisma migration rehearsal", process.execPath, [resolve("node_modules/prisma/build/index.js"), ...args], env);

command("Wellhub source scope", process.execPath, [resolve("scripts/check-wellhub-production-scope.mjs")], process.env);
command("Production migration lineage", process.execPath, [resolve("scripts/check-monthly-migration-lineage.mjs")], process.env);

// Every existing table column is projected explicitly, so additive columns do
// not hide accidental changes to historical values, quantities, money or audit.
const TABLES = ["User", "Instructor", "Class", "Booking", "Pack", "PackPurchase", "Payment", "TokenLedger", "AccountingAudit", "CheckoutLink", "Waitlist", "UnlimitedUsage", "BookingBlockLog"];
const originalColumns = {};
const rowHash = (table, database = DATABASE) => {
  const columns = originalColumns[table].map(identifier).join(", ");
  const rows = sql(`SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY to_jsonb(row)::text), '[]'::jsonb)::text FROM (SELECT ${columns} FROM ${identifier(table)}) row;`, database);
  return createHash("sha256").update(rows).digest("hex");
};
const integrity = (database = DATABASE) => Object.fromEntries(TABLES.map(table => [table, rowHash(table, database)]));
const catalog = () => jsonSql(`SELECT COALESCE(jsonb_agg(item ORDER BY item::text), '[]') FROM (
  SELECT jsonb_build_object('kind','constraint','table',rel.relname,'name',c.conname,'definition',pg_get_constraintdef(c.oid)) item
  FROM pg_constraint c JOIN pg_class rel ON rel.oid=c.conrelid JOIN pg_namespace n ON n.oid=rel.relnamespace WHERE n.nspname='public'
  UNION ALL SELECT jsonb_build_object('kind','index','table',tablename,'name',indexname,'definition',indexdef) FROM pg_indexes WHERE schemaname='public'
) objects;`);

const fixtureSql = `
INSERT INTO "User" ("id","name","email","passwordHash","role","updatedAt") VALUES
 ('release_member','Historical member','release_member@example.invalid','not-a-login-hash','USER','2026-09-01'),
 ('release_admin','Historical admin','release_admin@example.invalid','not-a-login-hash','ADMIN','2026-09-01');
INSERT INTO "Instructor" ("id","name","payrollRate") VALUES ('release_instructor','Historical instructor',275.50);
INSERT INTO "Class" ("id","title","focus","date","durationMin","capacity","instructorId","payrollRateSnapshot","payrollRateEffectiveAt") VALUES
 ('release_class','Historical mixed bookings','Rehearsal','2026-10-10 18:00:00',50,25,'release_instructor',250,'2026-09-01'),
 ('release_other','Historical alternate class','Rehearsal','2026-10-11 18:00:00',50,10,'release_instructor',275.50,'2026-09-02');
INSERT INTO "Pack" ("id","name","classes","price","validityDays","description") VALUES
 ('release_pack','Historical standard catalog',10,900,30,'{"legacy":"preserve"}');
INSERT INTO "Payment" ("id","provider","status","amount","userId","mpPaymentId","mpExternalRef","mpRaw","updatedAt") VALUES
 ('release_payment','MERCADOPAGO','APPROVED',650,'release_member','synthetic-historical-payment','synthetic-reference','{"synthetic":true}','2026-09-01'),
 ('release_pending','MERCADOPAGO','PENDING',900,'release_member',NULL,'synthetic-pending','{"synthetic":true}','2026-09-01');
INSERT INTO "PackPurchase" ("id","userId","packId","classesLeft","expiresAt","pausedDays","pausedUntil","paymentId","updatedAt") VALUES
 ('release_paid','release_member','release_pack',8,'2027-01-01',0,NULL,'release_payment','2026-09-01'),
 ('release_unpaid','release_member','release_pack',10,'2027-01-01',0,NULL,NULL,'2026-09-01'),
 ('release_expired','release_member','release_pack',2,'2025-01-01',0,NULL,NULL,'2026-09-01'),
 ('release_paused','release_member','release_pack',4,'2027-02-01',5,'2026-12-01',NULL,'2026-09-01');
INSERT INTO "Booking" ("id","userId","guestName","classId","quantity","attended","packPurchaseId","status","canceledAt","refundToken") VALUES
 ('release_member_booking','release_member',NULL,'release_class',2,true,'release_paid','ACTIVE',NULL,NULL),
 ('release_admin_booking','release_admin',NULL,'release_class',1,false,NULL,'ACTIVE',NULL,NULL),
 ('release_named_guest',NULL,'Historical named guest','release_class',3,true,NULL,'ACTIVE',NULL,NULL),
 ('release_null_guest',NULL,NULL,'release_class',1,false,NULL,'ACTIVE',NULL,NULL),
 ('release_canceled','release_member',NULL,'release_other',1,false,'release_paid','CANCELED','2026-09-03',true);
INSERT INTO "TokenLedger" ("id","userId","packPurchaseId","bookingId","delta","reason","idempotencyKey","metadata") VALUES
 ('release_credit','release_member','release_paid',NULL,10,'PURCHASE_CREDIT','release-credit','{"synthetic":true}'),
 ('release_debit','release_member','release_paid','release_member_booking',-2,'BOOKING_DEBIT','release-debit','{"synthetic":true}'),
 ('release_canceled_debit','release_member','release_paid','release_canceled',-1,'BOOKING_DEBIT','release-canceled-debit',NULL),
 ('release_refund','release_member','release_paid','release_canceled',1,'CANCEL_REFUND','release-refund',NULL);
INSERT INTO "AccountingAudit" ("id","type","instructorId","instructorName","previousRate","newRate","actorUserId") VALUES
 ('release_accounting','INSTRUCTOR_RATE_CHANGED','release_instructor','Historical instructor',250,275.50,'release_admin');
INSERT INTO "CheckoutLink" ("id","code","status","packId","userId","paymentId","expiresAt") VALUES
 ('release_checkout','synthetic-release-checkout','OPEN','release_pack','release_member','release_pending','2027-01-01');
`;

try {
  const baselineFiles = git(["ls-tree", "-r", "--name-only", BASELINE, "prisma/migrations"]).split("\n").filter(Boolean);
  const baselineMigrations = baselineFiles.filter(path => path.endsWith("/migration.sql")).map(path => path.split("/")[2]);
  assert.equal(baselineMigrations.length, 24, "The pinned MAIN baseline must contain exactly 24 migrations.");
  const releaseMigrations = git(["ls-files", "--cached", "--others", "--exclude-standard", "prisma/migrations"]).split("\n").filter(path => path.endsWith("/migration.sql")).map(path => path.split("/")[2]);
  assert.deepEqual(releaseMigrations.filter(name => !baselineMigrations.includes(name)).sort(), APPROVED);
  for (const path of [...baselineFiles, "prisma/schema.prisma"]) {
    const target = resolve(artifactDir, "baseline", path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, execFileSync("git", ["show", `${BASELINE}:${path}`]));
  }
  docker(["run", "--detach", "--rm", "--name", container, "--label", `wave.environment=${LABEL}`, "--publish", "127.0.0.1::5432", "--env", `POSTGRES_DB=${DATABASE}`, "--env", `POSTGRES_USER=${USER}`, "--env", `POSTGRES_PASSWORD=${password}`, "postgres:17-alpine"]);
  started = true;
  let binding;
  for (let attempt = 0; attempt < 40; attempt++) {
    const state = JSON.parse(docker(["inspect", container]))[0];
    binding = state.NetworkSettings.Ports["5432/tcp"]?.[0];
    if (binding) {
      assert.equal(state.Config.Labels["wave.environment"], LABEL);
      assert.equal(binding.HostIp, "127.0.0.1");
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(binding, "Disposable PostgreSQL has no verified localhost binding.");
  const url = `postgresql://${USER}:${password}@127.0.0.1:${binding.HostPort}/${DATABASE}`;
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/DATABASE_URL|DIRECT_URL|WELLHUB_|MP_|UPSTASH_|RESEND_API_KEY|CRON_SECRET|JWT_SECRET|RUN_.*INTEGRATION|RUN_.*DB_TESTS/.test(key)) delete env[key];
  }
  Object.assign(env, {
    NODE_ENV: "test", APP_ENV: "development", DATABASE_URL: url, WAVE_RELEASE_TEST_DATABASE_URL: url,
    JWT_SECRET: "automated-local-test-signing-only", MP_ACCESS_TOKEN: "TEST-automated-provider-only",
    APP_BASE_URL: "https://release.example.invalid", RESEND_API_KEY: "re_automated_fixture_only",
    CRON_SECRET: "automated-fixture-only", MP_WEBHOOK_SECRET: "automated-test-signing-key",
    WELLHUB_CHECKIN_ENABLED: "false", WELLHUB_BOOKING_ENABLED: "false",
  });
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      docker(["exec", container, "pg_isready", "-U", USER, "-d", DATABASE]); ready = true; break;
    } catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  assert.ok(ready, "Disposable PostgreSQL did not become ready.");
  console.log("Rehearsing populated pinned MAIN schema on verified disposable localhost PostgreSQL 17.");
  const oldSchema = resolve(artifactDir, "baseline/prisma/schema.prisma");
  writeFileSync(oldSchema, readFileSync(oldSchema, "utf8").replace(/provider\s*=\s*"prisma-client-js"/, match => match + '\n  output = "../../old-client"'));
  prisma(["generate", "--schema", oldSchema], env);
  const { PrismaClient: OldMainClient } = createRequire(import.meta.url)(resolve(artifactDir, "old-client/index.js"));
  const oldDb = new OldMainClient({ datasources: { db: { url } } });
  async function oldMainRuntimeProbe() {
    try {
      const item = await oldDb.class.findUniqueOrThrow({ where: { id: "release_class" }, include: { instructor: true, bookings: true } });
      assert.equal(item.payrollRateSnapshot.toString(), "250");
      assert.ok(item.bookings.every(row => !Object.hasOwn(row, "source")), "Old MAIN client must keep its original projection.");
      const beforeCount = await oldDb.booking.count();
      const rollback = new Error("INTENTIONAL_LOCAL_PROBE_ROLLBACK");
      await oldDb.$transaction(async tx => {
        const row = await tx.booking.create({ data: { id: "release_old_runtime_probe", classId: "release_class", guestName: "Old MAIN runtime fixture", entitlementType: "ADMIN_GUEST" } });
        await tx.booking.update({ where: { id: row.id }, data: { status: "CANCELED", canceledAt: new Date() } });
        throw rollback;
      }).catch(error => { if (error !== rollback) throw error; });
      assert.equal(await oldDb.booking.count(), beforeCount);
    } finally { await oldDb.$disconnect(); }
  }
  prisma(["migrate", "deploy", "--schema", oldSchema], env);
  assert.deepEqual(jsonSql('SELECT jsonb_agg(migration_name ORDER BY migration_name) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;'), baselineMigrations);
  sql(fixtureSql);
  sql(`INSERT INTO "Pack" ("id","name","classes","price","validityDays","type","unlimitedMonth","unlimitedYear") VALUES ('release_monthly','Historical unlimited',0,1200,0,'MONTHLY_UNLIMITED',10,2026);
    INSERT INTO "PackPurchase" ("id","userId","packId","classesLeft","expiresAt","type","unlimitedMonth","unlimitedYear","nameSnapshot","priceSnapshot","updatedAt") VALUES ('release_monthly','release_member','release_monthly',0,'2026-11-01','MONTHLY_UNLIMITED',10,2026,'Historical unlimited',1200,'2026-09-01');
    INSERT INTO "Booking" ("id","userId","classId","quantity","packPurchaseId","entitlementType","status") VALUES ('release_monthly','release_member','release_other',1,'release_monthly','MONTHLY_UNLIMITED','ACTIVE');
    INSERT INTO "UnlimitedUsage" ("id","userId","purchaseId","bookingId","serviceDate") VALUES ('release_monthly','release_member','release_monthly','release_monthly','2026-10-11');
    INSERT INTO "Waitlist" ("id","userId","classId","position") VALUES ('release_waitlist','release_admin','release_class',1);`);
  await oldMainRuntimeProbe();
  for (const table of TABLES) originalColumns[table] = jsonSql(`SELECT jsonb_agg(column_name ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='public' AND table_name=${literal(table)};`);
  const before = integrity();
  const beforeCatalog = catalog();
  const migrationHistory = sql('SELECT jsonb_agg(jsonb_build_object(\'migration\',migration_name,\'checksum\',checksum) ORDER BY migration_name) FROM "_prisma_migrations";');

  // Recover a genuine pg_dump of the populated pre-migration database, then
  // compare every original fixture value in a separate isolated database.
  const backup = docker(["exec", container, "pg_dump", "-U", USER, "-d", DATABASE, "-Fc", "--no-owner", "--no-acl"], { encoding: "buffer" });
  docker(["exec", container, "createdb", "-U", USER, RECOVERY]);
  docker(["exec", "-i", container, "pg_restore", "-U", USER, "-d", RECOVERY, "--exit-on-error", "--no-owner", "--no-acl"], { input: backup });
  assert.deepEqual(integrity(RECOVERY), before, "Pre-migration backup recovery changed historical data.");
  assert.equal(sql("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='Booking' AND column_name='source';", RECOVERY), "0");
  assert.equal(sql('SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL;', RECOVERY), "24");

  prisma(["migrate", "deploy"], env);
  await oldMainRuntimeProbe();
  assert.deepEqual(integrity(), before, "Wellhub migrations changed MAIN records.");
  const afterCatalog = new Set(catalog().map(item => JSON.stringify(item)));
  for (const item of beforeCatalog) assert.ok(afterCatalog.has(JSON.stringify(item)), `Existing ${item.kind} ${item.name} was changed or removed.`);
  assert.equal(sql(`SELECT jsonb_agg(jsonb_build_object('migration',migration_name,'checksum',checksum) ORDER BY migration_name) FROM "_prisma_migrations" WHERE migration_name NOT IN (${APPROVED.map(literal).join(",")});`), migrationHistory);
  assert.deepEqual(jsonSql('SELECT jsonb_agg(migration_name ORDER BY migration_name) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;'), [...baselineMigrations, ...APPROVED].sort());
  assert.equal(sql('SELECT count(*) FROM "Booking" WHERE "source"<>\'WAVE\';'), "0", "Historical MAIN rows must keep WAVE source; entitlements remain unchanged.");
  assert.equal(sql('SELECT count(*) FROM "UnlimitedUsage";'), "1");
  assert.equal(sql('SELECT count(*) FROM "WellhubCheckin";'), "0");
  assert.equal(sql('SELECT count(*) FROM "WellhubBookingEvent";'), "0");
  assert.equal(sql(`SELECT count(*) FROM pg_indexes WHERE indexname IN ('Booking_wellhubBookingNumber_key','Booking_source_classId_status_idx','Class_wellhubClassId_key','Class_wellhubSlotId_key','WellhubBookingEvent_externalEventId_key','WellhubBookingEvent_eventType_bookingNumber_key','WellhubCheckin_externalEventId_key');`), "7");

  // Exercise the old MAIN SQL column contract after the additive migration.
  // Omitted new fields receive STANDARD/CREDITS defaults; rollback is explicit.
  sql(`BEGIN;
    INSERT INTO "Pack" ("id","name","classes","price","validityDays") VALUES ('release_old_probe','Old MAIN package',3,300,30);
    INSERT INTO "Payment" ("id","provider","status","amount","userId","updatedAt") VALUES ('release_old_probe','ADMIN','APPROVED',300,'release_member',now());
    INSERT INTO "PackPurchase" ("id","userId","packId","classesLeft","expiresAt","paymentId","updatedAt") VALUES ('release_old_probe','release_member','release_old_probe',3,'2027-01-01','release_old_probe',now());
    INSERT INTO "Booking" ("id","userId","classId","quantity","packPurchaseId","entitlementType") VALUES ('release_old_probe','release_admin','release_other',1,'release_old_probe','MIXED');
    UPDATE "PackPurchase" SET "classesLeft"="classesLeft"-1 WHERE "id"='release_old_probe';
    INSERT INTO "TokenLedger" ("id","userId","packPurchaseId","bookingId","delta","reason") VALUES ('release_old_probe','release_admin','release_old_probe','release_old_probe',-1,'BOOKING_DEBIT');
    UPDATE "PackPurchase" SET "classesLeft"="classesLeft"+1 WHERE "id"='release_old_probe';
    INSERT INTO "TokenLedger" ("id","userId","packPurchaseId","bookingId","delta","reason") VALUES ('release_old_refund','release_admin','release_old_probe','release_old_probe',1,'CANCEL_REFUND');
    UPDATE "Booking" SET "status"='CANCELED',"refundToken"=true,"canceledAt"=now() WHERE "id"='release_old_probe';
    DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM "PackPurchase" WHERE "id"='release_old_probe' AND "type"='STANDARD' AND "classesLeft"=3) OR NOT EXISTS (SELECT 1 FROM "Booking" WHERE "id"='release_old_probe' AND "entitlementType"='MIXED' AND "source"='WAVE') THEN RAISE EXCEPTION 'OLD_MAIN_COMPATIBILITY_FAILED'; END IF; END $$;
    ROLLBACK;`);
  assert.deepEqual(integrity(), before);
  writeFileSync(resolve(artifactDir, "migration-rehearsal.json"), JSON.stringify({ baseline: BASELINE, baselineMigrations, applied: APPROVED, originalColumns, preservedTableHashes: before, recovery: "pg_dump/pg_restore verified in isolated database", historicalAttribution: "all original entitlementType values preserved; source defaults WAVE", oldMainWriteProbe: "SQL probe passed and rolled back; separately generated old MAIN Prisma client read/write/cancel probes passed before and after Wellhub migrations" }, null, 2));
  console.log("Migration rehearsal passed: 24 MAIN + 2 Wellhub migrations; 13 populated/empty table fingerprints, constraints, recovery and old MAIN writes preserved.");

  if (full) Object.assign(env, { RUN_CHALLENGE_INTEGRATION: "1", RUN_CLASS_DELETION_INTEGRATION: "1", RUN_NEW_USER_INTEGRATION: "1", RUN_WELLHUB_CONFIRMATION_DB_TESTS: "1" });
  const report = resolve(artifactDir, full ? "full-tests.json" : "focused-tests.json");
  const tests = full ? [] : ["src/lib/wellhub/", "src/app/api/integrations/wellhub/", "src/lib/wellhub-production.database.test.ts", "src/lib/monthly-unlimited.test.ts", "src/lib/monthly-unlimited.database.test.ts", "src/lib/monthly-payment-reversal.test.ts", "src/app/api/webhooks/mercadopago/route.test.ts", "src/lib/class-booking.test.ts", "src/app/api/bookings/[id]/cancel/route.test.ts", "src/app/api/admin/classes/[id]/route.payroll.test.ts"];
  prisma(["generate"], env);
  prisma(["validate"], env);
  command("TypeScript", process.execPath, [resolve("node_modules/typescript/bin/tsc"), "--noEmit"], env);
  let testFailure;
  try {
    command("Isolated release tests", process.execPath, [resolve("node_modules/vitest/vitest.mjs"), "run", ...tests, "--fileParallelism=false", "--silent", "--reporter=default", "--reporter=json", `--outputFile=${report}`], env);
  } catch (error) { testFailure = error; }
  const result = JSON.parse(readFileSync(report, "utf8"));
  console.log(`${full ? "Full" : "Focused"} isolated release validation: ${result.numPassedTests} passed, ${result.numFailedTests} failed, ${result.numPendingTests} skipped.`);
  if (testFailure) {
    for (const suite of result.testResults.filter(suite => suite.status !== "passed")) {
      console.error(suite.name);
      for (const test of suite.assertionResults.filter(test => test.status === "failed")) console.error(`${test.fullName}: ${test.failureMessages.join("\n")}`);
    }
    throw testFailure;
  }
  assert.equal(result.success, true);
  assert.equal(result.numFailedTests, 0);
  assert.equal(result.numPendingTests, 0, "Release certification must execute every selected test.");
  if (build) {
    command("Production build", process.execPath, [resolve("scripts/check-monthly-migration-lineage.mjs")], env);
    command("Production build", process.execPath, [resolve("node_modules/next/dist/bin/next"), "build"], { ...env, NODE_ENV: "production", APP_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" });
    console.log("Production build passed with fixture credentials and both Wellhub flags disabled.");
  }
  console.log(`Synthetic validation report: ${resolve(artifactDir, "migration-rehearsal.json")}`);
} finally {
  if (started) {
    const state = JSON.parse(docker(["inspect", container]))[0];
    assert.equal(state.Name, `/${container}`);
    assert.equal(state.Config.Labels["wave.environment"], LABEL, "Refusing to stop an unverified container.");
    docker(["stop", "--time", "1", container]);
    console.log("Verified disposable release database container removed.");
  }
}
