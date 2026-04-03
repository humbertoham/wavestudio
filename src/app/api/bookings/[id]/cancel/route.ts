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
        packPurchase: { select: { id: true } },
      },
    });

    if (!booking) return j(404, { code: "NOT_FOUND" });
    if (booking.userId !== auth.sub) return j(403, { code: "FORBIDDEN" });
    if (booking.status !== "ACTIVE") {
      return j(409, { code: "ALREADY_CANCELED" });
    }

    const minutesUntilStart = Math.floor(
      (booking.class.date.getTime() - Date.now()) / 60000
    );
    const isLateCancel = minutesUntilStart < CANCEL_WINDOW_MIN;
    const seatsReleased = booking.quantity ?? 1;

    const result = await prisma.$transaction(
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
              if (debit.packPurchaseId) {
                await tx.packPurchase.update({
                  where: { id: debit.packPurchaseId },
                  data: {
                    classesLeft: { increment: Math.abs(debit.delta) },
                  },
                });
              }

              await tx.tokenLedger.create({
                data: {
                  userId: booking.userId!,
                  packPurchaseId: debit.packPurchaseId,
                  bookingId: booking.id,
                  delta: Math.abs(debit.delta),
                  reason: "CANCEL_REFUND",
                },
              });
            }
          }
        }

        for (let i = 0; i < seatsReleased; i++) {
          const next = await tx.waitlist.findFirst({
            where: { classId: booking.classId },
            orderBy: [{ position: "asc" }, { createdAt: "asc" }],
            select: {
              id: true,
              userId: true,
            },
          });

          if (!next) break;

          try {
            await createSingleSeatBookingWithDebit(tx, {
              classId: booking.classId,
              userId: next.userId,
            });

            await tx.waitlist.delete({
              where: { id: next.id },
            });
          } catch (error) {
            if (
              isManagedBookingError(error) &&
              error.code === "USER_ALREADY_BOOKED"
            ) {
              await tx.waitlist.delete({
                where: { id: next.id },
              });
              i -= 1;
              continue;
            }

            if (
              isManagedBookingError(error) &&
              (error.code === "NO_CREDITS_AVAILABLE" ||
                error.code === "CLASS_ALREADY_STARTED" ||
                error.code === "CLASS_FULL")
            ) {
              break;
            }

            throw error;
          }
        }

        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    return j(200, {
      id: result.id,
      status: result.status,
      createdAt: result.createdAt,
      canceledAt: result.canceledAt,
      quantity: booking.quantity,
      lateCancel: isLateCancel,
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
    console.error(error);
    return j(500, { code: "INTERNAL" });
  }
}
