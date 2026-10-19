import type { Prisma, PackType } from "@prisma/client";
import {
  businessClassDay,
  monthlyPeriod,
  monthLabel,
  unlimitedErrorMessages,
  type UnlimitedErrorCode,
} from "@/lib/unlimited-calendar";

import { getPackageExpirationAt11Pm } from "@/lib/package-expiration";

export type PackageSnapshot = {
  type: PackType;
  name: string;
  price: number;
  classes: number;
  validityDays: number;
  unlimitedMonth: number | null;
  unlimitedYear: number | null;
  periodKey: string | null;
};

export {
  businessClassDay,
  monthlyPeriod,
  monthLabel,
  unlimitedErrorMessages,
} from "@/lib/unlimited-calendar";
export type { UnlimitedErrorCode } from "@/lib/unlimited-calendar";

export function packageSnapshot(pack: {
  type?: PackType;
  name: string;
  price: number;
  classes: number;
  validityDays: number;
  unlimitedMonth?: number | null;
  unlimitedYear?: number | null;
}): PackageSnapshot {
  const unlimited = pack.type === "MONTHLY_UNLIMITED";
  if (unlimited) monthlyPeriod(pack.unlimitedYear!, pack.unlimitedMonth!);
  return {
    type: unlimited ? "MONTHLY_UNLIMITED" : "STANDARD",
    name: pack.name,
    price: pack.price,
    classes: unlimited ? 0 : pack.classes,
    validityDays: unlimited ? 0 : pack.validityDays,
    unlimitedMonth: unlimited ? pack.unlimitedMonth! : null,
    unlimitedYear: unlimited ? pack.unlimitedYear! : null,
    periodKey: unlimited
      ? `${pack.unlimitedYear}-${String(pack.unlimitedMonth).padStart(2, "0")}`
      : null,
  };
}

export function readPackageSnapshot(value: unknown): PackageSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as PackageSnapshot;
  if (
    !["STANDARD", "MONTHLY_UNLIMITED"].includes(v.type) ||
    typeof v.name !== "string" ||
    !Number.isInteger(v.price) ||
    v.price < 0
  )
    return null;
  if (v.type === "MONTHLY_UNLIMITED") {
    try {
      monthlyPeriod(v.unlimitedYear!, v.unlimitedMonth!);
    } catch {
      return null;
    }
  } else if (
    !Number.isInteger(v.classes) ||
    v.classes <= 0 ||
    !Number.isInteger(v.validityDays) ||
    v.validityDays <= 0
  )
    return null;
  return packageSnapshot(v);
}

/** Payment id has a database unique constraint; callers grant inside a transaction. */
export async function grantPackagePurchase(
  tx: Prisma.TransactionClient,
  params: {
    userId: string;
    packId: string;
    snapshot: PackageSnapshot;
    paymentId?: string;
    now?: Date;
  },
) {
  if (params.paymentId) {
    const existing = await tx.packPurchase.findUnique({
      where: { paymentId: params.paymentId },
    });
    if (existing) return existing;
    const payment = await tx.payment.findUnique({
      where: { id: params.paymentId },
      select: { status: true, userId: true, amount: true, currency: true },
    });
    if (
      !payment ||
      payment.status !== "APPROVED" ||
      payment.userId !== params.userId ||
      payment.amount !== params.snapshot.price ||
      payment.currency !== "MXN"
    ) {
      throw new Error("PACKAGE_PAYMENT_NOT_APPROVED");
    }
  }
  const now = params.now ?? new Date();
  const s = params.snapshot;
  const unlimited = s.type === "MONTHLY_UNLIMITED";
  const purchase = await tx.packPurchase.create({
    data: {
      userId: params.userId,
      packId: params.packId,
      paymentId: params.paymentId,
      type: s.type,
      unlimitedMonth: s.unlimitedMonth,
      unlimitedYear: s.unlimitedYear,
      nameSnapshot: s.name,
      priceSnapshot: s.price,
      classesLeft: unlimited ? 0 : s.classes,
      expiresAt: unlimited
        ? monthlyPeriod(s.unlimitedYear!, s.unlimitedMonth!).expiresAt
        : getPackageExpirationAt11Pm(now, s.validityDays),
    },
  });
  if (!unlimited)
    await tx.tokenLedger.create({
      data: {
        userId: params.userId,
        packPurchaseId: purchase.id,
        delta: s.classes,
        reason: "PURCHASE_CREDIT",
      },
    });
  return purchase;
}

