import { BookingStatus, Prisma, TokenReason } from "@prisma/client";

export type ManagedBookingErrorCode =
  | "CLASS_NOT_FOUND"
  | "CLASS_CANCELED"
  | "CLASS_ALREADY_STARTED"
  | "CLASS_FULL"
  | "USER_ALREADY_BOOKED"
  | "NO_CREDITS_AVAILABLE";

export type ManagedBookingError = {
  code: ManagedBookingErrorCode;
};

function fail(code: ManagedBookingErrorCode): never {
  throw { code } satisfies ManagedBookingError;
}

export function isManagedBookingError(
  error: unknown
): error is ManagedBookingError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  );
}

export async function createSingleSeatBookingWithDebit(
  tx: Prisma.TransactionClient,
  params: {
    classId: string;
    userId: string;
    allowPastStart?: boolean;
  }
) {
  const now = new Date();

  const cls = await tx.class.findUnique({
    where: { id: params.classId },
    include: {
      bookings: {
        where: { status: BookingStatus.ACTIVE },
        select: { quantity: true },
      },
    },
  });

  if (!cls) fail("CLASS_NOT_FOUND");
  if (cls.isCanceled) fail("CLASS_CANCELED");
  if (!params.allowPastStart && cls.date.getTime() <= now.getTime()) {
    fail("CLASS_ALREADY_STARTED");
  }

  const usedSpots = cls.bookings.reduce(
    (acc, booking) => acc + (booking.quantity ?? 1),
    0
  );

  if (usedSpots >= cls.capacity) fail("CLASS_FULL");

  const alreadyBooked = await tx.booking.findFirst({
    where: {
      classId: params.classId,
      userId: params.userId,
      status: BookingStatus.ACTIVE,
    },
    select: { id: true },
  });

  if (alreadyBooked) fail("USER_ALREADY_BOOKED");

  const pack = await tx.packPurchase.findFirst({
    where: {
      userId: params.userId,
      classesLeft: { gt: 0 },
      expiresAt: { gt: now },
    },
    orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });

  if (!pack) {
    const ledgerBalance = await tx.tokenLedger.aggregate({
      where: {
        userId: params.userId,
        OR: [
          { packPurchaseId: null },
          { packPurchase: { expiresAt: { gt: now } } },
        ],
      },
      _sum: { delta: true },
    });

    if ((ledgerBalance._sum.delta ?? 0) < 1) {
      fail("NO_CREDITS_AVAILABLE");
    }
  }

  const booking = await tx.booking.create({
    data: {
      userId: params.userId,
      classId: params.classId,
      quantity: 1,
      status: BookingStatus.ACTIVE,
      packPurchaseId: pack?.id ?? null,
    },
    select: { id: true },
  });

  if (pack) {
    await tx.packPurchase.update({
      where: { id: pack.id },
      data: {
        classesLeft: { decrement: 1 },
      },
    });

    await tx.tokenLedger.create({
      data: {
        userId: params.userId,
        bookingId: booking.id,
        packPurchaseId: pack.id,
        delta: -1,
        reason: TokenReason.BOOKING_DEBIT,
      },
    });
  } else {
    await tx.tokenLedger.create({
      data: {
        userId: params.userId,
        bookingId: booking.id,
        delta: -1,
        reason: TokenReason.BOOKING_DEBIT,
      },
    });
  }

  return booking;
}
