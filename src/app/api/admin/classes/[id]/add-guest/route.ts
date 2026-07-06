import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { prisma, requireAdmin } from "../../../_utils";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
type AddGuestErrorCode =
  | "MISSING_GUEST_NAME"
  | "CLASS_NOT_FOUND"
  | "CLASS_CANCELED"
  | "CLASS_FULL";

function j(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

function fail(code: AddGuestErrorCode): never {
  throw { code } as { code: AddGuestErrorCode };
}

function isRetryableTransactionError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  const { id: classId } = await ctx.params;
  const { name } = await req.json();

  const guestName = String(name ?? "").trim();
  if (!guestName) {
    return j(400, { error: "MISSING_GUEST_NAME" });
  }

  try {
    let booking:
      | {
          id: string;
          guestName: string | null;
        }
      | null = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        booking = await prisma.$transaction(
          async (tx) => {
            const cls = await tx.class.findUnique({
              where: { id: classId },
              include: {
                bookings: {
                  where: { status: "ACTIVE" },
                  select: { quantity: true },
                },
              },
            });

            if (!cls) fail("CLASS_NOT_FOUND");
            if (cls.isCanceled) fail("CLASS_CANCELED");

            const usedSpots = cls.bookings.reduce(
              (acc, current) => acc + (current.quantity ?? 1),
              0
            );

            if (usedSpots >= cls.capacity) fail("CLASS_FULL");

            return tx.booking.create({
              data: {
                classId,
                guestName,
                quantity: 1,
                status: "ACTIVE",
              },
              select: {
                id: true,
                guestName: true,
              },
            });
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
      return j(409, {
        error: "CONCURRENT_MODIFICATION",
        message: "La clase cambiÃ³ mientras guardÃ¡bamos al invitado. Intenta nuevamente.",
      });
    }

    return NextResponse.json({
      ok: true,
      bookingId: booking.id,
      guestName: booking.guestName,
    });
  } catch (error: unknown) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : null;

    switch (code) {
      case "CLASS_NOT_FOUND":
        return j(404, { error: "CLASS_NOT_FOUND" });
      case "CLASS_CANCELED":
        return j(409, { error: "CLASS_CANCELED" });
      case "CLASS_FULL":
        return j(409, { error: "CLASS_FULL" });
    }

    if (isRetryableTransactionError(error)) {
      return j(409, {
        error: "CONCURRENT_MODIFICATION",
        message: "La clase cambiÃ³ mientras guardÃ¡bamos al invitado. Intenta nuevamente.",
      });
    }

    console.error("POST /api/admin/classes/[id]/add-guest error:", error);
    return j(500, { error: "INTERNAL_ERROR" });
  }
}
