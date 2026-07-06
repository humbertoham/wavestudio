import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { Affiliation, Prisma, TokenReason } from "@prisma/client";

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

  const period = getMonthlyRenewalPeriod();
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

  console.info("[monthly-renewal] job_started", {
    periodKey: period.periodKey,
    trigger: period.trigger,
    businessTimeZone: period.businessTimeZone,
    periodStart: period.periodStart.toISOString(),
    expiresAt: period.expiresAt.toISOString(),
  });

  await ensureCorporatePacks(prisma);

  const users = await prisma.user.findMany({
    select: { id: true, affiliation: true, wellhubPlan: true },
  });

  const eligibleUsers = users.filter((user) =>
    getCorporateGrantConfig(user.affiliation, user.wellhubPlan)
  ).length;

  console.info("[monthly-renewal] users_loaded", {
    totalUsers: users.length,
    eligibleUsers,
    periodKey: period.periodKey,
  });

  let renewedUsers = 0;
  let skippedUsers = 0;
  let skippedNoneAffiliation = 0;
  let skippedInvalidAffiliation = 0;
  let skippedMissingWellhubPlan = 0;
  let skippedAlreadyRenewed = 0;
  let skippedUserMissing = 0;

  for (const user of users) {
    let processed = false;
    const initialGrant = getCorporateGrantConfig(
      user.affiliation,
      user.wellhubPlan
    );

    if (!initialGrant) {
      skippedUsers += 1;

      if (user.affiliation === Affiliation.NONE) {
        skippedNoneAffiliation += 1;
      } else if (user.affiliation === Affiliation.WELLHUB && !user.wellhubPlan) {
        skippedMissingWellhubPlan += 1;
      } else {
        skippedInvalidAffiliation += 1;
      }

      console.info("[monthly-renewal] skipped_ineligible_affiliation", {
        userId: user.id,
        affiliation: user.affiliation,
      });
      continue;
    }

    for (let attempt = 1; attempt <= MAX_SERIALIZABLE_RETRIES; attempt += 1) {
      try {
        const result = await prisma.$transaction(
          async (tx) => {
            const currentUser = await tx.user.findUnique({
              where: { id: user.id },
              select: { affiliation: true, wellhubPlan: true },
            });

            if (!currentUser) {
              return {
                renewed: false,
                skipReason: "USER_NOT_FOUND" as const,
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
                renewed: false,
                skipReason: "INELIGIBLE_AFFILIATION" as const,
                affiliation: currentUser.affiliation,
                wellhubPlan: currentUser.wellhubPlan,
              };
            }

            const existingRenewal = await tx.tokenLedger.findFirst({
              where: {
                userId: user.id,
                reason: TokenReason.CORPORATE_MONTHLY,
                createdAt: {
                  gte: period.renewalWindowStart,
                  lt: period.nextPeriodStart,
                },
              },
              select: { id: true },
            });

            if (existingRenewal) {
              return {
                renewed: false,
                skipReason: "ALREADY_RENEWED" as const,
                affiliation: currentUser.affiliation,
                wellhubPlan: currentUser.wellhubPlan,
              };
            }

            await tx.packPurchase.updateMany({
              where: {
                userId: user.id,
                packId: { in: CORPORATE_INTERNAL_PACK_IDS },
                expiresAt: { gt: period.previousPeriodExpiresAt },
              },
              data: {
                expiresAt: period.previousPeriodExpiresAt,
              },
            });

            const purchase = await tx.packPurchase.create({
              data: {
                userId: user.id,
                packId: currentGrant.packId,
                classesLeft: currentGrant.classesGranted,
                expiresAt: period.expiresAt,
              },
              select: { id: true },
            });

            await tx.tokenLedger.create({
              data: {
                userId: user.id,
                packPurchaseId: purchase.id,
                delta: currentGrant.classesGranted,
                reason: TokenReason.CORPORATE_MONTHLY,
              },
            });

            return {
              renewed: true,
              skipReason: null,
              affiliation: currentUser.affiliation,
              wellhubPlan: currentUser.wellhubPlan,
            };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        );

        if (result.renewed) {
          renewedUsers += 1;
        } else {
          skippedUsers += 1;

          if (result.skipReason === "ALREADY_RENEWED") {
            skippedAlreadyRenewed += 1;
          } else if (result.skipReason === "USER_NOT_FOUND") {
            skippedUserMissing += 1;
          } else if (result.skipReason === "INELIGIBLE_AFFILIATION") {
            if (result.affiliation === Affiliation.NONE) {
              skippedNoneAffiliation += 1;
            } else if (
              result.affiliation === Affiliation.WELLHUB &&
              !result.wellhubPlan
            ) {
              skippedMissingWellhubPlan += 1;
            } else {
              skippedInvalidAffiliation += 1;
            }

            console.info("[monthly-renewal] skipped_current_affiliation", {
              userId: user.id,
              affiliation: result.affiliation,
            });
          }
        }

        processed = true;
        break;
      } catch (error) {
        if (isRetryableTransactionError(error) && attempt < MAX_SERIALIZABLE_RETRIES) {
          continue;
        }

        throw error;
      }
    }

    if (!processed) {
      return NextResponse.json(
        {
          ok: false,
          message: "RENEWAL_CONFLICT",
          renewedUsers,
          skippedUsers,
          skippedNoneAffiliation,
          skippedInvalidAffiliation,
          skippedMissingWellhubPlan,
          skippedAlreadyRenewed,
          skippedUserMissing,
        },
        { status: 409 }
      );
    }
  }

  console.info("[monthly-renewal] summary", {
    renewedUsers,
    skippedUsers,
    skippedNoneAffiliation,
    skippedInvalidAffiliation,
    skippedMissingWellhubPlan,
    skippedAlreadyRenewed,
    skippedUserMissing,
    periodKey: period.periodKey,
  });

  return NextResponse.json({
    ok: true,
    periodKey: period.periodKey,
    businessTimeZone: period.businessTimeZone,
    expiresAt: period.expiresAt.toISOString(),
    renewedUsers,
    skippedUsers,
    skippedNoneAffiliation,
    skippedInvalidAffiliation,
    skippedMissingWellhubPlan,
    skippedAlreadyRenewed,
    skippedUserMissing,
  });
}
