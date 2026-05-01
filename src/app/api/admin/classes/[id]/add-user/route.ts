import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { createBookingWithCreditCheck, isManagedBookingError } from "@/lib/class-booking";

import { prisma, requireAdmin } from "../../../_utils";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
const MAX_SERIALIZABLE_RETRIES = 3;

function j(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

function errorResponse(error: unknown) {
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
          message: "No hay lugares disponibles en la clase.",
        });
      case "USER_NOT_FOUND":
        return j(404, {
          error: error.code,
          message: "El usuario no existe.",
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
        "La clase cambio mientras se agregaba el usuario. Intenta de nuevo.",
    });
  }

  console.error("POST /api/admin/classes/[id]/add-user error:", error);

  return j(500, {
    error: "INTERNAL_ERROR",
    message: "No se pudo agregar el usuario a la clase.",
  });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  const { id: classId } = await ctx.params;
  const { userId } = await req.json();

  if (!userId || typeof userId !== "string") {
    return j(400, {
      error: "MISSING_USER_ID",
      message: "Debes seleccionar un usuario.",
    });
  }

  try {
    for (let attempt = 1; attempt <= MAX_SERIALIZABLE_RETRIES; attempt += 1) {
      try {
        const result = await prisma.$transaction(
          async (tx) => {
            const booking = await createBookingWithCreditCheck(tx, {
              classId,
              userId,
              quantity: 1,
              allowPastStart: true,
            });

            await tx.waitlist.deleteMany({
              where: {
                classId,
                userId,
              },
            });

            return booking;
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
