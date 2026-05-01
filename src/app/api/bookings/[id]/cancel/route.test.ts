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
      booking: {
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
      booking: {
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
