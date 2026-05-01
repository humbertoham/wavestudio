// /src/app/api/bookings/route.ts
import { BookingStatus, Prisma, TokenReason } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { getAuthFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BOOKING_BLOCKED_MESSAGE =
  "Hola, debido a nuestras politicas de cancelacion, tus creditos estan bloqueados por una cancelacion tardia o falta a clase. Para desbloquearlos, es necesario liquidar el monto de $100. Contactanos por DM para realizar el pago.";

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
          "Los usuarios Wellhub y TotalPass solo pueden reservar 1 lugar por clase.",
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
      },
    });

    if (!klass) {
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
    const neededTokens = perSeatCost * quantity;

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
            const now = new Date();

            const userInside = await tx.user.findUnique({
              where: { id: auth.sub },
              select: { bookingBlocked: true },
            });

            if (!userInside || userInside.bookingBlocked) {
              throw Object.assign(new Error("BOOKING_BLOCKED"), {
                code: "BOOKING_BLOCKED",
              });
            }

            const existingInside = await tx.booking.findFirst({
              where: {
                userId: auth.sub,
                classId,
                status: BookingStatus.ACTIVE,
              },
              select: { id: true },
            });

            if (existingInside) {
              throw Object.assign(new Error("ALREADY_BOOKED"), {
                code: "ALREADY_BOOKED",
              });
            }

            const locked = await tx.class.findUnique({
              where: { id: classId },
              select: {
                capacity: true,
                creditCost: true,
                date: true,
                isCanceled: true,
              },
            });

            if (!locked || locked.isCanceled) {
              throw Object.assign(new Error("CLASS_NOT_BOOKABLE"), {
                code: "CLASS_NOT_BOOKABLE",
              });
            }

            if (locked.date.getTime() <= Date.now()) {
              throw Object.assign(new Error("CLASS_ALREADY_STARTED"), {
                code: "CLASS_ALREADY_STARTED",
              });
            }

            const againBookedAgg = await tx.booking.aggregate({
              where: { classId, status: BookingStatus.ACTIVE },
              _sum: { quantity: true },
            });

            const sumBooked = againBookedAgg._sum.quantity ?? 0;
            const cap = locked.capacity ?? 0;
            const spotsLeft = Math.max(0, cap - sumBooked);

            if (spotsLeft < quantity) {
              throw Object.assign(new Error("NOT_ENOUGH_SPOTS"), {
                code: "NOT_ENOUGH_SPOTS",
                available: spotsLeft,
              });
            }

            const currentPerSeatCost = Math.max(1, locked.creditCost ?? 1);
            const totalCost = quantity * currentPerSeatCost;

            const packs = await tx.packPurchase.findMany({
              where: {
                userId: auth.sub,
                expiresAt: { gt: now },
                classesLeft: { gt: 0 },
                OR: [{ pausedUntil: null }, { pausedUntil: { lte: now } }],
              },
              orderBy: { expiresAt: "asc" },
              select: { id: true, classesLeft: true },
            });

            const currentTokens = packs.reduce(
              (sum, pack) => sum + pack.classesLeft,
              0
            );

            if (currentTokens < totalCost) {
              throw Object.assign(new Error("INSUFFICIENT_TOKENS"), {
                code: "INSUFFICIENT_TOKENS",
              });
            }

            const booking = await tx.booking.create({
              data: {
                userId: auth.sub,
                classId,
                quantity,
                status: BookingStatus.ACTIVE,
              },
              select: { id: true },
            });

            let remaining = totalCost;

            for (const pack of packs) {
              if (remaining <= 0) break;

              const use = Math.min(pack.classesLeft, remaining);

              const updatedPack = await tx.packPurchase.updateMany({
                where: {
                  id: pack.id,
                  classesLeft: { gte: use },
                },
                data: { classesLeft: { decrement: use } },
              });

              if (updatedPack.count !== 1) {
                throw Object.assign(new Error("INSUFFICIENT_TOKENS"), {
                  code: "INSUFFICIENT_TOKENS",
                });
              }

              await tx.tokenLedger.create({
                data: {
                  userId: auth.sub,
                  packPurchaseId: pack.id,
                  delta: -use,
                  reason: TokenReason.BOOKING_DEBIT,
                  bookingId: booking.id,
                },
              });

              remaining -= use;
            }

            if (remaining !== 0) {
              throw Object.assign(new Error("DEBIT_MISMATCH"), {
                code: "INSUFFICIENT_TOKENS",
              });
            }

            await tx.waitlist.deleteMany({
              where: {
                classId,
                userId: auth.sub,
              },
            });

            return {
              bookingId: booking.id,
              debitedCredits: totalCost,
              creditCost: currentPerSeatCost,
            };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        );

        break;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2034" &&
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

    return j(201, {
      ok: true,
      bookingId: result.bookingId,
      debitedCredits: result.debitedCredits,
      creditCost: result.creditCost,
    });
  } catch (err: any) {
    if (err?.code === "BOOKING_BLOCKED") {
      return j(403, {
        code: "BOOKING_BLOCKED",
        error: BOOKING_BLOCKED_MESSAGE,
      });
    }

    if (err?.code === "USER_NOT_FOUND") {
      return j(404, { error: "Usuario no encontrado." });
    }

    if (err?.code === "ALREADY_BOOKED") {
      return alreadyBookedResponse();
    }

    if (err?.code === "NOT_ENOUGH_SPOTS") {
      return j(409, {
        error: `Solo quedan ${err.available ?? 0} lugar(es) disponibles.`,
      });
    }

    if (err?.code === "INSUFFICIENT_TOKENS") {
      return j(402, {
        error: "No tienes creditos suficientes para completar esta reserva.",
      });
    }

    if (err?.code === "CLASS_ALREADY_STARTED") {
      return j(409, {
        error: "La clase ya esta en curso y no puede ser reservada.",
      });
    }

    if (err?.code === "CLASS_NOT_BOOKABLE") {
      return j(409, {
        error: "Esta clase no esta disponible para reservas.",
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
