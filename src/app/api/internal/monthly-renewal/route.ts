import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { Affiliation, Prisma, TokenReason } from "@prisma/client";

import {
  buildCorporateRenewalIdempotencyKey,
  getAvailableTokenBalance,
  type RenewalCycle,
} from "@/lib/corporate-credits";
import { getOptionalServerEnv } from "@/lib/env";
import { getMonthlyRenewalPeriod } from "@/lib/package-expiration";
import { prisma } from "@/lib/prisma";
import {
  CORPORATE_INTERNAL_PACK_IDS,
  ensureCorporatePacks,
  getCorporateGrantConfig,
} from "@/lib/wellhub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SERIALIZABLE_RETRIES = 3;

type UserRenewalResult =
  | {
      status: "GRANTED";
      affiliation: Affiliation;
      wellhubPlan: string | null;
      classesGranted: number;
      tokenBalance: number;
    }
  | {
      status:
        | "ALREADY_RENEWED"
        | "USER_NOT_FOUND"
        | "INELIGIBLE_AFFILIATION";
      affiliation: Affiliation | null;
      wellhubPlan: string | null;
    };

function validateCronRequest(authHeader: string | null) {
  const secret = getOptionalServerEnv("CRON_SECRET");
  if (!secret) {
    console.error("CRON_SECRET is not configured for monthly renewal.");
    return null;
  }

  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from((authHeader ?? "").trim());

  if (expected.length !== received.length) {
    return false;
  }

  return timingSafeEqual(expected, received);
}

function isRetryableTransactionError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

function isUniqueIdempotencyError(error: unknown) {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002"
  ) {
    return false;
  }

  const target = error.meta?.target;
  return Array.isArray(target)
    ? target.includes("idempotencyKey")
    : String(target ?? "").includes("idempotencyKey");
}

function corporateRenewalMetadata(params: {
  cycle: RenewalCycle;
  affiliation: Affiliation;
  wellhubPlan: string | null;
  classesGranted: number;
  tokenBalance: number;
  idempotencyKey: string;
  timestamp: Date;
}) {
  return {
    source: "MONTHLY_CORPORATE_RENEWAL",
    cycleId: params.cycle.id,
    effectivePeriodStart: params.cycle.start.toISOString(),
    effectivePeriodEnd: params.cycle.end.toISOString(),
    affiliation: params.affiliation,
    wellhubPlan: params.wellhubPlan ?? "NONE",
    monthlyEntitlement: params.classesGranted,
    creditDeltaApplied: params.classesGranted,
    resultingAvailableBalance: params.tokenBalance,
    idempotencyKey: params.idempotencyKey,
    timestamp: params.timestamp.toISOString(),
  } satisfies Prisma.InputJsonObject;
}

