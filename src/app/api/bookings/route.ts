// /src/app/api/bookings/route.ts
import { NextResponse } from "next/server";
import { Prisma, BookingStatus, TokenReason } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function j(status: number, body: any) {
  return NextResponse.json(body, { status });
}

type Body = { classId?: string; quantity?: number };

// ───────────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────────

// Suma de tokens (créditos - débitos)
async function getUserTokenBalance(userId: string) {
  const agg = await prisma.tokenLedger.aggregate({
    where: { userId },
    _sum: { delta: true },
  });
  return agg._sum.delta ?? 0;
}

// Lugares ya reservados (SUM(quantity) en bookings ACTIVAS)
async function getBookedSpots(classId: string) {
  const agg = await prisma.booking.aggregate({
    where: { classId, status: BookingStatus.ACTIVE },
    _sum: { quantity: true },
  });
  return agg._sum.quantity ?? 0;
}

// ───────────────────────────────────────────────────────────────────────────────
// POST /api/bookings
// ───────────────────────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  try {
    const auth = await getAuth();
    if (!auth?.sub)
      return j(401, { error: "No tienes sesión activa. Por favor inicia sesión para continuar." });

    const body = (await req.json().catch(() => ({}))) as Body;
    const classId = String(body.classId || "").trim();
    const quantity = Number.isFinite(body.quantity)
      ? Math.max(1, Math.floor(body.quantity!))
      : 1;

    if (!classId) return j(400, { error: "Falta seleccionar la clase." });
    if (quantity < 1) return j(400, { error: "Cantidad de lugares inválida." });

    // 1) Trae clase (fuera de tx para validaciones rápidas/UX)
    const klass = await prisma.class.findUnique({
      where: { id: classId },
      select: {
        id: true,
        title: true,
        capacity: true,
        creditCost: true,
        date: true,
        isCanceled: true,
      },
    });
    if (!klass) return j(404, { error: "La clase no existe o fue eliminada." });
    if (klass.isCanceled) return j(409, { error: "Esta clase fue cancelada." });
    if (klass.date.getTime() <= Date.now()) {
      return j(409, { error: "La clase ya comenzó y no puede ser reservada." });
    }

    const perSeatCost = Math.max(1, klass.creditCost ?? 1);
    const neededTokens = perSeatCost * quantity;

    // 2) Pre-chequeos (UX): ocupación & saldo
    const [alreadyBooked, tokenBalance] = await Promise.all([
      getBookedSpots(classId),
      getUserTokenBalance(auth.sub),
    ]);

    const capacity = klass.capacity ?? 0;
    const available = Math.max(0, capacity - alreadyBooked);
    if (available <= 0)
      return j(409, { error: "Esta clase ya está llena. Intenta con otra sesión." });
    if (quantity > available)
      return j(409, {
        error: `Solo quedan ${available} lugar(es) disponibles.`,
      });

    if (tokenBalance < neededTokens) {
      return j(402, {
        error: `No tienes créditos suficientes. Necesitas ${neededTokens} y actualmente tienes ${tokenBalance}.`,
      });
    }

    // 3) Transacción con re-checks y aislamiento SERIALIZABLE
    const result = await prisma.$transaction(
      async (tx) => {
        // Relee clase dentro de tx
        const locked = await tx.class.findUnique({
          where: { id: classId },
          select: {
            id: true,
            capacity: true,
            creditCost: true,
            date: true,
            isCanceled: true,
          },
        });
        if (!locked || locked.isCanceled) {
          const e: any = new Error("CLASS_NOT_BOOKABLE");
          e.code = "CLASS_NOT_BOOKABLE";
          throw e;
        }
        if (locked.date.getTime() <= Date.now()) {
          const e: any = new Error("CLASS_ALREADY_STARTED");
          e.code = "CLASS_ALREADY_STARTED";
          throw e;
        }

        // Recalcula ocupación (SUM quantity, ACTIVE)
        const againBookedAgg = await tx.booking.aggregate({
          where: { classId, status: BookingStatus.ACTIVE },
          _sum: { quantity: true },
        });
        const sumBooked = againBookedAgg._sum.quantity ?? 0;
        const cap = locked.capacity ?? 0;
        const spotsLeft = Math.max(0, cap - sumBooked);
        if (spotsLeft < quantity) {
          const e: any = new Error("NOT_ENOUGH_SPOTS");
          e.code = "NOT_ENOUGH_SPOTS";
          e.available = spotsLeft;
          throw e;
        }

        // Recalcula tokens del usuario
        const againTokens = await tx.tokenLedger.aggregate({
          where: { userId: auth.sub },
          _sum: { delta: true },
        });
        const currTokens = againTokens._sum.delta ?? 0;
        const costPerSeat = Math.max(1, locked.creditCost ?? 1);
        const totalCost = quantity * costPerSeat;

        if (currTokens < totalCost) {
          const e: any = new Error("INSUFFICIENT_TOKENS");
          e.code = "INSUFFICIENT_TOKENS";
          e.tokens = currTokens;
          e.needed = totalCost;
          throw e;
        }

        // Crea booking
        const booking = await tx.booking.create({
          data: {
            userId: auth.sub,
            classId,
            quantity,
            status: BookingStatus.ACTIVE,
          },
          select: { id: true },
        });

        // Debita tokens
        await tx.tokenLedger.create({
          data: {
            userId: auth.sub,
            delta: -totalCost,
            reason: TokenReason.BOOKING_DEBIT,
            bookingId: booking.id,
          },
        });

        // Saldos y agregados finales
        const afterTokensAgg = await tx.tokenLedger.aggregate({
          where: { userId: auth.sub },
          _sum: { delta: true },
        });

        const afterBookedAgg = await tx.booking.aggregate({
          where: { classId, status: BookingStatus.ACTIVE },
          _sum: { quantity: true },
        });

        return {
          bookingId: booking.id,
          tokens: afterTokensAgg._sum.delta ?? 0,
          quantity,
          class: {
            id: classId,
            capacity: locked.capacity,
            booked: afterBookedAgg._sum.quantity ?? 0,
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    return j(201, {
      ok: true,
      bookingId: result.bookingId,
      tokens: result.tokens,
      quantity: result.quantity,
      class: result.class,
    });
  } catch (err: any) {
    if (err?.code === "NOT_ENOUGH_SPOTS") {
      return j(409, {
        error: `Solo quedan ${err.available ?? 0} lugar(es) disponibles.`,
      });
    }
    if (err?.code === "INSUFFICIENT_TOKENS") {
      return j(402, {
        error: `No tienes créditos suficientes para completar esta reserva.`,
      });
    }
    if (err?.code === "CLASS_ALREADY_STARTED") {
      return j(409, {
        error: "La clase ya está en curso y no puede ser reservada.",
      });
    }
    if (err?.code === "CLASS_NOT_BOOKABLE") {
      return j(409, { error: "Esta clase no está disponible para reservas." });
    }
    console.error("POST /api/bookings error:", err);
    return j(500, {
      error: "Ocurrió un error al procesar tu reserva. Intenta nuevamente.",
    });
  }
}
