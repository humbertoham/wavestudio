import { NextRequest, NextResponse } from "next/server";

import { getAuthFromRequest } from "@/lib/auth";
import { getChallengeStatus } from "@/lib/challenge";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await getAuthFromRequest(req);
  const userId = auth?.sub ? String(auth.sub) : null;

  if (!userId) {
    return NextResponse.json(
      { error: "UNAUTHORIZED", code: "UNAUTHORIZED" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  const challenge = await getChallengeStatus(userId);

  return NextResponse.json(
    {
      active: challenge.active,
      name: challenge.name,
      points: challenge.points,
      activatedAt: challenge.active ? challenge.activatedAt : null,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
