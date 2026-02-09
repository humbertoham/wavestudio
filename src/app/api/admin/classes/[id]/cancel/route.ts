import { NextRequest, NextResponse } from "next/server";
import { prisma, requireAdmin } from "../../../_utils";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

function j(status: number, body: any) {
  return NextResponse.json(body, { status });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  const { id } = await ctx.params;

  // 1️⃣ Verificar si hay bookings activos
  const activeBookings = await prisma.booking.count({
    where: {
      classId: id,
      status: "ACTIVE",
    },
  });

  if (activeBookings > 0) {
    return j(400, {
      error: "CLASS_HAS_BOOKINGS",
      message: "No se puede cancelar una clase con usuarios inscritos.",
    });
  }

  // 2️⃣ Cancelar clase (soft cancel)
  const updated = await prisma.class.update({
    where: { id },
    data: { isCanceled: true },
    include: {
      bookings: true,
      instructor: true,
    },
  });

  return NextResponse.json(updated);
}
