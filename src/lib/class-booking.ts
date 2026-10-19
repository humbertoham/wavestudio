import { BookingStatus, Prisma, TokenReason } from "@prisma/client";
import { getUnlimitedEligibility, type UnlimitedErrorCode, unlimitedErrorMessages } from "@/lib/monthly-unlimited";

export type ManagedBookingErrorCode =
  | "CLASS_NOT_FOUND"
  | "CLASS_CANCELED"
  | "CLASS_ALREADY_STARTED"
  | "CLASS_FULL"
  | "USER_NOT_FOUND"
  | "BOOKING_BLOCKED"
  | "USER_ALREADY_BOOKED"
  | "NO_CREDITS_AVAILABLE"
  | UnlimitedErrorCode;

export type ManagedBookingError = {
  code: ManagedBookingErrorCode;
  message?: string;
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

  if (!cls || cls.deletedAt) fail("CLASS_NOT_FOUND");
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

  const unlimited = await getUnlimitedEligibility(tx, params.userId, cls.date, now);
  const totalCost = creditCost * (quantity - (unlimited.purchase ? 1 : 0));
  if (packBalance < totalCost) {
    if (unlimited.purchase && quantity > 1) throw { code: "UNLIMITED_SEAT_LIMIT", message: unlimitedErrorMessages.UNLIMITED_SEAT_LIMIT };
    if (unlimited.reason) throw { code: unlimited.reason, message: unlimited.message };
    fail("NO_CREDITS_AVAILABLE");
  }

  const entitlementType = unlimited.purchase ? (quantity > 1 ? "MIXED" : "MONTHLY_UNLIMITED") : "CREDITS";

  if (unlimited.purchase) {
    // Hold until booking commit. Admin revocation locks this exact same row.
    // A stale SERIALIZABLE snapshot fails here and the caller retries; under
    // READ COMMITTED the returned state is the latest committed state.
    const rows = await tx.$queryRaw<{ revokedAt: Date | null }[]>`
      SELECT "revokedAt" FROM "PackPurchase"
      WHERE "id" = ${unlimited.purchase.id} AND "userId" = ${params.userId}
      FOR UPDATE
    `;
    if (!rows.length || rows[0].revokedAt) throw { code: "P2034" };
  }

  // Database conflicts must escape this transaction so the caller can retry
  // with a fresh snapshot (especially automatic waitlist promotion).
  const booking = await tx.booking.create({
      data: {
        userId: params.userId,
        classId: params.classId,
        quantity,
        status: BookingStatus.ACTIVE,
        entitlementType,
        packPurchaseId: unlimited.purchase?.id ?? packs[0]?.id ?? null,
      },
      select: { id: true },
    });

  if (unlimited.purchase) await tx.unlimitedUsage.create({ data: {
    userId: params.userId, purchaseId: unlimited.purchase.id, bookingId: booking.id,
    serviceDate: unlimited.day.serviceDate,
  } });

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

  return { ...booking, debitedCredits: totalCost, creditCost, entitlementType };
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
