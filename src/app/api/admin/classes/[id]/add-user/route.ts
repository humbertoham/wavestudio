import { NextRequest, NextResponse } from "next/server";
import { prisma, requireAdmin } from "../../../_utils";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

function j(status: number, body: any) {
  return NextResponse.json(body, { status });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  const { id: classId } = await ctx.params;
  const { userId } = await req.json();

  if (!userId) {
    return j(400, { error: "MISSING_USER_ID" });
  }

  // 1️⃣ Cargar clase
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

  // 3️⃣ Evitar booking duplicado
  const alreadyBooked = await prisma.booking.findFirst({
    where: {
      classId,
      userId,
      status: "ACTIVE",
    },
  });

  if (alreadyBooked) {
    return j(409, { error: "USER_ALREADY_BOOKED" });
  }

  // 4️⃣ Buscar pack con créditos disponibles
  const pack = await prisma.packPurchase.findFirst({
    where: {
      userId,
      classesLeft: { gt: 0 },
      expiresAt: { gt: new Date() },
    },
    orderBy: {
      expiresAt: "asc",
    },
  });

  // 🔹 Si no hay pack, revisar balance total en ledger (corporativo)
  let corporateBalance = 0;

  if (!pack) {
    const agg = await prisma.tokenLedger.aggregate({
      where: { userId },
      _sum: { delta: true },
    });

    corporateBalance = agg._sum.delta ?? 0;

    if (corporateBalance < 1) {
      return j(400, { error: "NO_CREDITS_AVAILABLE" });
    }
  }

  // 5️⃣ Transacción
  const booking = await prisma.$transaction(async (tx) => {
    const newBooking = await tx.booking.create({
      data: {
        userId,
        classId,
        quantity: 1,
        packPurchaseId: pack ? pack.id : null,
      },
    });

    if (pack) {
      // 🔹 Consumir pack
      await tx.packPurchase.update({
        where: { id: pack.id },
        data: {
          classesLeft: { decrement: 1 },
        },
      });

      await tx.tokenLedger.create({
        data: {
          userId,
          bookingId: newBooking.id,
          packPurchaseId: pack.id,
          delta: -1,
          reason: "BOOKING_DEBIT",
        },
      });
    } else {
      // 🔹 Consumir corporate
      await tx.tokenLedger.create({
        data: {
          userId,
          bookingId: newBooking.id,
          delta: -1,
          reason: "BOOKING_DEBIT",
        },
      });
    }

    return newBooking;
  });

  return NextResponse.json({
    ok: true,
    bookingId: booking.id,
  });
}