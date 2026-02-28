// src/app/api/internal/monthly-renewal/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { TokenReason, Affiliation } from "@prisma/client";

export const runtime = "nodejs";

export async function GET() {
  if (process.env.VERCEL !== "1") {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const now = new Date();

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

  // Evita doble ejecución
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
  });

  for (const user of users) {
    await prisma.$transaction(async (tx) => {
      // 🔹 Balance total actual
      const totalAgg = await tx.tokenLedger.aggregate({
        where: { userId: user.id },
        _sum: { delta: true },
      });

      const totalBalance = totalAgg._sum.delta ?? 0;

      // 🔹 Total otorgado por corporate en toda la historia
      const corporateAgg = await tx.tokenLedger.aggregate({
        where: {
          userId: user.id,
          reason: TokenReason.CORPORATE_MONTHLY,
        },
        _sum: { delta: true },
      });

      const totalCorporateGranted = corporateAgg._sum.delta ?? 0;

      // 🔹 Total comprado por packs
      const packAgg = await tx.tokenLedger.aggregate({
        where: {
          userId: user.id,
          reason: TokenReason.PURCHASE_CREDIT,
        },
        _sum: { delta: true },
      });

      const totalPackGranted = packAgg._sum.delta ?? 0;

      // 🔹 Estimación saldo corporativo restante
      const estimatedCorporateBalance = Math.max(
        0,
        totalBalance - totalPackGranted
      );

      // 🔥 Restar solo el remanente corporativo
      if (estimatedCorporateBalance > 0) {
        await tx.tokenLedger.create({
          data: {
            userId: user.id,
            delta: -estimatedCorporateBalance,
            reason: TokenReason.ADMIN_ADJUST,
          },
        });
      }

      // 🔹 Asignar nuevos créditos del mes
      const monthlyAmount =
        user.affiliation === Affiliation.WELLHUB ? 15 : 10;

      await tx.tokenLedger.create({
        data: {
          userId: user.id,
          delta: monthlyAmount,
          reason: TokenReason.CORPORATE_MONTHLY,
        },
      });
    });
  }

  return NextResponse.json({
    ok: true,
    renewedUsers: users.length,
  });
}