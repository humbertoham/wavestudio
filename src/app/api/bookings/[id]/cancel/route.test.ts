import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuth: vi.fn(),
  prisma: {
    booking: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  createSingleSeatBookingWithDebit: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getAuth: mocks.getAuth,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/lib/class-booking", () => ({
  createSingleSeatBookingWithDebit: mocks.createSingleSeatBookingWithDebit,
  isManagedBookingError: (error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string",
}));

import { PATCH } from "./route";

function ctx(id = "booking_1") {
  return { params: Promise.resolve({ id }) };
}

function activeBooking(classDate: Date) {
  return {
    id: "booking_1",
    userId: "user_1",
    classId: "class_1",
    status: "ACTIVE",
    quantity: 1,
    class: {
      id: "class_1",
      title: "Pilates",
      focus: "Core",
      date: classDate,
      durationMin: 50,
      creditCost: 1,
      instructor: { id: "instructor_1", name: "Teacher" },
    },
  };
}

describe("PATCH /api/bookings/[id]/cancel", () => {
  beforeEach(() => {
    mocks.getAuth.mockResolvedValue({ sub: "user_1" });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("blocks cancellation after class start and leaves booking/credits untouched", async () => {
    mocks.prisma.booking.findUnique.mockResolvedValue(
      activeBooking(new Date(Date.now() - 60_000))
    );

    const res = await PATCH(new Request("https://example.test") as any, ctx());

    await expect(res.json()).resolves.toMatchObject({
      code: "CLASS_ALREADY_STARTED",
    });
    expect(res.status).toBe(409);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.createSingleSeatBookingWithDebit).not.toHaveBeenCalled();
  });

  it("still cancels a future booking and refunds the debited PackPurchase credits", async () => {
    const startedAt = new Date();
    const canceledAt = new Date();
    mocks.prisma.booking.findUnique.mockResolvedValue(
      activeBooking(new Date(Date.now() + 5 * 60 * 60 * 1000))
    );

    const tx = {
      unlimitedUsage: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      booking: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue({
          id: "booking_1",
          status: "CANCELED",
          createdAt: startedAt,
          canceledAt,
          class: activeBooking(new Date(Date.now() + 5 * 60 * 60 * 1000)).class,
        }),
      },
      tokenLedger: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([
          {
            delta: -2,
            packPurchaseId: "purchase_1",
          },
        ]),
        create: vi.fn().mockResolvedValue({ id: "refund_ledger" }),
      },
      packPurchase: {
        update: vi.fn().mockResolvedValue({ id: "purchase_1" }),
      },
      waitlist: {
        findMany: vi.fn().mockResolvedValue([]),
        delete: vi.fn(),
      },
    };
    mocks.prisma.$transaction.mockImplementation(async (callback: any) =>
      callback(tx)
    );

    const res = await PATCH(new Request("https://example.test") as any, ctx());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("CANCELED");
    expect(body.refundedCredits).toBe(2);
    expect(tx.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "CANCELED",
          refundToken: true,
        }),
      })
    );
    expect(tx.packPurchase.update).toHaveBeenCalledWith({
      where: { id: "purchase_1" },
      data: { classesLeft: { increment: 2 } },
    });
    expect(tx.tokenLedger.create).toHaveBeenCalledWith({
      data: {
        userId: "user_1",
        packPurchaseId: "purchase_1",
        bookingId: "booking_1",
        delta: 2,
        reason: "CANCEL_REFUND",
      },
    });
  });

  it("skips no-credit waitlist users without deleting them and promotes the next eligible user", async () => {
    mocks.prisma.booking.findUnique.mockResolvedValue(
      activeBooking(new Date(Date.now() + 5 * 60 * 60 * 1000))
    );
    mocks.createSingleSeatBookingWithDebit
      .mockRejectedValueOnce({ code: "NO_CREDITS_AVAILABLE" })
      .mockResolvedValueOnce({ id: "promoted_booking" });

    const tx = {
      unlimitedUsage: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      booking: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue({
          id: "booking_1",
          status: "CANCELED",
          createdAt: new Date(),
          canceledAt: new Date(),
          class: activeBooking(new Date(Date.now() + 5 * 60 * 60 * 1000)).class,
        }),
      },
      tokenLedger: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
      },
      packPurchase: {
        update: vi.fn(),
      },
      waitlist: {
        findMany: vi.fn().mockResolvedValue([
          { id: "entry_no_credits", userId: "user_no_credits" },
          { id: "entry_with_credits", userId: "user_with_credits" },
        ]),
        delete: vi.fn().mockResolvedValue({}),
      },
    };
    mocks.prisma.$transaction.mockImplementation(async (callback: any) =>
      callback(tx)
    );

    const res = await PATCH(new Request("https://example.test") as any, ctx());

    expect(res.status).toBe(200);
    expect(mocks.createSingleSeatBookingWithDebit).toHaveBeenNthCalledWith(1, tx, {
      classId: "class_1",
      userId: "user_no_credits",
    });
    expect(mocks.createSingleSeatBookingWithDebit).toHaveBeenNthCalledWith(2, tx, {
      classId: "class_1",
      userId: "user_with_credits",
    });
    expect(tx.waitlist.delete).toHaveBeenCalledTimes(1);
    expect(tx.waitlist.delete).toHaveBeenCalledWith({
      where: { id: "entry_with_credits" },
    });
    expect(tx.waitlist.delete).not.toHaveBeenCalledWith({
      where: { id: "entry_no_credits" },
    });
  });
});