async function renewOneUser(
  userId: string,
  cycle: RenewalCycle,
  now: Date
): Promise<UserRenewalResult> {
  const idempotencyKey = buildCorporateRenewalIdempotencyKey(cycle.id, userId);

  for (let attempt = 1; attempt <= MAX_SERIALIZABLE_RETRIES; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const currentUser = await tx.user.findUnique({
            where: { id: userId },
            select: { affiliation: true, wellhubPlan: true },
          });

          if (!currentUser) {
            return {
              status: "USER_NOT_FOUND",
              affiliation: null,
              wellhubPlan: null,
            };
          }

          const currentGrant = getCorporateGrantConfig(
            currentUser.affiliation,
            currentUser.wellhubPlan
          );
          if (!currentGrant) {
            return {
              status: "INELIGIBLE_AFFILIATION",
              affiliation: currentUser.affiliation,
              wellhubPlan: currentUser.wellhubPlan,
            };
          }

          const existingByKey = await tx.tokenLedger.findUnique({
            where: { idempotencyKey },
            select: { id: true },
          });

          if (existingByKey) {
            return {
              status: "ALREADY_RENEWED",
              affiliation: currentUser.affiliation,
              wellhubPlan: currentUser.wellhubPlan,
            };
          }

          const existingLegacyRenewal = await tx.tokenLedger.findFirst({
            where: {
              userId,
              reason: TokenReason.CORPORATE_MONTHLY,
              createdAt: {
                gte: cycle.start,
                lt: cycle.end,
              },
            },
            select: { id: true },
          });

          if (existingLegacyRenewal) {
            return {
              status: "ALREADY_RENEWED",
              affiliation: currentUser.affiliation,
              wellhubPlan: currentUser.wellhubPlan,
            };
          }

          await tx.packPurchase.updateMany({
            where: {
              userId,
              packId: { in: CORPORATE_INTERNAL_PACK_IDS },
              expiresAt: { gt: cycle.start },
            },
            data: {
              expiresAt: cycle.start,
            },
          });

          const purchase = await tx.packPurchase.create({
            data: {
              userId,
              packId: currentGrant.packId,
              classesLeft: currentGrant.classesGranted,
              expiresAt: cycle.end,
            },
            select: { id: true },
          });

          const tokenBalance = await getAvailableTokenBalance(tx, userId, now);

          await tx.tokenLedger.create({
            data: {
              userId,
              packPurchaseId: purchase.id,
              delta: currentGrant.classesGranted,
              reason: TokenReason.CORPORATE_MONTHLY,
              idempotencyKey,
              metadata: corporateRenewalMetadata({
                cycle,
                affiliation: currentUser.affiliation,
                wellhubPlan: currentUser.wellhubPlan,
                classesGranted: currentGrant.classesGranted,
                tokenBalance,
                idempotencyKey,
                timestamp: now,
              }),
            },
          });

          return {
            status: "GRANTED",
            affiliation: currentUser.affiliation,
            wellhubPlan: currentUser.wellhubPlan,
            classesGranted: currentGrant.classesGranted,
            tokenBalance,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (error) {
      if (isUniqueIdempotencyError(error)) {
        return {
          status: "ALREADY_RENEWED",
          affiliation: null,
          wellhubPlan: null,
        };
      }

      if (isRetryableTransactionError(error) && attempt < MAX_SERIALIZABLE_RETRIES) {
        continue;
      }

      throw error;
    }
  }

  throw new Error("RENEWAL_CONFLICT");
}

export async function GET(req: Request) {
  const isAuthorized = validateCronRequest(req.headers.get("authorization"));
  if (isAuthorized == null) {
    return NextResponse.json(
      { ok: false, message: "CRON_SECRET_MISSING" },
      { status: 500 }
    );
  }

  if (!isAuthorized) {
    return NextResponse.json(
      { ok: false, message: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  const now = new Date();
  const period = getMonthlyRenewalPeriod(now);
  if (!period.isAllowedRunWindow) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Solo puede ejecutarse al cierre de mes 23:00 o el dia 1 en America/Monterrey",
        businessTimeZone: period.businessTimeZone,
      },
      { status: 400 }
    );
  }

  const cycle: RenewalCycle = {
    id: period.periodKey,
    start: period.periodStart,
    end: period.expiresAt,
  };

  console.info("[monthly-renewal] job_started", {
    periodKey: period.periodKey,
    trigger: period.trigger,
    businessTimeZone: period.businessTimeZone,
    periodStart: period.periodStart.toISOString(),
    expiresAt: period.expiresAt.toISOString(),
  });

  await ensureCorporatePacks(prisma);

  const users = await prisma.user.findMany({
    select: { id: true },
  });

  const summary = {
    processed: 0,
    granted: 0,
    skipped: 0,
    alreadyRenewed: 0,
    failed: 0,
    skippedNoneAffiliation: 0,
    skippedInvalidAffiliation: 0,
    skippedUserMissing: 0,
  };

  for (const user of users) {
    summary.processed += 1;

    try {
      const result = await renewOneUser(user.id, cycle, now);

      if (result.status === "GRANTED") {
        summary.granted += 1;
        console.info("[monthly-renewal] granted", {
          userId: user.id,
          cycleId: cycle.id,
          affiliation: result.affiliation,
          wellhubPlan: result.wellhubPlan,
          classesGranted: result.classesGranted,
          tokenBalance: result.tokenBalance,
        });
        continue;
      }

      summary.skipped += 1;

      if (result.status === "ALREADY_RENEWED") {
        summary.alreadyRenewed += 1;
      } else if (result.status === "USER_NOT_FOUND") {
        summary.skippedUserMissing += 1;
      } else if (result.status === "INELIGIBLE_AFFILIATION") {
        if (result.affiliation === Affiliation.NONE) {
          summary.skippedNoneAffiliation += 1;
        } else {
          summary.skippedInvalidAffiliation += 1;
        }

        console.info("[monthly-renewal] skipped_ineligible_affiliation", {
          userId: user.id,
          cycleId: cycle.id,
          affiliation: result.affiliation,
          wellhubPlan: result.wellhubPlan,
        });
      }
    } catch (error) {
      summary.failed += 1;

      console.error("[monthly-renewal] user_failed", {
        userId: user.id,
        cycleId: cycle.id,
        code:
          error instanceof Prisma.PrismaClientKnownRequestError
            ? error.code
            : "UNKNOWN",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  console.info("[monthly-renewal] summary", {
    cycleId: cycle.id,
    ...summary,
  });

  return NextResponse.json({
    ok: summary.failed === 0,
    cycleId: cycle.id,
    ...summary,
    renewedUsers: summary.granted,
    skippedUsers: summary.skipped,
    skippedAlreadyRenewed: summary.alreadyRenewed,
  });
}
