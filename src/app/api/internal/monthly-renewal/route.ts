import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { Affiliation, Prisma, TokenReason } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const WELLHUB_PACK_ID = "corp_wellhub_monthly";
const TOTALPASS_PACK_ID = "corp_totalpass_monthly";
const MAX_SERIALIZABLE_RETRIES = 3;

async function ensureCorporatePacks() {
  await prisma.pack.upsert({
    where: { id: WELLHUB_PACK_ID },
    update: {
      name: "Wellhub Mensual (Interno)",
      classes: 15,
      price: 0,
      validityDays: 31,
      isActive: false,
      isVisible: false,
      oncePerUser: false,
      classesLabel: "15 clases",
    },
    create: {
      id: WELLHUB_PACK_ID,
      name: "Wellhub Mensual (Interno)",
      classes: 15,
      price: 0,
      validityDays: 31,
      isActive: false,
      isVisible: false,
      oncePerUser: false,
      classesLabel: "15 clases",
    },
  });

  await prisma.pack.upsert({
    where: { id: TOTALPASS_PACK_ID },
    update: {
      name: "TotalPass Mensual (Interno)",
      classes: 10,
      price: 0,
      validityDays: 31,
      isActive: false,
      isVisible: false,
      oncePerUser: false,
      classesLabel: "10 clases",
    },
    create: {
      id: TOTALPASS_PACK_ID,
      name: "TotalPass Mensual (Interno)",
      classes: 10,
      price: 0,
      validityDays: 31,
      isActive: false,
      isVisible: false,
      oncePerUser: false,
      classesLabel: "10 clases",
    },
  });
}

function validateCronRequest(authHeader: string | null) {
  const secret = process.env.CRON_SECRET?.trim();
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

  await ensureCorporatePacks();

  const users = await prisma.user.findMany({
    where: {
      affiliation: { in: [Affiliation.WELLHUB, Affiliation.TOTALPASS] },
    },
    select: { id: true, affiliation: true },
  });

  let renewedUsers = 0;
  let skippedUsers = 0;

  for (const user of users) {
    let processed = false;

    for (let attempt = 1; attempt <= MAX_SERIALIZABLE_RETRIES; attempt += 1) {
      try {
        const result = await prisma.$transaction(
          async (tx) => {
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
              return { renewed: false };
            }

            await tx.packPurchase.updateMany({
              where: {
                userId: user.id,
                packId: { in: [WELLHUB_PACK_ID, TOTALPASS_PACK_ID] },
                expiresAt: { gt: firstDay },
              },
              data: {
                expiresAt: firstDay,
              },
            });

            const monthlyAmount =
              user.affiliation === Affiliation.WELLHUB ? 15 : 10;
            const packId =
              user.affiliation === Affiliation.WELLHUB
                ? WELLHUB_PACK_ID
                : TOTALPASS_PACK_ID;

            const purchase = await tx.packPurchase.create({
              data: {
                userId: user.id,
                packId,
                classesLeft: monthlyAmount,
                expiresAt: nextMonth,
              },
              select: { id: true },
            });

            await tx.tokenLedger.create({
              data: {
                userId: user.id,
                packPurchaseId: purchase.id,
                delta: monthlyAmount,
                reason: TokenReason.CORPORATE_MONTHLY,
              },
            });

            return { renewed: true };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        );

        if (result.renewed) {
          renewedUsers += 1;
        } else {
          skippedUsers += 1;
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
        },
        { status: 409 }
      );
    }
  }

  return NextResponse.json({
    ok: true,
    renewedUsers,
    skippedUsers,
  });
}
