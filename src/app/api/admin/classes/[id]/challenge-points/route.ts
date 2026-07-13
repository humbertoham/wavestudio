import { NextRequest, NextResponse } from "next/server";

import {
  challengeErrorResponse,
  setClassChallengePoints,
} from "@/lib/challenge";
import { requireChallengeAdmin } from "@/app/api/admin/challenge/_auth";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, ctx: Ctx) {
  const auth = await requireChallengeAdmin(req);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const points =
    body && typeof body === "object" && "points" in body
      ? (body as { points?: unknown }).points
      : undefined;

  try {
    const { id } = await ctx.params;
    const item = await setClassChallengePoints(id, points);
    return NextResponse.json(
      { item },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const known = challengeErrorResponse(error);
    if (known) {
      return NextResponse.json(known.body, {
        status: known.status,
        headers: { "Cache-Control": "no-store" },
      });
    }

    console.error("PUT /api/admin/classes/:id/challenge-points error", error);
    return NextResponse.json(
      {
        error: "CHALLENGE_POINTS_UPDATE_FAILED",
        message: "No se pudieron actualizar los puntos del Challenge.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
