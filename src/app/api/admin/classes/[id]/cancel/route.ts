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
    const cls = await tx.class.findUnique({
      where: { id },
      select: { id: true, deletedAt: true },
    });
    if (!cls || cls.deletedAt) {
      return { outcome: "not_found" as const, activeBookings: 0, updated: null };
    }

    const activeBookings = await tx.booking.count({
      where: {
        classId: id,
        status: "ACTIVE",
      },
    });

    if (activeBookings > 0) {
      return { outcome: "blocked" as const, activeBookings, updated: null };
    }

    const updated = await tx.class.update({
      where: { id },
      data: { isCanceled: true },
      include: {
        bookings: true,
        instructor: true,
      },
    });

    return { outcome: "canceled" as const, activeBookings: 0, updated };
  });

  if (result.outcome === "not_found") {
    return j(404, {
      error: "CLASS_NOT_FOUND",
      message: "La clase no existe o fue eliminada.",
    });
  }

  if (result.outcome === "blocked") {
    return j(400, {
      error: "CLASS_HAS_BOOKINGS",
      message: "No se puede cancelar una clase con usuarios inscritos.",
    });
  }

  // 2️⃣ Cancelar clase (soft cancel)
  return NextResponse.json(result.updated);
}
