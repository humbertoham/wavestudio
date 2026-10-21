import { NextRequest, NextResponse } from "next/server";
import { getAuthFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export async function GET(req: NextRequest) {
  const auth = await getAuthFromRequest(req);
  if (!auth?.sub)
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const now = new Date();
  const [purchases, usages] = await prisma.$transaction([
    prisma.packPurchase.findMany({
      where: { userId: auth.sub, type: "MONTHLY_UNLIMITED" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        nameSnapshot: true,
        unlimitedMonth: true,
        unlimitedYear: true,
        expiresAt: true,
        revokedAt: true,
        pausedUntil: true,
      },
    }),
    prisma.unlimitedUsage.findMany({
      where: { userId: auth.sub, releasedAt: null },
      select: { serviceDate: true },
    }),
  ]);
  return NextResponse.json(
    {
      purchases: purchases.map((p) => ({
        id: p.id,
        name: p.nameSnapshot,
        month: p.unlimitedMonth,
        year: p.unlimitedYear,
        available:
          !p.revokedAt &&
          p.expiresAt > now &&
          (!p.pausedUntil || p.pausedUntil <= now),
      })),
      consumedDates: usages.map((u) =>
        u.serviceDate.toISOString().slice(0, 10),
      ),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
