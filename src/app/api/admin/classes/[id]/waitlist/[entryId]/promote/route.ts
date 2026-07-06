import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { createBookingWithCreditCheck, isManagedBookingError } from "@/lib/class-booking";

import { prisma, requireAdmin } from "../../../../../_utils";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; entryId: string }> };
type PromoteWaitlistError = { code: "WAITLIST_ENTRY_NOT_FOUND" };
const MAX_SERIALIZABLE_RETRIES = 3;

function j(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

function errorResponse(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as PromoteWaitlistError).code === "WAITLIST_ENTRY_NOT_FOUND"
  ) {
    return j(404, {
      error: "WAITLIST_ENTRY_NOT_FOUND",
      message: "La entrada de lista de espera ya no existe.",
    });
  }

  if (isManagedBookingError(error)) {
    switch (error.code) {
      case "CLASS_NOT_FOUND":
        return j(404, {
          error: error.code,
          message: "La clase no existe.",
        });
      case "CLASS_CANCELED":
        return j(409, {
          error: error.code,
          message: "La clase está cancelada.",
        });
      case "CLASS_FULL":
        return j(409, {
          error: error.code,
          message: "No hay lugares disponibles para agregar a este usuario.",
        });
      case "USER_NOT_FOUND":
        return j(404, {
          error: error.code,
          message: "El usuario ya no existe.",
        });
      case "BOOKING_BLOCKED":
        return j(403, {
          error: error.code,
          message:
            "Este usuario tiene las reservas bloqueadas y no puede agregarse a clase.",
        });
      case "USER_ALREADY_BOOKED":
        return j(409, {
          error: error.code,
          message: "El usuario ya tiene una reserva activa para esta clase.",
        });
      case "NO_CREDITS_AVAILABLE":
        return j(409, {
          error: error.code,
          message: "El usuario no tiene créditos disponibles.",
        });
      case "CLASS_ALREADY_STARTED":
        return j(409, {
          error: error.code,
          message: "La clase ya comenzó.",
        });
    }
  }

  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  ) {
    return j(409, {
      error: "CONCURRENT_MODIFICATION",
      message:
        "La clase cambio mientras se promovia la waitlist. Intenta de nuevo.",
    });
  }

  console.error(
    "POST /api/admin/classes/[id]/waitlist/[entryId]/promote error:",
    error
  );

  return j(500, {
    error: "INTERNAL_ERROR",
    message: "No se pudo agregar el usuario desde la lista de espera.",
  });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  const { id: classId, entryId } = await ctx.params;

  try {
    for (let attempt = 1; attempt <= MAX_SERIALIZABLE_RETRIES; attempt += 1) {
      try {
        const result = await prisma.$transaction(
          async (tx) => {
            const entry = await tx.waitlist.findUnique({
              where: { id: entryId },
              select: {
                id: true,
                classId: true,
                userId: true,
              },
            });

            if (!entry || entry.classId !== classId) {
              throw { code: "WAITLIST_ENTRY_NOT_FOUND" } satisfies PromoteWaitlistError;
            }

            // Delete first so a concurrent admin cannot promote the same row twice.
            await tx.waitlist.delete({
              where: { id: entry.id },
            });

            return createBookingWithCreditCheck(tx, {
              classId,
              userId: entry.userId,
              quantity: 1,
              allowPastStart: true,
            });
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          }
        );

        return NextResponse.json({
          ok: true,
          bookingId: result.id,
        });
      } catch (error) {
        const retryable =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2034";

        if (!retryable || attempt === MAX_SERIALIZABLE_RETRIES) {
          throw error;
        }
      }
    }

    throw new Error("UNREACHABLE");
  } catch (error) {
    return errorResponse(error);
  }
}
