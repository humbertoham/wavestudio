import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Source manifest, reviewed against main a9b85f3. Changing this manifest requires
// a separately reviewed migration-lineage reconciliation and database rehearsal.
const mainBaseline = {
  "20250917054114_init": "68db67bb130e2bf0d55caf793985436b944dcdd859407c5a58821b36477d120a",
  "20250927171849_add_user_extra_fields": "a5463d62fedeb388eb027b3eaf6038fdeedd5bffd90d43d9160e40fe17fa9bc3",
  "20250928012014_add_tokens_ledger_and_waitlist": "a07a3c53ebdf5311dfef562d61ccc713d39ee7e3387e0f50d54705fbb45589d2",
  "20251008194559_add_unique_payment_fk": "013858f9b4cf20ee5181444eab8c61d13d8cd8efba57e7defc0f64bc8fb37872",
  "20260131003408_add_password_reset_tokens": "2dbe434c07f8d81394ce55d4ffbc901917cce594450ddf0532b80a2d19724014",
  "20260209072336_add_attendance_guests_once_per_user": "314d793c44e4a8b2753e33057ce814d37cf38ab8ea0c25e210821d3a45937d2a",
  "20260212053825_add_corporate_monthly_reason": "6f9f09f51c06c3a30d3467c893a7543a3e06d27900fc6efc4491c780b73f3f59",
  "20260219203738_add_pack_is_visible": "9cebdaffb491a3cf78c94ea6aacf9f21a0882b244f24bcdcc437efb896cf9123",
  "20260228112759_add_admin_payment_provider": "5c66cd6af8528704984b6ac1948d60c91a22eb98e02f1a05f9bcc42517635262",
  "20260423000000_add_package_pause_and_booking_block": "d21a08a79a7fa0ab58ff9d5230691d7211394a4a83a4e78dbcf9128795d802e6",
  "20260427000000_add_partial_unique_active_booking": "6992c5f0b88342016fe1c2cbef4971bf6333cd5f1344aed11fa018947f295daa",
  "20260427010000_add_booking_quantity_check": "2937477c4e7b7740c43b0988ab55360477903592f9823a7db93939b033cdc0ab",
  "20260623000000_add_coach_role": "a3c49701939c0414c4e677db104fcb8045dfa57cc22ef8c1daa62efaacbfa148",
  "20260630000000_add_wellhub_plan_affiliation_confirmation": "609e180a010bfbd19e58add7ccd33b1bc19b35659d3902805f49949179503cd5",
  "20260713000000_add_wellhub_credit_traceability": "5840d38bc988bbcb4928035e730d7e133202317047767f2d2e92308aa93dd3d6",
  "20260713010000_add_challenge": "f386f425e7c7cf2386aaaaed4938ca20d6037d39cbbdc358455c9b02ff554f30",
  "20260713020000_add_wellhub_plan_confirmation": "472f64e55ebba967471cae289bd16349f040c7062d1f8bdaac18d7723c7099e6",
  "20260717010000_add_class_deleted_at": "3083e9959d62f68853091e70b29cd72d5b96fe17ab0e16c0b0fcb2e088d7deab",
  "20260718010000_add_challenge_point_adjustment": "a9b804ac2e9abf0d2abf0acc97fd4e290c1159e0ccb9478a8bf06cab77b8a8cb",
  "20260718020000_add_wellhub_session_transition": "0d2bc12cd67923b8893e63ece22214fffafc6b093d58120ac1c69cdd31ce5241",
  "20260905010000_add_accounting_payroll": "3f156a94fe0af07af987208e67ebf2f1ad25d30c94eba5d9c0c6363ce8494bb1",
};

const monthlyProduction = {
  "20261011000001_add_monthly_unlimited_production": "d6f900f1949c20b3968155e4f0063814f29fe1652e580537ce796b4a160f85e5",
  "20261011010000_guard_unlimited_purchase_history": "08b62c23c25957aae7925d506bb7fde247002a9588973820f474ac5cd361ab11",
  "20261011020000_snapshot_existing_purchase_labels": "68fb2f35fd91d01d05616b25ef1e0c4c938fdf5bbc15eeb2e6fab19b074b8898",
};

