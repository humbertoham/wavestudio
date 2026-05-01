import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import {
  createBookingWithCreditCheck,
  isManagedBookingError,
} from "@/lib/class-booking";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const BOOKING_BLOCKED_MESSAGE =
  "Hola, debido a nuestras politicas de cancelacion, tus creditos estan bloqueados por una cancelacion tardia o falta a clase. Para desbloquearlos, es necesario liquidar el monto de $100. Contactanos por DM para realizar el pago.";

const bodySchema = z.object({
  userId: z.string().min(1),
  classId: z.string().min(1),
});

type AdminBookingErrorCode =
  | "CLASS_NOT_FOUND"
  | "USER_NOT_FOUND"
  | "BOOKING_BLOCKED"
  | "CLASS_CANCELED"
  | "CLASS_IN_PAST"
  | "CLASS_FULL"
  | "ALREADY_ENROLLED";

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

function methodNotAllowed() {
  return json(405, { error: "METHOD_NOT_ALLOWED" });
}

function isRetryableTransactionError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
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
    const me = await requireAdmin(req).catch(() => null);
    if (!me) return json(403, { error: "FORBIDDEN" });

    const body = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return json(400, { error: "INVALID_BODY" });

    const { userId, classId } = parsed.data;

    let booking:
      | {
          id: string;
          class: {
            id: string;
            title: string;
            date: Date;
          };
          user: {
            id: string;
            email: string;
          } | null;
        }
      | null = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        booking = await prisma.$transaction(
          async (tx) => {
            const created = await createBookingWithCreditCheck(tx, {
              classId,
              userId,
              quantity: 1,
            });

            const fullBooking = await tx.booking.findUnique({
              where: { id: created.id },
              include: {
                class: { select: { id: true, title: true, date: true } },
                user: { select: { id: true, email: true } },
              },
            });

            if (!fullBooking) {
              throw new Error("BOOKING_CREATE_FAILED");
            }

            return fullBooking;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        );

        break;
      } catch (error) {
        if (isRetryableTransactionError(error) && attempt < 2) {
          continue;
        }

        throw error;
      }
    }

    if (!booking) {
      return json(409, {
        error: "CONCURRENT_MODIFICATION",
        message: "La clase cambiÃ³ mientras guardÃ¡bamos la reserva. Intenta nuevamente.",
      });
    }

    return NextResponse.json(
      { ok: true, booking },
      { status: 201, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error: unknown) {
    const code = isManagedBookingError(error)
      ? error.code
      : typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : null;

    switch (code) {
      case "CLASS_NOT_FOUND":
        return json(404, { error: "CLASS_NOT_FOUND" });
      case "USER_NOT_FOUND":
        return json(404, { error: "USER_NOT_FOUND" });
      case "BOOKING_BLOCKED":
        return json(403, {
          code: "BOOKING_BLOCKED",
          error: BOOKING_BLOCKED_MESSAGE,
        });
      case "CLASS_CANCELED":
        return json(409, { error: "CLASS_CANCELED" });
      case "CLASS_ALREADY_STARTED":
      case "CLASS_IN_PAST":
        return json(409, { error: "CLASS_IN_PAST" });
      case "CLASS_FULL":
        return json(409, { error: "CLASS_FULL" });
      case "USER_ALREADY_BOOKED":
      case "ALREADY_ENROLLED":
        return json(409, { error: "ALREADY_ENROLLED" });
      case "NO_CREDITS_AVAILABLE":
        return json(409, { error: "NO_CREDITS_AVAILABLE" });
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return json(409, { error: "ALREADY_ENROLLED" });
    }

    if (isRetryableTransactionError(error)) {
      return json(409, {
        error: "CONCURRENT_MODIFICATION",
        message: "La clase cambiÃ³ mientras guardÃ¡bamos la reserva. Intenta nuevamente.",
      });
    }

    console.error("POST /api/admin/booking error:", error);
    return json(500, { error: "INTERNAL_ERROR" });
  }
}
