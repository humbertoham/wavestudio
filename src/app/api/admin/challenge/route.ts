import { NextRequest, NextResponse } from "next/server";

import {
  activateChallenge,
  challengeErrorResponse,
  deactivateChallenge,
  getChallengeStatus,
} from "@/lib/challenge";
import { requireChallengeAdmin } from "./_auth";

export const runtime = "nodejs";

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(req: NextRequest) {
  const auth = await requireChallengeAdmin(req);
  if (!auth.ok) return auth.response;

  return noStore({ challenge: await getChallengeStatus() });
}

export async function POST(req: NextRequest) {
  const auth = await requireChallengeAdmin(req);
  if (!auth.ok) return auth.response;

  try {
    const challenge = await activateChallenge(auth.user.id);
    return noStore({
      challenge: {
        id: challenge.id,
        name: challenge.name,
        active: challenge.isActive,
        activationVersion: challenge.activationVersion,
        activatedAt: challenge.activatedAt,
        deactivatedAt: challenge.deactivatedAt,
      },
    });
  } catch (error) {
    const known = challengeErrorResponse(error);
    if (known) return noStore(known.body, known.status);

    console.error("POST /api/admin/challenge error", error);
    return noStore(
      { error: "CHALLENGE_ACTIVATION_FAILED", message: "No se pudo activar el Challenge." },
      500
    );
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireChallengeAdmin(req);
  if (!auth.ok) return auth.response;

  try {
    const challenge = await deactivateChallenge(auth.user.id);
    return noStore({
      challenge: {
        id: challenge.id,
        name: challenge.name,
        active: challenge.isActive,
        activationVersion: challenge.activationVersion,
        activatedAt: challenge.activatedAt,
        deactivatedAt: challenge.deactivatedAt,
      },
    });
  } catch (error) {
    const known = challengeErrorResponse(error);
    if (known) return noStore(known.body, known.status);

    console.error("DELETE /api/admin/challenge error", error);
    return noStore(
      { error: "CHALLENGE_DEACTIVATION_FAILED", message: "No se pudo desactivar el Challenge." },
      500
    );
  }
}