export async function getUnlimitedEligibility(
  tx: Prisma.TransactionClient,
  userId: string,
  classDate: Date,
  now = new Date(),
) {
  const day = businessClassDay(classDate);
  const purchases = (
    await tx.packPurchase.findMany({
      where: { userId, type: "MONTHLY_UNLIMITED" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        type: true,
        unlimitedMonth: true,
        unlimitedYear: true,
        nameSnapshot: true,
        revokedAt: true,
        expiresAt: true,
        pausedUntil: true,
      },
    })
  ).filter((p) => p.type === "MONTHLY_UNLIMITED");
  const matching = purchases.filter(
    (p) => p.unlimitedMonth === day.month && p.unlimitedYear === day.year,
  );
  const eligible = matching.find(
    (p) =>
      !p.revokedAt &&
      p.expiresAt > now &&
      (!p.pausedUntil || p.pausedUntil <= now),
  );
  let reason: UnlimitedErrorCode | null = null;
  if (!eligible) {
    if (matching.length)
      reason = matching.every((p) => !!p.revokedAt)
        ? "UNLIMITED_ENTITLEMENT_REVOKED"
        : "UNLIMITED_NOT_ACTIVE";
    else if (purchases.length) reason = "UNLIMITED_MONTH_MISMATCH";
    const first = purchases.find((p) => !p.revokedAt) ?? purchases[0];
    return {
      purchase: null,
      day,
      reason,
      message:
        reason === "UNLIMITED_MONTH_MISMATCH" && first
          ? `Tu paquete ilimitado solo permite reservar clases de ${monthLabel(first.unlimitedYear!, first.unlimitedMonth!)}.`
          : reason
            ? unlimitedErrorMessages[reason]
            : null,
    };
  }
  const used = await tx.unlimitedUsage.findFirst({
    where: { userId, serviceDate: day.serviceDate, releasedAt: null },
    select: { id: true },
  });
  return {
    purchase: used ? null : eligible,
    day,
    reason: used ? ("UNLIMITED_DAILY_LIMIT" as const) : null,
    message: used ? unlimitedErrorMessages.UNLIMITED_DAILY_LIMIT : null,
  };
}

export async function releaseUnlimitedUsage(
  tx: Prisma.TransactionClient,
  bookingId: string,
  now = new Date(),
  reason = "ON_TIME_CANCEL",
) {
  return tx.unlimitedUsage.updateMany({
    where: { bookingId, releasedAt: null },
    data: { releasedAt: now, releaseReason: reason },
  });
}

export async function refundBookingCredits(
  tx: Prisma.TransactionClient,
  booking: { id: string; userId: string | null },
) {
  if (
    await tx.tokenLedger.findFirst({
      where: { bookingId: booking.id, reason: "CANCEL_REFUND" },
    })
  )
    return 0;
  const debits = await tx.tokenLedger.findMany({
    where: { bookingId: booking.id, reason: "BOOKING_DEBIT" },
  });
  let refunded = 0;
  for (const debit of debits) {
    const amount = Math.abs(debit.delta);
    if (debit.packPurchaseId)
      await tx.packPurchase.update({
        where: { id: debit.packPurchaseId },
        data: { classesLeft: { increment: amount } },
      });
    await tx.tokenLedger.create({
      data: {
        userId: booking.userId!,
        bookingId: booking.id,
        packPurchaseId: debit.packPurchaseId,
        delta: amount,
        reason: "CANCEL_REFUND",
      },
    });
    refunded += amount;
  }
  return refunded;
}

/** Reversals preserve history, cancel future access, and retain spent daily claims. */
export async function revokeUnlimitedPurchase(
  tx: Prisma.TransactionClient,
  purchaseId: string,
  reason: string,
  now = new Date(),
) {
  const purchase = await tx.packPurchase.findUnique({
    where: { id: purchaseId },
  });
  if (!purchase || purchase.type !== "MONTHLY_UNLIMITED")
    return {
      debt: false,
      released: [] as { classId: string; seatsReleased: number }[],
    };
  if (purchase.revokedAt) {
    if (reason === "CHARGEBACK") {
      const blocked = await tx.user.updateMany({
        where: { id: purchase.userId, bookingBlocked: false },
        data: { bookingBlocked: true, bookingBlockedAt: now },
      });
      if (blocked.count)
        await tx.bookingBlockLog.create({
          data: { userId: purchase.userId, blocked: true },
        });
      await tx.packPurchase.update({
        where: { id: purchase.id },
        data: { revocationReason: reason },
      });
    }
    return {
      debt: reason === "CHARGEBACK",
      released: [] as { classId: string; seatsReleased: number }[],
    };
  }
  await tx.packPurchase.update({
    where: { id: purchase.id },
    data: { revokedAt: now, revocationReason: reason },
  });
  const usages = await tx.unlimitedUsage.findMany({
    where: { purchaseId, releasedAt: null },
    include: { booking: { include: { class: { select: { date: true } } } } },
  });
  let debt = reason === "CHARGEBACK";
  const released: { classId: string; seatsReleased: number }[] = [];
  for (const usage of usages) {
    const b = usage.booking;
    if (b.status === "ACTIVE" && b.class.date > now) {
      const changed = await tx.booking.updateMany({
        where: { id: b.id, status: "ACTIVE" },
        data: { status: "CANCELED", canceledAt: now, refundToken: true },
      });
      if (changed.count) {
        await refundBookingCredits(tx, b);
        await releaseUnlimitedUsage(tx, b.id, now, "PAYMENT_REVERSAL");
        released.push({ classId: b.classId, seatsReleased: b.quantity });
      }
    } else {
      debt = true;
    }
  }
  if (debt) {
    await tx.user.update({
      where: { id: purchase.userId },
      data: { bookingBlocked: true, bookingBlockedAt: now },
    });
    await tx.bookingBlockLog.create({
      data: { userId: purchase.userId, blocked: true },
    });
  }
  return { debt, released };
}

export function isBookingTransactionConflict(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; meta?: { target?: unknown; code?: string } };
  const target = String(e.meta?.target);
  return (
    e.code === "P2034" ||
    // PostgreSQL reports conflicts from SELECT ... FOR UPDATE as raw-query
    // errors. Retry the entire transaction, never just the locking statement.
    (e.code === "P2010" && ["40001", "40P01"].includes(e.meta?.code ?? "")) ||
    (e.code === "P2002" &&
      (/serviceDate|UnlimitedUsage_one_consumed_day/.test(target) ||
        (/userId/.test(target) && /classId/.test(target))))
  );
}
