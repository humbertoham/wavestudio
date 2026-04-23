// /src/app/api/bookings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Prisma, BookingStatus, TokenReason } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthFromRequest } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BOOKING_BLOCKED_MESSAGE =
  "Hola, debido a nuestras políticas de cancelación, tus créditos están bloqueados por una cancelación tardía o falta a clase. Para desbloquearlos, es necesario liquidar el monto de $100. Contáctanos por DM para realizar el pago.";

function j(status: number, body: any) {
  return NextResponse.json(body, { status });
}

type Body = { classId?: string; quantity?: number };

function methodNotAllowed() {
  return j(405, { error: "METHOD_NOT_ALLOWED" });
}

// ✅ SALDO REAL: sumar packs vigentes (classesLeft)
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
    if (!auth?.sub)
      return j(401, {
        error:
          "No tienes sesión activa. Por favor inicia sesión para continuar.",
      });

    // 🔎 Obtener afiliación
    const user = await prisma.user.findUnique({
      where: { id: auth.sub },
      select: { affiliation: true, bookingBlocked: true },
    });

    if (!user) return j(404, { error: "Usuario no encontrado." });

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

    if (!classId) return j(400, { error: "Falta seleccionar la clase." });

    const quantityValue = body.quantity == null ? 1 : Number(body.quantity);

    if (!Number.isFinite(quantityValue)) {
      return j(400, { error: "Cantidad de lugares invalida." });
    }

    const quantity = Math.floor(quantityValue);

    if (quantity < 1) return j(400, { error: "Cantidad de lugares invalida." });

    // 🔒 BLOQUEO: corporate solo 1 lugar
    if (isCorporate && quantity > 1) {
      return j(403, {
        error:
          "Los usuarios Wellhub y TotalPass solo pueden reservar 1 lugar por clase.",
      });
    }

    // 🔒 BLOQUEO: corporate no puede reservar la misma clase 2 veces
    if (isCorporate) {
      const existing = await prisma.booking.findFirst({
        where: {
          userId: auth.sub,
          classId,
          status: BookingStatus.ACTIVE,
        },
      });

      if (existing) {
        return j(409, {
          error: "Ya tienes una reserva activa para esta clase.",
        });
      }
    }

    // 1️⃣ Obtener clase
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

    if (!klass) return j(404, { error: "La clase no existe o fue eliminada." });

    if (klass.isCanceled) return j(409, { error: "Esta clase fue cancelada." });

    if (klass.date.getTime() <= Date.now())
      return j(409, {
        error: "La clase ya comenzó y no puede ser reservada.",
      });

    const perSeatCost = Math.max(1, klass.creditCost ?? 1);
    const neededTokens = perSeatCost * quantity;

    // 2️⃣ Validaciones rápidas (fuera de TX)
    const [alreadyBooked, tokenBalance] = await Promise.all([
      getBookedSpots(classId),
      getUserTokenBalance(auth.sub),
    ]);

    const capacity = klass.capacity ?? 0;
    const available = Math.max(0, capacity - alreadyBooked);

    if (available <= 0)
      return j(409, {
        error: "Esta clase ya está llena. Intenta con otra sesión.",
      });

    if (quantity > available)
      return j(409, {
        error: `Solo quedan ${available} lugar(es) disponibles.`,
      });

    if (tokenBalance < neededTokens)
      return j(402, {
        error: `No tienes créditos suficientes. Necesitas ${neededTokens} y actualmente tienes ${tokenBalance}.`,
      });

    // 3️⃣ Transacción blindada
    const result = await prisma.$transaction(
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

        // 🔒 Revalidación corporate dentro de tx
        if (isCorporate) {
          const existingInside = await tx.booking.findFirst({
            where: {
              userId: auth.sub,
              classId,
              status: BookingStatus.ACTIVE,
            },
          });

          if (existingInside) {
            const e: any = new Error("CORPORATE_DUPLICATE");
            e.code = "CORPORATE_DUPLICATE";
            throw e;
          }
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

        if (!locked || locked.isCanceled)
          throw Object.assign(new Error(), {
            code: "CLASS_NOT_BOOKABLE",
          });

        if (locked.date.getTime() <= Date.now())
          throw Object.assign(new Error(), {
            code: "CLASS_ALREADY_STARTED",
          });

        const againBookedAgg = await tx.booking.aggregate({
          where: { classId, status: BookingStatus.ACTIVE },
          _sum: { quantity: true },
        });

        const sumBooked = againBookedAgg._sum.quantity ?? 0;
        const cap = locked.capacity ?? 0;
        const spotsLeft = Math.max(0, cap - sumBooked);

        if (spotsLeft < quantity)
          throw Object.assign(new Error(), {
            code: "NOT_ENOUGH_SPOTS",
            available: spotsLeft,
          });

        const totalCost = quantity * perSeatCost;

        // ✅ Obtener packs vigentes (ordenados por expiración)
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

        const currTokens = packs.reduce((sum, p) => sum + p.classesLeft, 0);

        if (currTokens < totalCost)
          throw Object.assign(new Error(), {
            code: "INSUFFICIENT_TOKENS",
          });

        // Crear booking
        const booking = await tx.booking.create({
          data: {
            userId: auth.sub,
            classId,
            quantity,
            status: BookingStatus.ACTIVE,
          },
          select: { id: true },
        });

        // ✅ Debitar packs (consume primero el que vence antes)
        let remaining = totalCost;

        for (const pack of packs) {
          if (remaining <= 0) break;

          const use = Math.min(pack.classesLeft, remaining);

          // Decrementar saldo real
          await tx.packPurchase.update({
            where: { id: pack.id },
            data: { classesLeft: { decrement: use } },
          });

          // Ledger por pack (historial)
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

        // Seguridad extra (no debería pasar)
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

        return { bookingId: booking.id };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    return j(201, {
      ok: true,
      bookingId: result.bookingId,
    });
  } catch (err: any) {
    if (err?.code === "BOOKING_BLOCKED")
      return j(403, {
        code: "BOOKING_BLOCKED",
        error: BOOKING_BLOCKED_MESSAGE,
      });

    if (err?.code === "CORPORATE_DUPLICATE")
      return j(409, {
        error: "Ya tienes una reserva activa para esta clase.",
      });

    if (err?.code === "NOT_ENOUGH_SPOTS")
      return j(400, {
        error: `Solo quedan ${err.available ?? 0} lugar(es) disponibles.`,
      });

    if (err?.code === "INSUFFICIENT_TOKENS")
      return j(402, {
        error: "No tienes créditos suficientes para completar esta reserva.",
      });

    if (err?.code === "CLASS_ALREADY_STARTED")
      return j(409, {
        error: "La clase ya está en curso y no puede ser reservada.",
      });

    if (err?.code === "CLASS_NOT_BOOKABLE")
      return j(409, {
        error: "Esta clase no está disponible para reservas.",
      });

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
      error: "Ocurrió un error al procesar tu reserva. Intenta nuevamente.",
    });
  }
}
