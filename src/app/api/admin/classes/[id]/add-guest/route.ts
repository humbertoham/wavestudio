import { NextRequest, NextResponse } from "next/server";
import { prisma, requireAdmin } from "../../../_utils";

export const runtime = "nodejs";

// App Router params async
type Ctx = { params: Promise<{ id: string }> };

function j(status: number, body: any) {
  return NextResponse.json(body, { status });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  const { id: classId } = await ctx.params;
  const { name } = await req.json();

  if (!name || !String(name).trim()) {
    return j(400, { error: "MISSING_GUEST_NAME" });
  }

  // 1️⃣ Cargar clase y bookings activos
  const cls = await prisma.class.findUnique({
    where: { id: classId },
    include: {
      bookings: {
        where: { status: "ACTIVE" },
      },
    },
  });

  if (!cls) return j(404, { error: "CLASS_NOT_FOUND" });
  if (cls.isCanceled) return j(400, { error: "CLASS_CANCELED" });

  // 2️⃣ Validar cupo
  const usedSpots = cls.bookings.reduce(
    (acc, b) => acc + (b.quantity ?? 1),
    0
  );

  if (usedSpots >= cls.capacity) {
    return j(400, { error: "CLASS_FULL" });
  }

  // 3️⃣ Crear booking de invitado
  const booking = await prisma.booking.create({
    data: {
      classId,
      guestName: String(name).trim(),
      quantity: 1,
      status: "ACTIVE",
    },
  });

  return NextResponse.json({
    ok: true,
    bookingId: booking.id,
    guestName: booking.guestName,
  });
}
