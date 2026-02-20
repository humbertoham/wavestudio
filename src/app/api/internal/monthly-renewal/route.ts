import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  // Solo permitir ejecución en producción Vercel
  if (process.env.VERCEL !== "1") {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const now = new Date();

  
  const users = await prisma.user.findMany({
    where: {
      affiliation: { in: ["WELLHUB", "TOTALPASS"] },
    },
  });

  for (const user of users) {
    await prisma.$transaction(async (tx) => {
      const agg = await tx.tokenLedger.aggregate({
        where: { userId: user.id },
        _sum: { delta: true },
      });

      const balance = agg._sum.delta ?? 0;

      if (balance !== 0) {
        await tx.tokenLedger.create({
          data: {
            userId: user.id,
            delta: -balance,
            reason: "ADMIN_ADJUST",
          },
        });
      }

      const monthlyAmount =
        user.affiliation === "WELLHUB" ? 15 : 10;

      await tx.tokenLedger.create({
        data: {
          userId: user.id,
          delta: monthlyAmount,
          reason: "CORPORATE_MONTHLY",
        },
      });
    });
  }

  return NextResponse.json({
    ok: true,
    renewedUsers: users.length,
  });
}
