import { existsSync, readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const args = new Map();
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith("--") && arg.includes("=")) {
    const [key, value] = arg.slice(2).split("=", 2);
    args.set(key, value);
  } else if (arg.startsWith("--")) {
    args.set(arg.slice(2), true);
  }
}

const target = String(args.get("target") ?? "");
const apply = args.get("apply") === true;
const backfillLedgerMetadata = args.get("backfill-ledger-metadata") === true;
const missingPlan = args.get("set-missing-wellhub-plan");
const allowedTargets = new Set(["dev", "uat"]);
const allowedPlans = new Set([
  "GOLD_PLUS",
  "PLATINUM",
  "DIAMOND",
  "DIAMOND_PLUS",
]);

if (!allowedTargets.has(target)) {
  console.error(
    "Usage: node scripts/repair-wellhub-renewal-state.mjs --target=<dev|uat> [--apply] [--set-missing-wellhub-plan=<PLAN>] [--backfill-ledger-metadata]"
  );
  process.exit(1);
}

if (missingPlan && !allowedPlans.has(String(missingPlan))) {
  console.error(
    "--set-missing-wellhub-plan must be one of GOLD_PLUS, PLATINUM, DIAMOND, DIAMOND_PLUS."
  );
  process.exit(1);
}

const upperTarget = target.toUpperCase();
const envFile = `.env.${target}.local`;
const databaseKey = `DATABASE_URL_${upperTarget}_BRANCH`;

if (!existsSync(envFile)) {
  console.error(`${envFile} is missing.`);
  process.exit(1);
}

function parseEnvFile(filePath) {
  const env = {};

  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match || match[1].startsWith("#")) continue;

    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[match[1]] = value;
  }

  return env;
}

function describeDatabaseUrl(raw) {
  try {
    const url = new URL(raw);
    return {
      host: url.hostname,
      database: url.pathname.replace(/^\/+/, "") || "<missing-database>",
    };
  } catch {
    return {
      host: "<invalid-url>",
      database: "<invalid-url>",
    };
  }
}

const fileEnv = parseEnvFile(envFile);
const databaseUrl = fileEnv[databaseKey]?.trim();

if (!databaseUrl) {
  console.error(`${envFile} must define ${databaseKey}.`);
  process.exit(1);
}

const lowerUrl = databaseUrl.toLowerCase();
if (lowerUrl.includes("prod") || lowerUrl.includes("production") || lowerUrl.includes("wave-prod")) {
  console.error("Refusing to run because the database target appears to be production.");
  process.exit(1);
}

const targetInfo = describeDatabaseUrl(databaseUrl);
console.log(
  JSON.stringify(
    {
      target: upperTarget,
      mode: apply ? "apply" : "dry-run",
      host: targetInfo.host,
      database: targetInfo.database,
      setMissingWellhubPlan: missingPlan ?? null,
      backfillLedgerMetadata,
    },
    null,
    2
  )
);

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: databaseUrl,
    },
  },
});

try {
  const missingPlanUsers = await prisma.user.findMany({
    where: {
      affiliation: "WELLHUB",
      wellhubPlan: null,
    },
    select: { id: true },
    orderBy: { id: "asc" },
    take: 50,
  });
  const missingPlanCount = await prisma.user.count({
    where: {
      affiliation: "WELLHUB",
      wellhubPlan: null,
    },
  });
  const ledgerRows = await prisma.tokenLedger.findMany({
    where: {
      reason: "CORPORATE_MONTHLY",
      OR: [{ metadata: { equals: null } }, { idempotencyKey: null }],
    },
    select: {
      id: true,
      userId: true,
      createdAt: true,
      delta: true,
      idempotencyKey: true,
      metadata: true,
    },
    orderBy: { createdAt: "asc" },
    take: 1000,
  });

  console.log(
    JSON.stringify(
      {
        identified: {
          missingWellhubPlanUsers: missingPlanCount,
          missingWellhubPlanSampleIds: missingPlanUsers.map((user) => user.id),
          corporateLedgerRowsMissingMetadataOrKey: ledgerRows.length,
          corporateLedgerSampleIds: ledgerRows.slice(0, 50).map((row) => row.id),
        },
      },
      null,
      2
    )
  );

  if (!apply) {
    console.log("Dry run only. Re-run with --apply to write explicit repairs.");
    process.exit(0);
  }

  if (missingPlan) {
    const updated = await prisma.user.updateMany({
      where: {
        affiliation: "WELLHUB",
        wellhubPlan: null,
      },
      data: {
        wellhubPlan: String(missingPlan),
        affiliationConfirmedAt: new Date(),
      },
    });

    console.log(
      JSON.stringify(
        {
          appliedMissingWellhubPlan: {
            plan: missingPlan,
            updatedUsers: updated.count,
          },
        },
        null,
        2
      )
    );
  }

  if (backfillLedgerMetadata) {
    let updatedLedgerRows = 0;

    for (const row of ledgerRows) {
      const cycleDate = row.createdAt;
      const cycleId = `${cycleDate.getUTCFullYear()}-${String(
        cycleDate.getUTCMonth() + 1
      ).padStart(2, "0")}`;

      await prisma.tokenLedger.update({
        where: { id: row.id },
        data: {
          idempotencyKey:
            row.idempotencyKey ?? `legacy-corporate-ledger:${row.id}`,
          metadata:
            row.metadata ??
            {
              source: "LEGACY_CORPORATE_MONTHLY",
              cycleId,
              creditDeltaApplied: row.delta,
              repairedBy: "repair-wellhub-renewal-state",
              repairedAt: new Date().toISOString(),
            },
        },
      });

      updatedLedgerRows += 1;
    }

    console.log(
      JSON.stringify(
        {
          appliedLedgerMetadataBackfill: {
            updatedLedgerRows,
          },
        },
        null,
        2
      )
    );
  }

  if (!missingPlan && !backfillLedgerMetadata) {
    console.log("No apply action selected. Nothing was changed.");
  }
} finally {
  await prisma.$disconnect();
}
