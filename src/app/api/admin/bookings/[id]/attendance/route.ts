import { NextRequest, NextResponse } from "next/server";
import { getUserFromSession, requireClassManager } from "../../../_utils";
import {
  challengeErrorResponse,
  updateAttendanceWithChallenge,
} from "@/lib/challenge";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const auth = await requireClassManager(req);
  if (auth) return auth;

  const actor = await getUserFromSession(req);
  if (!actor) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const { attended } = await req.json();

  if (typeof attended !== "boolean") {
    return NextResponse.json(
      { error: "INVALID_ATTENDED_VALUE" },
      { status: 400 }
    );
  }

  try {
    return NextResponse.json(
      await updateAttendanceWithChallenge({
        bookingId: id,
        attended,
        actorUserId: actor.id,
      })
    );
  } catch (error) {
    const known = challengeErrorResponse(error);
    if (known) return NextResponse.json(known.body, { status: known.status });

    console.error("PATCH /api/admin/bookings/:id/attendance error", error);
    return NextResponse.json(
      {
        error: "ATTENDANCE_UPDATE_FAILED",
        message: "No se pudo actualizar la asistencia.",
      },
      { status: 500 }
    );
  }
}
