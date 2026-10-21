import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma, requireClassManager } from "../../_utils";
import {
  isBookingTransactionConflict,
  refundBookingCredits,
  releaseUnlimitedUsage,
} from "@/lib/monthly-unlimited";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const denied = await requireClassManager(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await prisma.$transaction(
          async (tx) => {
            const booking = await tx.booking.findUnique({
              where: { id },
              include: { class: { select: { date: true } } },
            });
            if (!booking) return null;
            if (booking.status !== "ACTIVE")
              return { ...booking, alreadyCanceled: true, refunded: false };
            const now = new Date();
            const unlimited =
              booking.entitlementType === "MONTHLY_UNLIMITED" ||
              booking.entitlementType === "MIXED";
            const onTime =
              Math.floor(
                (booking.class.date.getTime() - now.getTime()) / 60000,
              ) >= 240;
            const refund = !unlimited || onTime;
            const changed = await tx.booking.updateMany({
              where: { id, status: "ACTIVE" },
              data: {
                status: "CANCELED",
                canceledAt: now,
                refundToken: refund,
              },
            });
            if (!changed.count) throw { code: "P2034" };
            if (refund) await refundBookingCredits(tx, booking);
            if (unlimited && onTime) await releaseUnlimitedUsage(tx, id, now);
            return { ...booking, alreadyCanceled: false, refunded: refund };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        if (!result)
          return NextResponse.json(
            { error: "BOOKING_NOT_FOUND" },
            { status: 404 },
          );
        return NextResponse.json({
          ok: true,
          alreadyCanceled: result.alreadyCanceled,
          refunded: result.refunded,
          quantity: result.quantity,
        });
      } catch (error) {
        if (isBookingTransactionConflict(error) && attempt < 2) continue;
        throw error;
      }
    }
  } catch (error) {
    return NextResponse.json(
      {
        error: isBookingTransactionConflict(error)
          ? "REQUEST_CONFLICT"
          : "INTERNAL_ERROR",
      },
      { status: isBookingTransactionConflict(error) ? 409 : 500 },
    );
  }
}
