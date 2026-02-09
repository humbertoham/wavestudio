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

    // ❌ NO LOGUEADO
    if (!userId) {
      return NextResponse.json(
        {
          tokens: 0,
          authenticated: false,
        },
        { status: 200 }
      );
    }

    // ✅ LOGUEADO
    const now = new Date();
    const agg = await prisma.tokenLedger.aggregate({
      where: {
        userId,
        OR: [
          { packPurchaseId: null }, // ADMIN_ADJUST
          { packPurchase: { expiresAt: { gt: now } } }, // paquetes vigentes
        ],
      },
      _sum: { delta: true },
    });

    const tokens = Math.max(0, agg._sum.delta ?? 0);

    return NextResponse.json(
      {
        tokens,
        authenticated: true,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("GET /api/users/me/tokens error:", err);
    return NextResponse.json(
      {
        tokens: 0,
        authenticated: false,
        error: "TOKENS_FETCH_FAILED",
      },
      { status: 500 }
    );
  }
}
