// src/app/api/users/me/tokens/route.ts
import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthFromRequest } from "@/lib/auth";
import { getChallengeStatus } from "@/lib/challenge";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthFromRequest(req);
    const userId = auth?.sub ?? null;

    // ❌ NO LOGUEADO
    if (!userId) {
      return NextResponse.json(
        {
          tokens: 0,
          authenticated: false,
          affiliation: "NONE",
          wellhubPlan: null,
          bookingBlocked: false,
          challenge: { active: false, points: 0 },
        },
        { status: 200 }
      );
    }

    // 🔎 afiliación
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { affiliation: true, wellhubPlan: true, bookingBlocked: true },
    });

    if (!user) {
      return NextResponse.json(
        {
          tokens: 0,
          authenticated: false,
          affiliation: "NONE",
          wellhubPlan: null,
          bookingBlocked: false,
          challenge: { active: false, points: 0 },
        },
        { status: 200 }
      );
    }

    const now = new Date();

    // ✅ SALDO REAL DESDE PACKS
    const [packs, challenge] = await Promise.all([
      prisma.packPurchase.findMany({
        where: {
          userId,
          expiresAt: { gt: now },
          classesLeft: { gt: 0 },
          OR: [{ pausedUntil: null }, { pausedUntil: { lte: now } }],
        },
        select: { classesLeft: true },
      }),
      getChallengeStatus(userId),
    ]);

    const tokens = packs.reduce((sum, p) => sum + p.classesLeft, 0);

    return NextResponse.json(
      {
        tokens,
        authenticated: true,
        affiliation: user.affiliation ?? "NONE",
        wellhubPlan: user.wellhubPlan ?? null,
        bookingBlocked: user.bookingBlocked,
        challenge: {
          active: challenge.active,
          points: challenge.points,
        },
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
        wellhubPlan: null,
        bookingBlocked: false,
        challenge: { active: false, points: 0 },
        error: "TOKENS_FETCH_FAILED",
      },
      { status: 500 }
    );
  }
}
