// src/app/api/users/me/tokens/route.ts
import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthOrDevFallback, getUserIdFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthOrDevFallback(req);
    const userId = auth?.sub || (await getUserIdFromRequest(req));

    // ❌ NO LOGUEADO
    if (!userId) {
      return NextResponse.json(
        {
          tokens: 0,
          authenticated: false,
          affiliation: "NONE",
          bookingBlocked: false,
        },
        { status: 200 }
      );
    }

    // 🔎 afiliación
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { affiliation: true, bookingBlocked: true },
    });

    if (!user) {
      return NextResponse.json(
        {
          tokens: 0,
          authenticated: false,
          affiliation: "NONE",
          bookingBlocked: false,
        },
        { status: 200 }
      );
    }

    const now = new Date();

    // ✅ SALDO REAL DESDE PACKS
    const packs = await prisma.packPurchase.findMany({
      where: {
        userId,
        expiresAt: { gt: now },
        classesLeft: { gt: 0 },
        OR: [{ pausedUntil: null }, { pausedUntil: { lte: now } }],
      },
      select: { classesLeft: true },
    });

    const tokens = packs.reduce((sum, p) => sum + p.classesLeft, 0);

    return NextResponse.json(
      {
        tokens,
        authenticated: true,
        affiliation: user.affiliation ?? "NONE",
        bookingBlocked: user.bookingBlocked,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("GET /api/users/me/tokens error:", err);

    return NextResponse.json(
      {
        tokens: 0,
        authenticated: false,
        affiliation: "NONE",
        bookingBlocked: false,
        error: "TOKENS_FETCH_FAILED",
      },
      { status: 500 }
    );
  }
}
