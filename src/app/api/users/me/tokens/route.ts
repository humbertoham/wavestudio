// src/app/api/users/me/tokens/route.ts
import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthOrDevFallback, getUserIdFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    // Intenta sesión real; si no hay, usa fallbacks (x-user-id / ?userId=)
    const auth = await getAuthOrDevFallback(req);
    const userId = auth?.sub || (await getUserIdFromRequest(req));

    if (!userId) {
      // sin sesión ni fallback => 0 para no romper UI
      return NextResponse.json({ tokens: 0 }, { status: 200 });
    }

    const now = new Date();
    const agg = await prisma.tokenLedger.aggregate({
      where: {
        userId,
        OR: [
          { packPurchaseId: null },
          { packPurchase: { expiresAt: { gt: now } } },
        ],
      },
      _sum: { delta: true },
    });

    const tokens = Math.max(0, agg._sum.delta ?? 0);
    return NextResponse.json({ tokens }, { status: 200 });
  } catch (err) {
    console.error("GET /api/users/me/tokens error:", err);
    return NextResponse.json(
      { tokens: 0, error: "TOKENS_FETCH_FAILED" },
      { status: 500 }
    );
  }
}
