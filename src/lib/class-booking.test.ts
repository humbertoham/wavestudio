import { describe, expect, it, vi } from "vitest";
import { BookingStatus, TokenReason } from "@prisma/client";

import {
  createBookingWithCreditCheck,
  getAvailableBookingCredits,
} from "./class-booking";
import { businessClassDay } from "./unlimited-calendar";

const futureClassDate = () => new Date(Date.now() + 60 * 60 * 1000);

function makeTx(overrides: Record<string, unknown> = {}) {
  const tx = {
    class: {
      findUnique: vi.fn().mockResolvedValue({
        id: "class_1",
        date: futureClassDate(),
        isCanceled: false,
        capacity: 5,
        creditCost: 1,
        bookings: [],
      }),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({ bookingBlocked: false }),
    },
    booking: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "booking_1" }),
    },
    packPurchase: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { classesLeft: 3 } }),
      findMany: vi.fn().mockResolvedValue([{ id: "purchase_1", classesLeft: 3 }]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    tokenLedger: {
      create: vi.fn().mockResolvedValue({ id: "ledger_1" }),
    },
  };

  return Object.assign(tx, overrides);
}

describe("getAvailableBookingCredits", () => {
  it("uses PackPurchase.classesLeft as the only operational balance", async () => {
    const tx = makeTx({
      tokenLedger: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { delta: 99 } }),
      },
    });

    await expect(
      getAvailableBookingCredits(tx as any, "user_1", new Date("2026-01-01"))
    ).resolves.toBe(3);

    expect(tx.packPurchase.aggregate).toHaveBeenCalledWith({
      where: {
        userId: "user_1",
        expiresAt: { gt: new Date("2026-01-01") },
        classesLeft: { gt: 0 },
        OR: [{ pausedUntil: null }, { pausedUntil: { lte: new Date("2026-01-01") } }],
      },
      _sum: { classesLeft: true },
    });
    expect((tx.tokenLedger as any).aggregate).not.toHaveBeenCalled();
  });
});

