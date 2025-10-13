// src/services/cancel-booking.ts
import { prisma } from "@/lib/prisma";

export async function cancelBooking(bookingId: string, byUserId?: string) {
  return prisma.$transaction(async (tx) => {
    const b = await tx.booking.findUnique({
      where: { id: bookingId },
      include: {
        class: { select: { date: true, cancelBeforeMin: true, creditCost: true } },
      },
    });
    if (!b) throw new Error("BOOKING_NOT_FOUND");
    if (byUserId && b.userId !== byUserId) throw new Error("FORBIDDEN");
    if (b.status !== "ACTIVE") return b;

    const now = new Date();
    const start = b.class.date;
    const windowMin = b.class.cancelBeforeMin ?? 0;
    const canRefund = now <= new Date(start.getTime() - windowMin * 60 * 1000);

    const cost = b.class.creditCost * b.quantity;

    await tx.booking.update({
      where: { id: b.id },
      data: {
        status: "CANCELED",
        canceledAt: now,
        refundToken: canRefund,
      },
    });

    if (canRefund && b.packPurchaseId) {
      await tx.tokenLedger.create({
        data: {
          userId: b.userId,
          packPurchaseId: b.packPurchaseId!,
          bookingId: b.id,
          delta: +cost,
          reason: "CANCEL_REFUND",
        },
      });
      await tx.packPurchase.update({
        where: { id: b.packPurchaseId! },
        data: { classesLeft: { increment: cost } },
      });
    }

    return { canceled: true, refund: canRefund };
  });
}
