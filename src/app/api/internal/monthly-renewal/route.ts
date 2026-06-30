import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { Affiliation, Prisma, TokenReason } from "@prisma/client";

import { getOptionalServerEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import {
  CORPORATE_INTERNAL_PACK_IDS,
  ensureCorporatePacks,
  getCorporateGrantConfig,
} from "@/lib/wellhub";

export const runtime = "nodejs";

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

  const now = new Date();
  if (now.getUTCDate() !== 1) {
    return NextResponse.json(
      { ok: false, message: "Solo puede ejecutarse el dia 1" },
      { status: 400 }
    );
  }

  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const firstDay = new Date(Date.UTC(year, month, 1));
  const nextMonth = new Date(Date.UTC(year, month + 1, 1));

  await ensureCorporatePacks(prisma);

  const users = await prisma.user.findMany({
    select: { id: true, affiliation: true, wellhubPlan: true },
  });

  let renewedUsers = 0;
  let skippedUsers = 0;
  let skippedNoneAffiliation = 0;
  let skippedInvalidAffiliation = 0;
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
              };
            }

            const existingRenewal = await tx.tokenLedger.findFirst({
              where: {
                userId: user.id,
                reason: TokenReason.CORPORATE_MONTHLY,
                createdAt: {
                  gte: firstDay,
                  lt: nextMonth,
                },
              },
              select: { id: true },
            });

            if (existingRenewal) {
              return {
                renewed: false,
                skipReason: "ALREADY_RENEWED" as const,
                affiliation: currentUser.affiliation,
              };
            }

            await tx.packPurchase.updateMany({
              where: {
                userId: user.id,
                packId: { in: CORPORATE_INTERNAL_PACK_IDS },
                expiresAt: { gt: firstDay },
              },
              data: {
                expiresAt: firstDay,
              },
            });

            const purchase = await tx.packPurchase.create({
              data: {
                userId: user.id,
                packId: currentGrant.packId,
                classesLeft: currentGrant.classesGranted,
                expiresAt: nextMonth,
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
    skippedAlreadyRenewed,
    skippedUserMissing,
  });

  return NextResponse.json({
    ok: true,
    renewedUsers,
    skippedUsers,
    skippedNoneAffiliation,
    skippedInvalidAffiliation,
    skippedAlreadyRenewed,
    skippedUserMissing,
  });
}