describe("createBookingWithCreditCheck", () => {
  it("creates a booking and deducts one class credit when enough credits exist", async () => {
    const tx = makeTx();

    await expect(
      createBookingWithCreditCheck(tx as any, {
        classId: "class_1",
        userId: "user_1",
      })
    ).resolves.toEqual({ id: "booking_1", debitedCredits: 1, creditCost: 1, entitlementType: "CREDITS" });

    expect(tx.class.findUnique).toHaveBeenCalledWith({
      where: { id: "class_1" },
      include: {
        bookings: {
          where: { status: BookingStatus.ACTIVE },
          select: { quantity: true },
        },
      },
    });
    expect(tx.booking.create).toHaveBeenCalledWith({
      data: {
        userId: "user_1",
        classId: "class_1",
        quantity: 1,
        status: BookingStatus.ACTIVE,
        entitlementType: "CREDITS",
        packPurchaseId: "purchase_1",
      },
      select: { id: true },
    });
    expect(tx.packPurchase.updateMany).toHaveBeenCalledWith({
      where: { id: "purchase_1", classesLeft: { gte: 1 } },
      data: { classesLeft: { decrement: 1 } },
    });
    expect(tx.tokenLedger.create).toHaveBeenCalledWith({
      data: {
        userId: "user_1",
        bookingId: "booking_1",
        packPurchaseId: "purchase_1",
        delta: -1,
        reason: TokenReason.BOOKING_DEBIT,
      },
    });
  });

  it("rejects users who only have positive TokenLedger rows but no PackPurchase balance", async () => {
    const tokenLedgerAggregate = vi
      .fn()
      .mockResolvedValue({ _sum: { delta: 10 } });
    const tx = makeTx({
      packPurchase: {
        aggregate: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn(),
      },
      tokenLedger: {
        aggregate: tokenLedgerAggregate,
        create: vi.fn(),
      },
    });

    await expect(
      createBookingWithCreditCheck(tx as any, {
        classId: "class_1",
        userId: "user_1",
      })
    ).rejects.toMatchObject({ code: "NO_CREDITS_AVAILABLE" });

    expect(tokenLedgerAggregate).not.toHaveBeenCalled();
    expect(tx.booking.create).not.toHaveBeenCalled();
    expect(tx.packPurchase.updateMany).not.toHaveBeenCalled();
  });

  it("rejects duplicate active bookings", async () => {
    const tx = makeTx({
      booking: {
        findFirst: vi.fn().mockResolvedValue({ id: "existing_booking" }),
        create: vi.fn(),
      },
    });

    await expect(
      createBookingWithCreditCheck(tx as any, {
        classId: "class_1",
        userId: "user_1",
      })
    ).rejects.toMatchObject({ code: "USER_ALREADY_BOOKED" });

    expect(tx.booking.create).not.toHaveBeenCalled();
  });

  it("rejects over-capacity bookings before creating the booking", async () => {
    const tx = makeTx({
      class: {
        findUnique: vi.fn().mockResolvedValue({
          id: "class_1",
          date: futureClassDate(),
          isCanceled: false,
          capacity: 2,
          creditCost: 1,
          bookings: [{ quantity: 1 }, { quantity: 1 }],
        }),
      },
    });

    await expect(
      createBookingWithCreditCheck(tx as any, {
        classId: "class_1",
        userId: "user_1",
      })
    ).rejects.toMatchObject({ code: "CLASS_FULL" });

    expect(tx.booking.create).not.toHaveBeenCalled();
  });

  it("deducts the full Class.creditCost across oldest packs first", async () => {
    const tx = makeTx({
      class: {
        findUnique: vi.fn().mockResolvedValue({
          id: "class_1",
          date: futureClassDate(),
          isCanceled: false,
          capacity: 5,
          creditCost: 3,
          bookings: [],
        }),
      },
      packPurchase: {
        aggregate: vi.fn(),
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: "purchase_1", classesLeft: 2 },
            { id: "purchase_2", classesLeft: 4 },
          ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    });

    await createBookingWithCreditCheck(tx as any, {
      classId: "class_1",
      userId: "user_1",
    });

    expect(tx.packPurchase.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: "purchase_1", classesLeft: { gte: 2 } },
      data: { classesLeft: { decrement: 2 } },
    });
    expect(tx.packPurchase.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: "purchase_2", classesLeft: { gte: 1 } },
      data: { classesLeft: { decrement: 1 } },
    });
    expect(tx.tokenLedger.create).toHaveBeenNthCalledWith(1, {
      data: {
        userId: "user_1",
        bookingId: "booking_1",
        packPurchaseId: "purchase_1",
        delta: -2,
        reason: TokenReason.BOOKING_DEBIT,
      },
    });
    expect(tx.tokenLedger.create).toHaveBeenNthCalledWith(2, {
      data: {
        userId: "user_1",
        bookingId: "booking_1",
        packPurchaseId: "purchase_2",
        delta: -1,
        reason: TokenReason.BOOKING_DEBIT,
      },
    });
  });

  it("uses guarded debits so classesLeft cannot go negative if balance changes concurrently", async () => {
    const tx = makeTx({
      packPurchase: {
        aggregate: vi.fn(),
        findMany: vi.fn().mockResolvedValue([{ id: "purchase_1", classesLeft: 1 }]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    });

    await expect(
      createBookingWithCreditCheck(tx as any, {
        classId: "class_1",
        userId: "user_1",
      })
    ).rejects.toMatchObject({ code: "NO_CREDITS_AVAILABLE" });

    expect(tx.packPurchase.updateMany).toHaveBeenCalledWith({
      where: { id: "purchase_1", classesLeft: { gte: 1 } },
      data: { classesLeft: { decrement: 1 } },
    });
    expect(tx.tokenLedger.create).not.toHaveBeenCalled();
  });
});

function makeUnlimitedTx(
  options: {
    credits?: number;
    used?: boolean;
    revoked?: boolean;
    monthMismatch?: boolean;
  } = {},
) {
  const day = businessClassDay(futureClassDate());
  const unlimited = {
    id: "unlimited_purchase",
    type: "MONTHLY_UNLIMITED",
    unlimitedMonth: options.monthMismatch ? (day.month % 12) + 1 : day.month,
    unlimitedYear: day.year,
    revokedAt: options.revoked ? new Date() : null,
    expiresAt: new Date(Date.now() + 90 * 86_400_000),
    pausedUntil: null,
  };
  const tx = makeTx();
  tx.packPurchase.findMany.mockImplementation(async (query: any) =>
    query.where.type === "MONTHLY_UNLIMITED"
      ? [unlimited]
      : options.credits
        ? [{ id: "credit_purchase", classesLeft: options.credits }]
        : [],
  );
  return Object.assign(tx, {
    $queryRaw: vi.fn().mockResolvedValue([{ revokedAt: null }]),
    unlimitedUsage: {
      findFirst: vi.fn().mockResolvedValue(options.used ? { id: "used_day" } : null),
      create: vi.fn().mockResolvedValue({ id: "usage_1" }),
    },
  });
}

