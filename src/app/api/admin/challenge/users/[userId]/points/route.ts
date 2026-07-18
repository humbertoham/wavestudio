import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireChallengeAdmin } from "@/app/api/admin/challenge/_auth";
import {
  CHALLENGE_USER_MAX_POINTS,
  challengeErrorResponse,
  setUserChallengePoints,
} from "@/lib/challenge";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ userId: string }> };

const userIdSchema = z.string().trim().min(1).max(128);
const pointsSchema = z.number().int().min(0).max(CHALLENGE_USER_MAX_POINTS);
const bodySchema = z
  .object({
    points: pointsSchema,
    expectedPoints: pointsSchema,
    expectedUpdatedAt: z.string().datetime().nullable(),
  })
  .strict();

function json(status: number, body: unknown) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const auth = await requireChallengeAdmin(req);
  if (!auth.ok) return auth.response;

  const { userId: rawUserId } = await ctx.params;
  const userId = userIdSchema.safeParse(rawUserId);
  if (!userId.success) {
    return json(400, {
      error: "INVALID_USER_ID",
      code: "INVALID_USER_ID",
      message: "El identificador del usuario no es valido.",
    });
  }

  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return json(400, {
      error: "INVALID_USER_CHALLENGE_POINTS",
      code: "INVALID_USER_CHALLENGE_POINTS",
      message: `Los puntos deben ser un numero entero entre 0 y ${CHALLENGE_USER_MAX_POINTS.toLocaleString("es-MX")}.`,
    });
  }

  try {
    const item = await setUserChallengePoints({
      userId: userId.data,
      actorUserId: auth.user.id,
      points: body.data.points,
      expectedPoints: body.data.expectedPoints,
      expectedUpdatedAt: body.data.expectedUpdatedAt
        ? new Date(body.data.expectedUpdatedAt)
        : null,
    });
    return json(200, { item });
  } catch (error) {
    const known = challengeErrorResponse(error);
    if (known) return json(known.status, known.body);

    console.error("PATCH /api/admin/challenge/users/:userId/points failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return json(500, {
      error: "CHALLENGE_POINTS_UPDATE_FAILED",
      code: "CHALLENGE_POINTS_UPDATE_FAILED",
      message: "No se pudieron actualizar los puntos del Challenge.",
    });
  }
}
