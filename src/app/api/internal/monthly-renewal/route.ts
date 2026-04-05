// src/app/api/internal/monthly-renewal/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { TokenReason, Affiliation, Prisma } from "@prisma/client";

export const runtime = "nodejs";

// IDs estables para packs internos (no visibles)
const WELLHUB_PACK_ID = "corp_wellhub_monthly";
const TOTALPASS_PACK_ID = "corp_totalpass_monthly";

async function ensureCorporatePacks() {
  // Pack mensual Wellhub
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

  // Pack mensual TotalPass
  await prisma.pack.upsert({
    where: { id: TOTALPASS_PACK_ID },
    update: {
      name: "TotalPass Mensual (Interno)",
      classes: 10,
      price: 0,
      validityDays: 31,
      isActive: true,
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
      isActive: true,
      isVisible: false,
      oncePerUser: false,
      classesLabel: "10 clases",
    },
  });
}

export async function GET() {
  if (process.env.VERCEL !== "1") {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const now = new Date();

  // Solo día 1 (UTC como ya lo traías)
  if (now.getUTCDate() !== 1) {
    return NextResponse.json(
      { ok: false, message: "Solo puede ejecutarse el día 1" },
      { status: 400 }
    );
  }

  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  const firstDay = new Date(Date.UTC(year, month, 1));
  const nextMonth = new Date(Date.UTC(year, month + 1, 1));

  // Asegurar packs internos
  await ensureCorporatePacks();

  // Evita doble ejecución (global para el mes)
  const alreadyRun = await prisma.tokenLedger.findFirst({
    where: {
      reason: TokenReason.CORPORATE_MONTHLY,
      createdAt: {
        gte: firstDay,
        lt: nextMonth,
      },
    },
  });

  if (alreadyRun) {
    return NextResponse.json({
      ok: false,
      message: "Ya ejecutado este mes",
    });
  }

  const users = await prisma.user.findMany({
    where: {
      affiliation: { in: [Affiliation.WELLHUB, Affiliation.TOTALPASS] },
    },
    select: { id: true, affiliation: true },
  });

  let renewed = 0;

  for (const user of users) {
    await prisma.$transaction(
      async (tx) => {
        // 1) Expirar cualquier compra corporativa previa (reset mensual)
        //    OJO: no necesitamos "restar" classesLeft; basta con expirar,
        //    porque el saldo real ignora expiresAt <= now.
        await tx.packPurchase.updateMany({
          where: {
            userId: user.id,
            packId: { in: [WELLHUB_PACK_ID, TOTALPASS_PACK_ID] },
            expiresAt: { gt: firstDay }, // si seguía vigente, la cortamos al inicio del mes
          },
          data: {
            expiresAt: firstDay,
          },
        });

        // 2) Crear la compra corporativa del mes (como PackPurchase)
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
            expiresAt: nextMonth, // expira al iniciar el próximo mes
            // paymentId: null (implícito)
          },
          select: { id: true },
        });

        // 3) Registrar en ledger SOLO como auditoría
        await tx.tokenLedger.create({
          data: {
            userId: user.id,
            packPurchaseId: purchase.id,
            delta: monthlyAmount,
            reason: TokenReason.CORPORATE_MONTHLY,
          },
        });

        renewed += 1;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  return NextResponse.json({
    ok: true,
    renewedUsers: renewed,
  });
}