describe("monthly unlimited booking entitlement", () => {
  it("funds one seat without credit or ledger mutations and records the class day", async () => {
    const tx = makeUnlimitedTx();

    const result = await createBookingWithCreditCheck(tx as any, {
      classId: "class_1",
      userId: "user_1",
    });

    expect(result).toMatchObject({ debitedCredits: 0, entitlementType: "MONTHLY_UNLIMITED" });
    expect(tx.booking.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        packPurchaseId: "unlimited_purchase",
        entitlementType: "MONTHLY_UNLIMITED",
      }),
    }));
    expect(tx.unlimitedUsage.create).toHaveBeenCalledWith({ data: {
      userId: "user_1", purchaseId: "unlimited_purchase", bookingId: "booking_1",
      serviceDate: businessClassDay(futureClassDate()).serviceDate,
    } });
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.packPurchase.updateMany).not.toHaveBeenCalled();
    expect(tx.tokenLedger.create).not.toHaveBeenCalled();
  });

  it("retains the daily claim and rejects a second unlimited class that day", async () => {
    const tx = makeUnlimitedTx({ used: true });

    await expect(createBookingWithCreditCheck(tx as any, {
      classId: "class_1", userId: "user_1",
    })).rejects.toMatchObject({ code: "UNLIMITED_DAILY_LIMIT" });

    expect(tx.booking.create).not.toHaveBeenCalled();
    expect(tx.unlimitedUsage.create).not.toHaveBeenCalled();
  });

  it.each([{ used: true }, { revoked: true }, { monthMismatch: true }])(
    "uses standard credits when unlimited is unavailable: %j", async (options) => {
      const tx = makeUnlimitedTx({ ...options, credits: 3 });

      const result = await createBookingWithCreditCheck(tx as any, {
        classId: "class_1", userId: "user_1",
      });

      expect(result).toMatchObject({ debitedCredits: 1, entitlementType: "CREDITS" });
      expect(tx.booking.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ packPurchaseId: "credit_purchase" }),
      }));
      expect(tx.packPurchase.updateMany).toHaveBeenCalledOnce();
      expect(tx.unlimitedUsage.create).not.toHaveBeenCalled();
      expect(tx.$queryRaw).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{ revoked: true }, "UNLIMITED_ENTITLEMENT_REVOKED"],
    [{ monthMismatch: true }, "UNLIMITED_MONTH_MISMATCH"],
  ] as const)("explains an unavailable entitlement without credits: %j", async (options, code) => {
    const tx = makeUnlimitedTx(options);

    await expect(createBookingWithCreditCheck(tx as any, {
      classId: "class_1", userId: "user_1",
    })).rejects.toMatchObject({ code });
    expect(tx.booking.create).not.toHaveBeenCalled();
  });

  it("requires standard credits for additional seats and attributes a mixed booking", async () => {
    const tx = makeUnlimitedTx({ credits: 2 });
    const result = await createBookingWithCreditCheck(tx as any, {
      classId: "class_1", userId: "user_1", quantity: 3,
    });

    expect(result).toMatchObject({ debitedCredits: 2, entitlementType: "MIXED" });
    expect(tx.tokenLedger.create).toHaveBeenCalledWith({ data: {
      userId: "user_1", bookingId: "booking_1", packPurchaseId: "credit_purchase",
      delta: -2, reason: TokenReason.BOOKING_DEBIT,
    } });
    expect(tx.unlimitedUsage.create).toHaveBeenCalledOnce();
  });

  it("does not fund extra seats with the unlimited entitlement", async () => {
    const tx = makeUnlimitedTx();
    await expect(createBookingWithCreditCheck(tx as any, {
      classId: "class_1", userId: "user_1", quantity: 2,
    })).rejects.toMatchObject({ code: "UNLIMITED_SEAT_LIMIT" });
    expect(tx.booking.create).not.toHaveBeenCalled();
  });

  it("forces a fresh transaction when revocation wins the entitlement row lock", async () => {
    const tx = makeUnlimitedTx();
    tx.$queryRaw.mockResolvedValue([{ revokedAt: new Date() }]);

    await expect(createBookingWithCreditCheck(tx as any, {
      classId: "class_1", userId: "user_1",
    })).rejects.toMatchObject({ code: "P2034" });
    expect(tx.booking.create).not.toHaveBeenCalled();
    expect(tx.unlimitedUsage.create).not.toHaveBeenCalled();
  });
});
