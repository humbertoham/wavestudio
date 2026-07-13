import { NextRequest, NextResponse } from "next/server";
import { requireClassManager } from "../../../_utils";
import { runChallengeTransaction } from "@/lib/challenge";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

function j(status: number, body: any) {
  return NextResponse.json(body, { status });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const auth = await requireClassManager(req);
  if (auth) return auth;

  const { id } = await ctx.params;

  // 1️⃣ Verificar si hay bookings activos
  const result = await runChallengeTransaction(async (tx) => {
    const activeBookings = await tx.booking.count({
      where: {
        classId: id,
        status: "ACTIVE",
      },
    });

    if (activeBookings > 0) {
      return { activeBookings, updated: null };
    }

    const updated = await tx.class.update({
      where: { id },
      data: { isCanceled: true },
      include: {
        bookings: true,
        instructor: true,
      },
    });

    return { activeBookings: 0, updated };
  });

  if (result.activeBookings > 0) {
    return j(400, {
      error: "CLASS_HAS_BOOKINGS",
      message: "No se puede cancelar una clase con usuarios inscritos.",
    });
  }

  // 2️⃣ Cancelar clase (soft cancel)
  return NextResponse.json(result.updated);
}
