// src/app/api/bookings/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuth } from "@/lib/auth";
import { BookingStatus, TokenReason } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function j(status: number, body: any) {
  return NextResponse.json(body, { status });
}

type Body = { classId?: string; quantity?: number };

// Suma de tokens (créditos - débitos)
async function getUserTokenBalance(userId: string) {
  const agg = await prisma.tokenLedger.aggregate({
    where: { userId },
    _sum: { delta: true },
  });
  return agg._sum.delta ?? 0;
}

// Lugares ya reservados (suma de quantity en bookings ACTIVAS)
async function getBookedSpots(classId: string) {
  const agg = await prisma.booking.aggregate({
    where: { classId, status: BookingStatus.ACTIVE },
    _sum: { quantity: true },
  });
  return agg._sum.quantity ?? 0;
}

export async function POST(req: Request) {
  try {
    const auth = await getAuth();
    if (!auth?.sub) return j(401, { error: "UNAUTHORIZED" });

    const body = (await req.json().catch(() => ({}))) as Body;
    const classId = String(body.classId || "").trim();
    const quantity = Number.isFinite(body.quantity) ? Math.max(1, Math.floor(body.quantity!)) : 1;

    if (!classId) return j(400, { error: "MISSING_CLASS_ID" });
    if (quantity < 1) return j(400, { error: "INVALID_QUANTITY" });

    // ⚠️ En tu schema el modelo es Class y la fecha es 'date'
    const klass = await prisma["class"].findUnique({
      where: { id: classId },
      select: { id: true, title: true, capacity: true, creditCost: true, date: true, isCanceled: true },
    });
    if (!klass) return j(404, { error: "CLASS_NOT_FOUND" });
    if (klass.isCanceled) return j(409, { error: "CLASS_CANCELED" });

    const capacity = klass.capacity;
    if (capacity <= 0) return j(409, { error: "CLASS_WITHOUT_CAPACITY" });

    const [alreadyBooked, tokenBalance] = await Promise.all([
      getBookedSpots(classId),
      getUserTokenBalance(auth.sub),
    ]);

    const available = Math.max(0, capacity - alreadyBooked);
    if (available <= 0) return j(409, { error: "CLASS_FULL" });
    if (quantity > available) return j(409, { error: "NOT_ENOUGH_SPOTS", available });

    const perSeatCost = Math.max(1, klass.creditCost ?? 1);
    const neededTokens = perSeatCost * quantity;

    if (tokenBalance < neededTokens) {
      return j(402, { error: "INSUFFICIENT_TOKENS", tokens: tokenBalance, needed: neededTokens });
    }

    // Transacción con re-checks contra condiciones de carrera
    const result = await prisma.$transaction(async (tx) => {
      const [againBooked, againTokens] = await Promise.all([
        tx.booking.aggregate({
          where: { classId, status: BookingStatus.ACTIVE },
          _sum: { quantity: true },
        }),
        tx.tokenLedger.aggregate({
          where: { userId: auth.sub },
          _sum: { delta: true },
        }),
      ]);

      const sumBooked = againBooked._sum.quantity ?? 0;
      const spotsLeft = Math.max(0, capacity - sumBooked);
      if (spotsLeft < quantity) {
        const e: any = new Error("NOT_ENOUGH_SPOTS");
        e.code = "NOT_ENOUGH_SPOTS";
        e.available = spotsLeft;
        throw e;
      }

      const currTokens = againTokens._sum.delta ?? 0;
      if (currTokens < neededTokens) {
        const e: any = new Error("INSUFFICIENT_TOKENS");
        e.code = "INSUFFICIENT_TOKENS";
        e.tokens = currTokens;
        e.needed = neededTokens;
        throw e;
      }

      // Crea la reserva
      const booking = await tx.booking.create({
        data: {
          userId: auth.sub,
          classId,
          quantity,
          status: BookingStatus.ACTIVE,
        },
        select: { id: true },
      });

      // Debita tokens (sin 'meta' porque tu schema no lo tiene)
      await tx.tokenLedger.create({
        data: {
          userId: auth.sub,
          delta: -neededTokens,
          reason: TokenReason.BOOKING_DEBIT,
          bookingId: booking.id,
        },
      });

      const after = await tx.tokenLedger.aggregate({
        where: { userId: auth.sub },
        _sum: { delta: true },
      });

      return { bookingId: booking.id, tokens: after._sum.delta ?? 0 };
    });

    return j(201, { ok: true, bookingId: result.bookingId, tokens: result.tokens });
  } catch (err: any) {
    if (err?.code === "NOT_ENOUGH_SPOTS") {
      return j(409, { error: "NOT_ENOUGH_SPOTS", available: err.available ?? 0 });
    }
    if (err?.code === "INSUFFICIENT_TOKENS") {
      return j(402, { error: "INSUFFICIENT_TOKENS", tokens: err.tokens ?? 0, needed: err.needed ?? 0 });
    }
    console.error("POST /api/bookings error:", err);
    return j(500, { error: "BOOKING_FAILED" });
  }
}
