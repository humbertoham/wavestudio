import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { getAuth } from "@/lib/auth";
import {
  createSingleSeatBookingWithDebit,
  isManagedBookingError,
} from "@/lib/class-booking";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CANCEL_WINDOW_MIN = 240;

function j(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

function isRetryableTransactionError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

type CancelResult = {
  id: string;
  status: string;
  createdAt: Date;
  canceledAt: Date | null;
  class: {
    id: string;
    title: string;
    focus: string;
    date: Date;
    durationMin: number;
    creditCost: number | null;
    instructor: {
      id: string;
      name: string;
    };
  };
  refundedCredits: number;
};

export async function PATCH(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuth();
    if (!auth) return j(401, { code: "UNAUTHENTICATED" });

    const { id } = await ctx.params;

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        class: {
          select: {
            id: true,
            title: true,
            focus: true,
            date: true,
            durationMin: true,
            creditCost: true,
            instructor: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!booking) return j(404, { code: "NOT_FOUND" });
    if (booking.userId !== auth.sub) return j(403, { code: "FORBIDDEN" });
    if (booking.status !== "ACTIVE") {
      return j(409, { code: "ALREADY_CANCELED" });
    }

    if (booking.class.date.getTime() <= Date.now()) {
      return j(409, {
        code: "CLASS_ALREADY_STARTED",
        message: "La clase ya comenzo y no puede cancelarse.",
      });
    }

    const minutesUntilStart = Math.floor(
      (booking.class.date.getTime() - Date.now()) / 60000
    );
    const isLateCancel = minutesUntilStart < CANCEL_WINDOW_MIN;
    const seatsReleased = booking.quantity ?? 1;

    let result: CancelResult | null = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        result = await prisma.$transaction(
          async (tx) => {
            const updated = await tx.booking.update({
              where: { id: booking.id },
              data: {
                status: "CANCELED",
                canceledAt: new Date(),
                refundToken: !isLateCancel,
              },
              include: {
                class: {
                  select: {
                    id: true,
                    title: true,
                    focus: true,
                    date: true,
                    durationMin: true,
                    creditCost: true,
                    instructor: { select: { id: true, name: true } },
                  },
                },
              },
            });

            let refundedCredits = 0;

            if (!isLateCancel) {
              const alreadyRefunded = await tx.tokenLedger.findFirst({
                where: {
                  bookingId: booking.id,
                  reason: "CANCEL_REFUND",
                },
              });

              if (!alreadyRefunded) {
                const debits = await tx.tokenLedger.findMany({
                  where: {
                    bookingId: booking.id,
                    reason: "BOOKING_DEBIT",
                  },
                });

                for (const debit of debits) {
                  const refundAmount = Math.abs(debit.delta);
                  refundedCredits += refundAmount;

                  if (debit.packPurchaseId) {
                    await tx.packPurchase.update({
                      where: { id: debit.packPurchaseId },
                      data: {
                        classesLeft: { increment: refundAmount },
                      },
                    });
                  }

                  await tx.tokenLedger.create({
                    data: {
                      userId: booking.userId!,
                      packPurchaseId: debit.packPurchaseId,
                      bookingId: booking.id,
                      delta: refundAmount,
                      reason: "CANCEL_REFUND",
                    },
                  });
                }
              }
            }

            const waitlistEntries = await tx.waitlist.findMany({
              where: { classId: booking.classId },
              orderBy: [{ position: "asc" }, { createdAt: "asc" }],
              select: {
                id: true,
                userId: true,
              },
            });

            let promotedSeats = 0;

            for (const entry of waitlistEntries) {
              if (promotedSeats >= seatsReleased) break;

              try {
                await createSingleSeatBookingWithDebit(tx, {
                  classId: booking.classId,
                  userId: entry.userId,
                });

                await tx.waitlist.delete({
                  where: { id: entry.id },
                });

                promotedSeats += 1;
              } catch (error) {
                if (
                  isManagedBookingError(error) &&
                  error.code === "NO_CREDITS_AVAILABLE"
                ) {
                  continue;
                }

                if (
                  isManagedBookingError(error) &&
                  (error.code === "USER_ALREADY_BOOKED" ||
                    error.code === "USER_NOT_FOUND" ||
                    error.code === "BOOKING_BLOCKED")
                ) {
                  await tx.waitlist.delete({
                    where: { id: entry.id },
                  });
                  continue;
                }

                if (
                  isManagedBookingError(error) &&
                  (error.code === "CLASS_ALREADY_STARTED" ||
                    error.code === "CLASS_FULL")
                ) {
                  break;
                }

                throw error;
              }
            }

            return {
              id: updated.id,
              status: updated.status,
              createdAt: updated.createdAt,
              canceledAt: updated.canceledAt,
              class: updated.class,
              refundedCredits,
            };
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

    if (!result) {
      return j(409, {
        code: "REQUEST_CONFLICT",
        message: "La clase cambiÃ³ mientras se cancelaba la reserva. Intenta nuevamente.",
      });
    }

    return j(200, {
      id: result.id,
      status: result.status,
      createdAt: result.createdAt,
      canceledAt: result.canceledAt,
      quantity: booking.quantity,
      lateCancel: isLateCancel,
      refundedCredits: result.refundedCredits,
      class: {
        id: result.class.id,
        title: result.class.title,
        focus: result.class.focus,
        date: result.class.date.toISOString(),
        durationMin: result.class.durationMin,
        creditCost: result.class.creditCost ?? 1,
        instructor: result.class.instructor,
      },
    });
  } catch (error) {
    if (isRetryableTransactionError(error)) {
      return j(409, {
        code: "REQUEST_CONFLICT",
        message: "La clase cambiÃ³ mientras se cancelaba la reserva. Intenta nuevamente.",
      });
    }

    console.error("PATCH /api/bookings/[id]/cancel error:", error);
    return j(500, { code: "INTERNAL" });
  }
}
