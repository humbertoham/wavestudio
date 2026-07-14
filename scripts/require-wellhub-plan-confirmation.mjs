import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const TARGETS = new Set(["dev", "uat", "prod"]);
const PRODUCTION_ACK = "REQUIRE_WELLHUB_PLAN_CONFIRMATION";
const DEFAULT_BATCH_SIZE = 100;
const CAMPAIGN_PATTERN = /^[a-z0-9][a-z0-9._-]{2,99}$/i;

export function parseCommandArgs(argv) {
  const args = new Map();
  for (const raw of argv) {
    if (!raw.startsWith("--")) {
      throw new Error(`Unknown argument: ${raw}`);
    }
    const withoutPrefix = raw.slice(2);
    const separator = withoutPrefix.indexOf("=");
    if (separator === -1) {
      args.set(withoutPrefix, true);
    } else {
      args.set(
        withoutPrefix.slice(0, separator),
        withoutPrefix.slice(separator + 1)
      );
    }
  }

  const allowed = new Set([
    "target",
    "campaign",
    "apply",
    "confirm-production",
    "user-id",
    "batch-size",
  ]);
  for (const key of args.keys()) {
    if (!allowed.has(key)) throw new Error(`Unknown option: --${key}`);
  }

  const target = String(args.get("target") ?? "").toLowerCase();
  const campaign = String(args.get("campaign") ?? "").trim();
  const apply = args.get("apply") === true;
  const confirmProduction = String(
    args.get("confirm-production") ?? ""
  );
  const userId = String(args.get("user-id") ?? "").trim() || null;
  const batchSizeValue = Number(
    args.get("batch-size") ?? DEFAULT_BATCH_SIZE
  );

  if (!TARGETS.has(target)) {
    throw new Error("--target must be dev, uat, or prod.");
  }
  if (!CAMPAIGN_PATTERN.test(campaign)) {
    throw new Error(
      "--campaign is required and must be a stable 3-100 character identifier using letters, numbers, dot, underscore, or hyphen."
    );
  }
  if (
    !Number.isInteger(batchSizeValue) ||
    batchSizeValue < 1 ||
    batchSizeValue > 500
  ) {
    throw new Error("--batch-size must be an integer from 1 to 500.");
  }
  if (
    target === "prod" &&
    (!apply || confirmProduction !== PRODUCTION_ACK)
  ) {
    throw new Error(
      `Production requires --apply and --confirm-production=${PRODUCTION_ACK}.`
    );
  }
  if (target !== "prod" && confirmProduction) {
    throw new Error(
      "--confirm-production is only valid with --target=prod."
    );
  }

  return {
    target,
    campaign,
    apply,
    userId,
    batchSize: batchSizeValue,
  };
}

