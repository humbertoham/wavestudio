import { BookingStatus, Prisma, TokenReason } from "@prisma/client";

export type ManagedBookingErrorCode =
  | "CLASS_NOT_FOUND"
  | "CLASS_CANCELED"
  | "CLASS_ALREADY_STARTED"
  | "CLASS_FULL"
  | "USER_NOT_FOUND"
  | "BOOKING_BLOCKED"
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

export async function getAvailableBookingCredits(
  tx: Prisma.TransactionClient,
  userId: string,
  now = new Date()
) {
  const packs = await tx.packPurchase.aggregate({
    where: {
      userId,
      expiresAt: { gt: now },
      classesLeft: { gt: 0 },
      OR: [{ pausedUntil: null }, { pausedUntil: { lte: now } }],
    },
    _sum: { classesLeft: true },
  });

  return packs._sum.classesLeft ?? 0;
}

export async function createBookingWithCreditCheck(
  tx: Prisma.TransactionClient,
  params: {
    classId: string;
    userId: string;
    quantity?: number;
    allowPastStart?: boolean;
  }
) {
  const now = new Date();
  const quantity = params.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1) {
    fail("CLASS_FULL");
  }

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

  const creditCost = Math.max(1, cls.creditCost ?? 1);

  const usedSpots = cls.bookings.reduce(
    (acc, booking) => acc + (booking.quantity ?? 1),
    0
  );

  if (usedSpots + quantity > cls.capacity) fail("CLASS_FULL");

  const user = await tx.user.findUnique({
    where: { id: params.userId },
    select: { bookingBlocked: true },
  });

  if (!user) fail("USER_NOT_FOUND");
  if (user.bookingBlocked) fail("BOOKING_BLOCKED");

  const alreadyBooked = await tx.booking.findFirst({
    where: {
      classId: params.classId,
      userId: params.userId,
      status: BookingStatus.ACTIVE,
    },
    select: { id: true },
  });

  if (alreadyBooked) fail("USER_ALREADY_BOOKED");

  const packs = await tx.packPurchase.findMany({
    where: {
      userId: params.userId,
      classesLeft: { gt: 0 },
      expiresAt: { gt: now },
      OR: [{ pausedUntil: null }, { pausedUntil: { lte: now } }],
    },
    orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
    select: { id: true, classesLeft: true },
  });

  const packBalance = packs.reduce(
    (sum, pack) => sum + pack.classesLeft,
    0
  );

  const totalCost = creditCost * quantity;
  if (packBalance < totalCost) {
    fail("NO_CREDITS_AVAILABLE");
  }

  let booking: { id: string };

  try {
    booking = await tx.booking.create({
      data: {
        userId: params.userId,
        classId: params.classId,
        quantity,
        status: BookingStatus.ACTIVE,
        packPurchaseId: packs[0]?.id ?? null,
      },
      select: { id: true },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      fail("USER_ALREADY_BOOKED");
    }

    throw error;
  }

  let remaining = totalCost;

  for (const pack of packs) {
    if (remaining <= 0) break;

    const use = Math.min(pack.classesLeft, remaining);

    const updated = await tx.packPurchase.updateMany({
      where: {
        id: pack.id,
        classesLeft: { gte: use },
      },
      data: {
        classesLeft: { decrement: use },
      },
    });

    if (updated.count !== 1) {
      fail("NO_CREDITS_AVAILABLE");
    }

    await tx.tokenLedger.create({
      data: {
        userId: params.userId,
        bookingId: booking.id,
        packPurchaseId: pack.id,
        delta: -use,
        reason: TokenReason.BOOKING_DEBIT,
      },
    });

    remaining -= use;
  }

  if (remaining > 0) {
    fail("NO_CREDITS_AVAILABLE");
  }

  return booking;
}

export async function createSingleSeatBookingWithDebit(
  tx: Prisma.TransactionClient,
  params: {
    classId: string;
    userId: string;
    allowPastStart?: boolean;
  }
) {
  return createBookingWithCreditCheck(tx, {
    ...params,
    quantity: 1,
  });
}