const devBase = "20261011000000_add_monthly_unlimited_packages";
const wellhubProduction = {
  "20261026000000_add_wellhub_checkin_production": "10c4747ea92b33dd29331de2c5199e21544084b66d61da6a2bcca421f17201aa",
  "20261026010000_add_wellhub_booking_production": "242ac38cf37529b869a6a93a914e2f8f81b5965a6f5910b54947ee1f15ba21b0"
};
const expected = { ...mainBaseline, ...monthlyProduction, ...wellhubProduction };
const lockHash = "99836963713b4f5b269ad49af0ed3d7b0b2e336115c2f92dc9ac683d139d0900";
const defaultDirectory = fileURLToPath(new URL("../prisma/migrations/", import.meta.url));

function sourceHash(file) {
  // Ignore checkout-only LF/CRLF conversion; every other source byte matters.
  return createHash("sha256")
    .update(readFileSync(file, "utf8").replace(/\r\n/g, "\n"))
    .digest("hex");
}

/** Read-only source check: no environment loading, database client, or Git calls. */
export function checkMonthlyMigrationLineage(migrationsDirectory = defaultDirectory) {
  const errors = [];
  const directory = path.resolve(migrationsDirectory);
  let entries;
  try {
    if (!lstatSync(directory).isDirectory()) throw new Error("not a real directory");
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return { ok: false, baselineCount: 21, monthlyCount: 3, errors: ["MIGRATIONS_DIRECTORY_UNAVAILABLE"] };
  }

  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  if (byName.has(devBase)) errors.push("DEV_MONTHLY_BASE_FORBIDDEN");
  for (const entry of entries) {
    if (entry.name !== "migration_lock.toml" && !Object.hasOwn(expected, entry.name))
      errors.push(`UNAPPROVED_MIGRATION_ENTRY:${entry.name}`);
  }

  for (const [name, hash] of Object.entries(expected)) {
    const entry = byName.get(name);
    if (!entry) {
      errors.push(`MISSING_MIGRATION:${name}`);
      continue;
    }
    if (!entry.isDirectory()) {
      errors.push(`INVALID_MIGRATION_DIRECTORY:${name}`);
      continue;
    }
    try {
      const migrationDirectory = path.join(directory, name);
      const children = readdirSync(migrationDirectory, { withFileTypes: true });
      const sql = children.find((child) => child.name === "migration.sql");
      if (children.length !== 1 || !sql?.isFile()) {
        errors.push(`INVALID_MIGRATION_CONTENTS:${name}`);
        continue;
      }
      if (sourceHash(path.join(migrationDirectory, "migration.sql")) !== hash)
        errors.push(`MIGRATION_SOURCE_CHANGED:${name}`);
    } catch {
      errors.push(`MIGRATION_UNREADABLE:${name}`);
    }
  }

  try {
    const lock = byName.get("migration_lock.toml");
    if (!lock?.isFile() || sourceHash(path.join(directory, lock.name)) !== lockHash)
      errors.push("MIGRATION_LOCK_CHANGED_OR_MISSING");
  } catch {
    errors.push("MIGRATION_LOCK_CHANGED_OR_MISSING");
  }
  return {
    ok: errors.length === 0,
    baselineCount: Object.keys(mainBaseline).length,
    monthlyCount: Object.keys(monthlyProduction).length,
    wellhubCount: Object.keys(wellhubProduction).length,
    errors,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--migrations-dir" || !args[1])) {
    console.error("Usage: node scripts/check-monthly-migration-lineage.mjs [--migrations-dir <directory>]");
    process.exitCode = 1;
  } else {
    const result = checkMonthlyMigrationLineage(args[1]);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  }
}
