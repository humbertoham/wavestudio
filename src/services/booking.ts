// services/booking.ts
import { prisma } from "@/lib/prisma";

export async function reserveClass(opts: {
  userId: string;
  classId: string;
  quantity?: number;
}) {
  const quantity = Math.max(1, opts.quantity ?? 1);

  return prisma.$transaction(async (tx) => {
    const cls = await tx.class.findUnique({
      where: { id: opts.classId },
      select: {
        id: true,
        date: true,
        capacity: true,
        creditCost: true,        // 👈 NECESARIO si luego usas cls.creditCost
        isCanceled: true,
        cancelBeforeMin: true,
        bookings: {              // 👈 si vas a sumar cupos con reduce
          where: { status: "ACTIVE" },
          select: { quantity: true }, // 👈 NECESARIO para used
        },
      },
    });
    if (!cls || cls.isCanceled) throw new Error("CLASS_NOT_AVAILABLE");

    const used = cls.bookings.reduce((a, b) => a + b.quantity, 0);
    const remaining = cls.capacity - used;
    if (remaining < quantity) throw new Error("NO_CAPACITY");

    const now = new Date();
    const cost = cls.creditCost * quantity;

    // compra activa con saldo suficiente
    const purchase = await tx.packPurchase.findFirst({
      where: {
        userId: opts.userId,
        expiresAt: { gt: now },
        classesLeft: { gte: cost },
      },
      orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
    });
    if (!purchase) throw new Error("NO_TOKENS");

    const booking = await tx.booking.create({
      data: {
        userId: opts.userId,
        classId: opts.classId,
        status: "ACTIVE",
        quantity,                    // 👈 usa quantity
        packPurchaseId: purchase.id,
      },
    });

    await tx.tokenLedger.create({
      data: {
        userId: opts.userId,
        packPurchaseId: purchase.id,
        bookingId: booking.id,
        delta: -cost,
        reason: "BOOKING_DEBIT",
      },
    });

    await tx.packPurchase.update({
      where: { id: purchase.id },
      data: { classesLeft: { decrement: cost } },
    });

    return booking;
  });
}