function unlimitedCancelTx(classDate: Date) {
  return {
    booking: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue({
        id: "booking_1", status: "CANCELED", createdAt: new Date(),
        canceledAt: new Date(), class: activeBooking(classDate).class,
      }),
    },
    unlimitedUsage: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    tokenLedger: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
    },
    packPurchase: { update: vi.fn() },
    waitlist: { findMany: vi.fn().mockResolvedValue([]), delete: vi.fn() },
  };
}

describe("monthly unlimited cancellation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
    mocks.getAuth.mockResolvedValue({ sub: "user_1" });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it.each([
    [240, false],
    [239, true],
  ])("applies the four-hour boundary at %i minutes", async (minutes, lateCancel) => {
    const date = new Date(Date.now() + minutes * 60_000);
    mocks.prisma.booking.findUnique.mockResolvedValue({
      ...activeBooking(date), entitlementType: "MONTHLY_UNLIMITED",
    });
    const tx = unlimitedCancelTx(date);
    mocks.prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    const res = await PATCH(new Request("https://example.test") as any, ctx());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ lateCancel, refundedCredits: 0 });
    expect(tx.unlimitedUsage.updateMany).toHaveBeenCalledTimes(lateCancel ? 0 : 1);
    expect(tx.tokenLedger.create).not.toHaveBeenCalled();
    expect(tx.packPurchase.update).not.toHaveBeenCalled();
  });

  it("refunds only credit debits for a mixed booking while releasing its daily claim", async () => {
    const date = new Date(Date.now() + 5 * 60 * 60_000);
    mocks.prisma.booking.findUnique.mockResolvedValue({
      ...activeBooking(date), quantity: 3, entitlementType: "MIXED",
    });
    const tx = unlimitedCancelTx(date);
    tx.tokenLedger.findMany.mockResolvedValue([{ delta: -2, packPurchaseId: "standard_1" }]);
    mocks.prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    const res = await PATCH(new Request("https://example.test") as any, ctx());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ refundedCredits: 2, quantity: 3 });
    expect(tx.unlimitedUsage.updateMany).toHaveBeenCalledOnce();
    expect(tx.packPurchase.update).toHaveBeenCalledWith({
      where: { id: "standard_1" }, data: { classesLeft: { increment: 2 } },
    });
    // Canceling can release a claim; it never restores or un-revokes an entitlement.
    expect(tx.packPurchase.update).toHaveBeenCalledTimes(1);
  });

  it("does not refund or release usage twice when another cancellation already claimed the booking", async () => {
    const date = new Date(Date.now() + 5 * 60 * 60_000);
    mocks.prisma.booking.findUnique.mockResolvedValue(activeBooking(date));
    const tx = unlimitedCancelTx(date);
    tx.booking.updateMany.mockResolvedValue({ count: 0 });
    mocks.prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    const res = await PATCH(new Request("https://example.test") as any, ctx());

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ code: "ALREADY_CANCELED" });
    expect(tx.unlimitedUsage.updateMany).not.toHaveBeenCalled();
    expect(tx.tokenLedger.create).not.toHaveBeenCalled();
    expect(tx.booking.update).not.toHaveBeenCalled();
  });

  it("retries the complete cancellation after a raw-query serialization conflict", async () => {
    const date = new Date(Date.now() + 5 * 60 * 60_000);
    mocks.prisma.booking.findUnique.mockResolvedValue(activeBooking(date));
    const tx = unlimitedCancelTx(date);
    mocks.prisma.$transaction
      .mockRejectedValueOnce({ code: "P2010", meta: { code: "40001" } })
      .mockImplementation(async (callback: any) => callback(tx));

    const res = await PATCH(new Request("https://example.test") as any, ctx());

    expect(res.status).toBe(200);
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.unlimitedUsage.updateMany).toHaveBeenCalledOnce();
  });
});
