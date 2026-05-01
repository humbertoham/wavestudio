import { NextRequest, NextResponse } from "next/server";
import { BookingStatus, Prisma } from "@prisma/client";

import { getAuthFromRequest } from "@/lib/auth";
import { getAvailableBookingCredits } from "@/lib/class-booking";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BOOKING_BLOCKED_MESSAGE =
  "Hola, debido a nuestras polÃ­ticas de cancelaciÃ³n, tus crÃ©ditos estÃ¡n bloqueados por una cancelaciÃ³n tardÃ­a o falta a clase. Para desbloquearlos, es necesario liquidar el monto de $100. ContÃ¡ctanos por DM para realizar el pago.";

type Ctx = { params: Promise<{ id: string }> };
type WaitlistJoinErrorCode =
  | "CLASS_NOT_FOUND"
  | "CLASS_CANCELED"
  | "CLASS_ALREADY_STARTED"
  | "ALREADY_BOOKED"
  | "ALREADY_WAITLISTED"
  | "CLASS_HAS_SPOTS"
  | "NO_CREDITS_AVAILABLE";

function j(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

function fail(code: WaitlistJoinErrorCode): never {
  throw { code } as { code: WaitlistJoinErrorCode };
}

function isRetryableTransactionError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

function errorResponse(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    switch ((error as { code: WaitlistJoinErrorCode }).code) {
      case "CLASS_NOT_FOUND":
        return j(404, {
          error: "CLASS_NOT_FOUND",
          message: "La clase no existe.",
        });
      case "CLASS_CANCELED":
        return j(409, {
          error: "CLASS_CANCELED",
          message: "La clase estÃ¡ cancelada.",
        });
      case "CLASS_ALREADY_STARTED":
        return j(409, {
          error: "CLASS_ALREADY_STARTED",
          message: "La clase ya comenzÃ³ y no acepta lista de espera.",
        });
      case "ALREADY_BOOKED":
        return j(409, {
          error: "ALREADY_BOOKED",
          message: "Ya tienes una reserva activa para esta clase.",
        });
      case "ALREADY_WAITLISTED":
        return j(409, {
          error: "ALREADY_WAITLISTED",
          message: "Ya estÃ¡s en lista de espera.",
        });
      case "CLASS_HAS_SPOTS":
        return j(409, {
          error: "CLASS_HAS_SPOTS",
          message: "La clase todavÃ­a tiene lugares disponibles.",
        });
      case "NO_CREDITS_AVAILABLE":
        return j(402, {
          error: "NO_CREDITS_AVAILABLE",
          message: "No tienes crÃ©ditos disponibles para esta clase.",
        });
    }
  }

  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    return j(409, {
      error: "ALREADY_WAITLISTED",
      message: "Ya estÃ¡s en lista de espera.",
    });
  }

  if (isRetryableTransactionError(error)) {
    return j(409, {
      error: "REQUEST_CONFLICT",
      message: "La lista de espera cambiÃ³ mientras se actualizaba. Intenta nuevamente.",
    });
  }

  console.error("POST /api/classes/[id]/waitlist error:", error);

  return j(500, {
    error: "INTERNAL_ERROR",
    message: "No se pudo agregar a la lista de espera.",
  });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const auth = await getAuthFromRequest(req);
  if (!auth?.sub) {
    return j(401, {
      error: "UNAUTHENTICATED",
      message: "Necesitas iniciar sesiÃ³n para entrar a la lista de espera.",
    });
  }

  const { id: classId } = await ctx.params;

  const user = await prisma.user.findUnique({
    where: { id: auth.sub },
    select: { bookingBlocked: true },
  });

  if (!user) {
    return j(404, {
      error: "USER_NOT_FOUND",
      message: "Usuario no encontrado.",
    });
  }

  if (user.bookingBlocked) {
    return j(403, {
      error: "BOOKING_BLOCKED",
      message: BOOKING_BLOCKED_MESSAGE,
    });
  }

  try {
    let result:
      | {
          id: string;
          position: number;
        }
      | null = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        result = await prisma.$transaction(
          async (tx) => {
            const klass = await tx.class.findUnique({
              where: { id: classId },
              include: {
                bookings: {
                  where: { status: BookingStatus.ACTIVE },
                  select: { quantity: true, userId: true },
                },
              },
            });

            if (!klass) fail("CLASS_NOT_FOUND");
            if (klass.isCanceled) fail("CLASS_CANCELED");
            if (klass.date.getTime() <= Date.now()) fail("CLASS_ALREADY_STARTED");

            const alreadyBooked = klass.bookings.some(
              (booking) => booking.userId === auth.sub
            );
            if (alreadyBooked) fail("ALREADY_BOOKED");

            const existingEntry = await tx.waitlist.findUnique({
              where: {
                userId_classId: {
                  userId: auth.sub,
                  classId,
                },
              },
              select: { id: true },
            });

            if (existingEntry) fail("ALREADY_WAITLISTED");

            const usedSpots = klass.bookings.reduce(
              (sum, booking) => sum + (booking.quantity ?? 1),
              0
            );
            if (usedSpots < klass.capacity) fail("CLASS_HAS_SPOTS");

            const requiredCredits = Math.max(1, klass.creditCost ?? 1);
            const availableCredits = await getAvailableBookingCredits(
              tx,
              auth.sub
            );

            if (availableCredits < requiredCredits) {
              fail("NO_CREDITS_AVAILABLE");
            }

            const positionData = await tx.waitlist.aggregate({
              where: { classId },
              _max: { position: true },
            });

            const position = (positionData._max.position ?? 0) + 1;

            return tx.waitlist.create({
              data: {
                classId,
                userId: auth.sub,
                position,
              },
              select: {
                id: true,
                position: true,
              },
            });
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          }
        );

        break;
      } catch (error) {
        if (isRetryableTransactionError(error) && attempt < 2) {
          continue;
        }

        throw error;
      }
    }

    if (!result) {
      return j(409, {
        error: "REQUEST_CONFLICT",
        message: "La lista de espera cambiÃ³ mientras se actualizaba. Intenta nuevamente.",
      });
    }

    return NextResponse.json({
      ok: true,
      entryId: result.id,
      position: result.position,
    });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const auth = await getAuthFromRequest(req);
  if (!auth?.sub) {
    return j(401, {
      error: "UNAUTHENTICATED",
      message: "Necesitas iniciar sesion para salir de la lista de espera.",
    });
  }

  const { id: classId } = await ctx.params;

  try {
    const result = await prisma.waitlist.deleteMany({
      where: {
        classId,
        userId: auth.sub,
      },
    });

    if (!result.count) {
      return j(404, {
        error: "NOT_WAITLISTED",
        message: "No estabas en la lista de espera.",
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    console.error("DELETE /api/classes/[id]/waitlist error:", error);

    return j(500, {
      error: "INTERNAL_ERROR",
      message: "No se pudo salir de la lista de espera.",
    });
  }
}