export function parseEnvText(contents) {
  const env = {};
  for (const line of contents.split(/\r?\n/)) {
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

function databaseKey(target) {
  return target === "prod"
    ? "DATABASE_URL_PROD"
    : `DATABASE_URL_${target.toUpperCase()}_BRANCH`;
}

function isPlaceholder(raw) {
  return (
    !raw ||
    raw.includes("...") ||
    raw.includes("<") ||
    raw.includes(">")
  );
}

function parseDatabaseIdentity(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("The selected database URL is invalid.");
  }
  if (!/^postgres(?:ql)?:$/.test(url.protocol) || isPlaceholder(raw)) {
    throw new Error("The selected database URL is invalid or a placeholder.");
  }

  const database = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  return {
    host: url.hostname,
    database: database || "<missing-database>",
    fingerprint: `${url.hostname.toLowerCase()}/${database.toLowerCase()}`,
  };
}

function looksProduction(identity) {
  return /(^|[._-])(prod|production|main)([._-]|$)/i.test(
    `${identity.host}/${identity.database}`
  );
}

export function resolveDatabaseTarget({
  target,
  cwd = process.cwd(),
  fileExists = existsSync,
  readFile = readFileSync,
}) {
  const envPath = resolve(cwd, `.env.${target}.local`);
  if (!fileExists(envPath)) {
    throw new Error(`.env.${target}.local is missing.`);
  }

  const selectedEnv = parseEnvText(readFile(envPath, "utf8"));
  const key = databaseKey(target);
  const databaseUrl = selectedEnv[key]?.trim();
  if (!databaseUrl) {
    throw new Error(`.env.${target}.local must define ${key}.`);
  }
  if (
    selectedEnv.WAVE_DATABASE_TARGET &&
    selectedEnv.WAVE_DATABASE_TARGET.toLowerCase() !== target
  ) {
    throw new Error("Database target marker does not match --target.");
  }

  const identity = parseDatabaseIdentity(databaseUrl);
  for (const otherTarget of TARGETS) {
    if (otherTarget === target) continue;
    const otherPath = resolve(cwd, `.env.${otherTarget}.local`);
    if (!fileExists(otherPath)) continue;
    const otherEnv = parseEnvText(readFile(otherPath, "utf8"));
    const otherUrl = otherEnv[databaseKey(otherTarget)]?.trim();
    if (!otherUrl) continue;
    const otherIdentity = parseDatabaseIdentity(otherUrl);
    if (identity.fingerprint === otherIdentity.fingerprint) {
      throw new Error(
        `Selected database matches the configured ${otherTarget.toUpperCase()} target; refusing mismatched execution.`
      );
    }
  }

  if (target !== "prod" && looksProduction(identity)) {
    throw new Error(
      "Selected database appears production-like; use the production target and acknowledgement."
    );
  }

  return {
    databaseUrl,
    env: selectedEnv,
    identity: { host: identity.host, database: identity.database },
  };
}

function eligibilityWhere(userId) {
  return {
    affiliation: "WELLHUB",
    ...(userId ? { id: userId } : {}),
  };
}

export async function inspectCampaign(prisma, { campaign, userId = null }) {
  const where = eligibilityWhere(userId);
  const [eligibleUsers, campaignRecords, pendingRecords, completedRecords] =
    await Promise.all([
      prisma.user.count({ where }),
      prisma.wellhubPlanConfirmation.count({
        where: { campaign, user: where },
      }),
      prisma.wellhubPlanConfirmation.count({
        where: { campaign, status: "PENDING", user: where },
      }),
      prisma.wellhubPlanConfirmation.count({
        where: { campaign, status: "COMPLETED", user: where },
      }),
    ]);

  return {
    eligibleUsers,
    newCandidates: Math.max(eligibleUsers - campaignRecords, 0),
    alreadyFlaggedForCampaign: pendingRecords,
    alreadyConfirmedForCampaign: completedRecords,
  };
}

export async function applyCampaign(
  prisma,
  { campaign, userId = null, batchSize = DEFAULT_BATCH_SIZE, now = new Date() }
) {
  let cursor = null;
  let newlyFlagged = 0;
  let failed = 0;
  let batches = 0;

  while (true) {
    const users = await prisma.user.findMany({
      where: eligibilityWhere(userId),
      select: { id: true },
      orderBy: { id: "asc" },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (users.length === 0) break;
    cursor = users[users.length - 1].id;
    batches += 1;

    try {
      const updated = await prisma.$transaction(async (tx) => {
        const ids = users.map((user) => user.id);
        const existing = await tx.wellhubPlanConfirmation.findMany({
          where: { campaign, userId: { in: ids } },
          select: { userId: true },
        });
        const existingIds = new Set(existing.map((row) => row.userId));
        const candidates = ids.filter((id) => !existingIds.has(id));
        if (candidates.length === 0) return 0;

        await tx.wellhubPlanConfirmation.createMany({
          data: candidates.map((candidateId) => ({
            campaign,
            userId: candidateId,
            status: "PENDING",
            requestedAt: now,
            source: "ADMIN_COMMAND",
            idempotencyKey: `wellhub-plan-confirmation:${campaign}:${candidateId}`,
          })),
          skipDuplicates: true,
        });

        const result = await tx.user.updateMany({
          where: {
            id: { in: candidates },
            affiliation: "WELLHUB",
            NOT: {
              wellhubPlanConfirmationCampaign: campaign,
              wellhubPlanConfirmationRequired: true,
            },
          },
          data: {
            wellhubPlanConfirmationRequired: true,
            wellhubPlanConfirmationRequestedAt: now,
            wellhubPlanConfirmationCampaign: campaign,
            authVersion: { increment: 1 },
          },
        });
        return result.count;
      });
      newlyFlagged += updated;
    } catch {
      // A failed batch is fully rolled back. Later batches remain safe and a
      // rerun picks up only records that never committed.
      failed += users.length;
    }
  }

  return { newlyFlagged, sessionsInvalidated: newlyFlagged, failed, batches };
}

export async function runCampaignCommand(prisma, options) {
  const startedAt = Date.now();
  const before = await inspectCampaign(prisma, options);
  const applied = options.apply
    ? await applyCampaign(prisma, options)
    : {
        newlyFlagged: 0,
        sessionsInvalidated: 0,
        failed: 0,
        batches: 0,
      };

  return {
    target: options.target,
    campaign: options.campaign,
    mode: options.apply ? "apply" : "dry-run",
    cohort: options.userId ? "single-user" : "all-applicable-users",
    eligibleUsers: before.eligibleUsers,
    wouldFlag: options.apply ? 0 : before.newCandidates,
    newlyFlagged: applied.newlyFlagged,
    alreadyFlaggedForCampaign: before.alreadyFlaggedForCampaign,
    alreadyConfirmedForCampaign: before.alreadyConfirmedForCampaign,
    excludedDeletedOrAnonymized: 0,
    sessionsInvalidated: applied.sessionsInvalidated,
    failed: applied.failed,
    batches: applied.batches,
    durationMs: Date.now() - startedAt,
  };
}

export async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseCommandArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid arguments.");
    console.error(
      "Usage: npm run wellhub:require-plan-confirmation -- --target=dev|uat|prod --campaign=<stable-id> [--apply] [--user-id=<controlled-fixture-id>]"
    );
    return 1;
  }

  let targetConfig;
  try {
    targetConfig = resolveDatabaseTarget({ target: options.target });
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Database target validation failed."
    );
    return 1;
  }

  console.log(
    JSON.stringify(
      {
        target: options.target.toUpperCase(),
        mode: options.apply ? "apply" : "dry-run",
        campaign: options.campaign,
        cohort: options.userId ? "single-user" : "all-applicable-users",
        database: targetConfig.identity,
      },
      null,
      2
    )
  );

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({
    datasources: { db: { url: targetConfig.databaseUrl } },
  });

  try {
    const summary = await runCampaignCommand(prisma, options);
    console.log(JSON.stringify({ summary }, null, 2));
    if (!options.apply) {
      console.log("Dry run only. No users, plans, credits, or sessions changed.");
    }
    return summary.failed === 0 ? 0 : 2;
  } finally {
    await prisma.$disconnect();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = await main();
}
