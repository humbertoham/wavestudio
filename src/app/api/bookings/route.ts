// /src/app/api/bookings/route.ts
import { BookingStatus, Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { createBookingWithCreditCheck } from "@/lib/class-booking";
import { getUnlimitedEligibility, isBookingTransactionConflict, unlimitedErrorMessages } from "@/lib/monthly-unlimited";

import { getAuthFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { syncWellhubClassSafely } from "@/lib/wellhub/booking/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BOOKING_BLOCKED_MESSAGE =
  "Hola, tu cuenta está temporalmente bloqueada para nuevas reservas por una cancelación tardía o falta a clase. Nuestro equipo se pondrá en contacto contigo para realizar el pago de $100 MXN.";

const MAX_SERIALIZABLE_RETRIES = 3;

type Body = { classId?: string; quantity?: number };

function j(status: number, body: any) {
  return NextResponse.json(body, { status });
}

function methodNotAllowed() {
  return j(405, { error: "METHOD_NOT_ALLOWED" });
}

async function getUserTokenBalance(userId: string) {
  const now = new Date();
  const agg = await prisma.packPurchase.aggregate({
    where: {
      userId,
      expiresAt: { gt: now },
      classesLeft: { gt: 0 },
      OR: [{ pausedUntil: null }, { pausedUntil: { lte: now } }],
    },
    _sum: { classesLeft: true },
  });

  return agg._sum.classesLeft ?? 0;
}

async function getBookedSpots(classId: string) {
  const agg = await prisma.booking.aggregate({
    where: { classId, status: BookingStatus.ACTIVE },
    _sum: { quantity: true },
  });

  return agg._sum.quantity ?? 0;
}

function alreadyBookedResponse() {
  return j(409, {
    success: false,
    error: "ALREADY_BOOKED",
    message: "Ya tienes una reserva activa para esta clase.",
  });
}

export async function GET() {
  return methodNotAllowed();
}

export async function PUT() {
  return methodNotAllowed();
}

export async function PATCH() {
  return methodNotAllowed();
}

export async function DELETE() {
  return methodNotAllowed();
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthFromRequest(req);
    if (!auth?.sub) {
      return j(401, {
        error:
          "No tienes sesion activa. Por favor inicia sesion para continuar.",
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: auth.sub },
      select: { affiliation: true, bookingBlocked: true },
    });

    if (!user) {
      return j(404, { error: "Usuario no encontrado." });
    }

    if (user.bookingBlocked) {
      return j(403, {
        code: "BOOKING_BLOCKED",
        error: BOOKING_BLOCKED_MESSAGE,
      });
    }

    const isCorporate =
      user.affiliation === "WELLHUB" || user.affiliation === "TOTALPASS";

    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body || typeof body !== "object") {
      return j(400, { error: "Body JSON invalido." });
    }

    const classId = typeof body.classId === "string" ? body.classId.trim() : "";
    if (!classId) {
      return j(400, { error: "Falta seleccionar la clase." });
    }

    const quantityValue = body.quantity == null ? 1 : Number(body.quantity);
    if (!Number.isFinite(quantityValue)) {
      return j(400, { error: "Cantidad de lugares invalida." });
    }

    const quantity = Math.floor(quantityValue);
    if (quantity < 1) {
      return j(400, { error: "Cantidad de lugares invalida." });
    }

    if (isCorporate && quantity > 1) {
      return j(403, {
        error:
          "Los usuarios WellHub y TotalPass solo pueden reservar 1 lugar por clase.",
      });
    }

    const existing = await prisma.booking.findFirst({
      where: {
        userId: auth.sub,
        classId,
        status: BookingStatus.ACTIVE,
      },
      select: { id: true },
    });

    if (existing) {
      return alreadyBookedResponse();
    }

    const klass = await prisma.class.findUnique({
      where: { id: classId },
      select: {
        id: true,
        capacity: true,
        creditCost: true,
        date: true,
        isCanceled: true,
        deletedAt: true,
      },
    });

    if (!klass || klass.deletedAt) {
      return j(404, { error: "La clase no existe o fue eliminada." });
    }

    if (klass.isCanceled) {
      return j(409, { error: "Esta clase fue cancelada." });
    }

    if (klass.date.getTime() <= Date.now()) {
      return j(409, {
        error: "La clase ya comenzo y no puede ser reservada.",
      });
    }

    const perSeatCost = Math.max(1, klass.creditCost ?? 1);
    const eligibility = await getUnlimitedEligibility(prisma, auth.sub, klass.date);
    const neededTokens = perSeatCost * (quantity - (eligibility.purchase ? 1 : 0));

    const [alreadyBookedSpots, tokenBalance] = await Promise.all([
      getBookedSpots(classId),
      getUserTokenBalance(auth.sub),
    ]);

    const capacity = klass.capacity ?? 0;
    const available = Math.max(0, capacity - alreadyBookedSpots);

    if (available <= 0) {
      return j(409, {
        error: "Esta clase ya esta llena. Intenta con otra sesion.",
      });
    }

    if (quantity > available) {
      return j(409, {
        error: `Solo quedan ${available} lugar(es) disponibles.`,
      });
    }

    if (tokenBalance < neededTokens) {
      if (eligibility.purchase && quantity > 1) throw { code: "UNLIMITED_SEAT_LIMIT" };
      if (eligibility.reason) throw { code: eligibility.reason, message: eligibility.message };
      return j(402, {
        error: `No tienes creditos suficientes. Necesitas ${neededTokens} y actualmente tienes ${tokenBalance}.`,
      });
    }

    let result:
      | {
          bookingId: string;
          debitedCredits: number;
          creditCost: number;
        }
      | null = null;

    for (let attempt = 0; attempt < MAX_SERIALIZABLE_RETRIES; attempt += 1) {
      try {
        result = await prisma.$transaction(
          async (tx) => {
            const booking = await createBookingWithCreditCheck(tx, { classId, userId: auth.sub, quantity });

            await tx.waitlist.deleteMany({
              where: {
                classId,
                userId: auth.sub,
              },
            });

            return {
              bookingId: booking.id,
              debitedCredits: booking.debitedCredits,
              creditCost: booking.creditCost,
            };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        );

        break;
      } catch (error) {
        if (
          isBookingTransactionConflict(error) &&
          attempt < MAX_SERIALIZABLE_RETRIES - 1
        ) {
          continue;
        }

        throw error;
      }
    }

    if (!result) {
      return j(409, {
        error:
          "La clase cambio mientras procesabamos tu reserva. Intenta nuevamente.",
      });
    }


    await syncWellhubClassSafely(classId);

    return j(201, {
      ok: true,
      bookingId: result.bookingId,
      debitedCredits: result.debitedCredits,
      creditCost: result.creditCost,
    });
  } catch (err: any) {
    if (err?.code?.startsWith("UNLIMITED_")) return j(402, { code: err.code, error: err.message ?? unlimitedErrorMessages[err.code as keyof typeof unlimitedErrorMessages] });
    if (err?.code === "BOOKING_BLOCKED") {
      return j(403, {
        code: "BOOKING_BLOCKED",
        error: BOOKING_BLOCKED_MESSAGE,
      });
    }

    if (err?.code === "USER_NOT_FOUND") {
      return j(404, { error: "Usuario no encontrado." });
    }

    if (err?.code === "ALREADY_BOOKED" || err?.code === "USER_ALREADY_BOOKED") {
      return alreadyBookedResponse();
    }

    if (err?.code === "CLASS_FULL") return j(409, { error: "CLASS_FULL", message: "Esta clase ya esta llena." });

    if (err?.code === "NOT_ENOUGH_SPOTS") {
      return j(409, {
        error: `Solo quedan ${err.available ?? 0} lugar(es) disponibles.`,
      });
    }

    if (err?.code === "INSUFFICIENT_TOKENS" || err?.code === "NO_CREDITS_AVAILABLE") {
      return j(402, {
        error: "No tienes creditos suficientes para completar esta reserva.",
      });
    }

    if (err?.code === "CLASS_ALREADY_STARTED") {
      return j(409, {
        error: "La clase ya esta en curso y no puede ser reservada.",
      });
    }

    if (err?.code === "CLASS_NOT_BOOKABLE" || err?.code === "CLASS_NOT_FOUND" || err?.code === "CLASS_CANCELED") {
      return j(409, {
        error: "Esta clase no esta disponible para reservas.",
      });
    }

    if (isBookingTransactionConflict(err)) {
      return j(409, {
        error: "La clase cambio mientras procesabamos tu reserva. Intenta nuevamente.",
      });
    }

    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return alreadyBookedResponse();
    }

    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034") {
      return j(409, {
        error:
          "La clase cambio mientras procesabamos tu reserva. Intenta nuevamente.",
      });
    }

    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      console.error("BOOKING ERROR:", {
        code: err.code,
        meta: err.meta,
        message: err.message,
      });
    } else {
      console.error("BOOKING ERROR:", err);
    }

    return j(500, {
      error: "Ocurrio un error al procesar tu reserva. Intenta nuevamente.",
    });
  }
}
