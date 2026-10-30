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

function cancellationTransaction(booking: ReturnType<typeof activeBooking>) {
  const tx = {
    booking: {
      update: vi.fn().mockResolvedValue({
        ...booking,
        status: "CANCELED",
        createdAt: new Date(),
        canceledAt: new Date(),
      }),
    },
    tokenLedger: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([
        { delta: -2, packPurchaseId: "purchase_1" },
      ]),
      create: vi.fn().mockResolvedValue({ id: "refund_1" }),
    },
    packPurchase: { update: vi.fn() },
    waitlist: {
      findMany: vi.fn().mockResolvedValue([]),
      delete: vi.fn(),
    },
  };
  mocks.prisma.booking.findUnique.mockResolvedValue(booking);
  mocks.prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));
  return tx;
}

describe("PATCH /api/bookings/[id]/cancel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-30T06:00:00.000-06:00"));
    mocks.getAuth.mockResolvedValue({ sub: "user_1" });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
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
      activeBooking(new Date(Date.now() + 7 * 60 * 60 * 1000))
    );

    const tx = {
      booking: {
        update: vi.fn().mockResolvedValue({
          id: "booking_1",
          status: "CANCELED",
          createdAt: startedAt,
          canceledAt,
          class: activeBooking(new Date(Date.now() + 7 * 60 * 60 * 1000)).class,
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

  it.each([
    [12 * 60 * 60_000, false],
    [7 * 60 * 60_000, false],
    [6 * 60 * 60_000 + 1, false],
    [6 * 60 * 60_000, false],
    [6 * 60 * 60_000 - 1, true],
    [(5 * 60 + 59) * 60_000, true],
    [4 * 60 * 60_000, true],
    [2 * 60 * 60_000, true],
  ])("classifies %i ms before start as late=%s using server time", async (remaining, late) => {
    const booking = activeBooking(new Date(Date.now() + remaining));
    const tx = cancellationTransaction(booking);
    // A client cannot claim an earlier cancellation time or request a refund.
    const request = new Request("https://example.test", {
      method: "PATCH",
      body: JSON.stringify({ lateCancel: false, refundToken: true, canceledAt: "2020-01-01" }),
    });
    const res = await PATCH(request as any, ctx());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      status: "CANCELED", lateCancel: late, refundedCredits: late ? 0 : 2,
    });
    expect(tx.booking.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: "CANCELED", canceledAt: new Date(), refundToken: !late },
    }));
    expect(tx.packPurchase.update).toHaveBeenCalledTimes(late ? 0 : 1);
    expect(tx.tokenLedger.create).toHaveBeenCalledTimes(late ? 0 : 1);
    expect(tx.waitlist.findMany).toHaveBeenCalledOnce();
    if (late) expect(tx.tokenLedger.findMany).not.toHaveBeenCalled();
  });

  it.each([0, -1, -60_000])("still blocks cancellation at/past start (%i ms)", async (remaining) => {
    cancellationTransaction(activeBooking(new Date(Date.now() + remaining)));
    const res = await PATCH(new Request("https://example.test") as any, ctx());
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ code: "CLASS_ALREADY_STARTED" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(["NONE", "WELLHUB", "TOTALPASS"])("preserves WAVE refunds for %s without external requests or new charges", async (affiliation) => {
    mocks.getAuth.mockResolvedValue({ sub: "user_1", affiliation });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    for (const [minutes, late] of [[360, false], [359, true]] as const) {
      const tx = cancellationTransaction(activeBooking(new Date(Date.now() + minutes * 60_000)));
      const res = await PATCH(new Request("https://example.test") as any, ctx());
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({ lateCancel: late, refundedCredits: late ? 0 : 2 });
      expect(tx.packPurchase.update).toHaveBeenCalledTimes(late ? 0 : 1);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a duplicate cancellation without refunding or promoting twice", async () => {
    const booking = activeBooking(new Date(Date.now() + 7 * 60 * 60_000));
    const tx = cancellationTransaction(booking);
    const request = () => new Request("https://example.test") as any;
    expect((await PATCH(request(), ctx())).status).toBe(200);
    mocks.prisma.booking.findUnique.mockResolvedValue({ ...booking, status: "CANCELED" });
    const duplicate = await PATCH(request(), ctx());
    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toMatchObject({ code: "ALREADY_CANCELED" });
    expect(tx.booking.update).toHaveBeenCalledOnce();
    expect(tx.tokenLedger.create).toHaveBeenCalledOnce();
    expect(tx.waitlist.findMany).toHaveBeenCalledOnce();
  });

  it("does not repeat an existing ledger refund", async () => {
    const tx = cancellationTransaction(activeBooking(new Date(Date.now() + 7 * 60 * 60_000)));
    tx.tokenLedger.findFirst.mockResolvedValue({ id: "existing_refund" });
    const res = await PATCH(new Request("https://example.test") as any, ctx());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ refundedCredits: 0 });
    expect(tx.packPurchase.update).not.toHaveBeenCalled();
    expect(tx.tokenLedger.create).not.toHaveBeenCalled();
  });

  it("creates no credits for a booking without debits", async () => {
    const tx = cancellationTransaction(activeBooking(new Date(Date.now() + 7 * 60 * 60_000)));
    tx.tokenLedger.findMany.mockResolvedValue([]);
    const res = await PATCH(new Request("https://example.test") as any, ctx());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ refundedCredits: 0 });
    expect(tx.packPurchase.update).not.toHaveBeenCalled();
    expect(tx.tokenLedger.create).not.toHaveBeenCalled();
  });

  it.each([120, 420])("releases exactly the canceled seats and preserves waitlist ordering at %i minutes", async (minutes) => {
    const booking = { ...activeBooking(new Date(Date.now() + minutes * 60_000)), quantity: 2 };
    const tx = cancellationTransaction(booking);
    tx.waitlist.findMany.mockResolvedValue([
      { id: "entry_1", userId: "waiting_1" },
      { id: "entry_2", userId: "waiting_2" },
      { id: "entry_3", userId: "waiting_3" },
    ]);
    mocks.createSingleSeatBookingWithDebit.mockResolvedValue({ id: "promoted" });
    const res = await PATCH(new Request("https://example.test") as any, ctx());
    expect(res.status).toBe(200);
    expect(tx.booking.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "CANCELED" }),
    }));
    expect(mocks.createSingleSeatBookingWithDebit).toHaveBeenCalledTimes(2);
    expect(tx.waitlist.delete.mock.calls).toEqual([
      [{ where: { id: "entry_1" } }], [{ where: { id: "entry_2" } }],
    ]);
    expect(tx.waitlist.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    }));
  });

  it.each(["USER", "ADMIN", "COACH"])("does not let %s cancel another user's booking through the self-service API", async (role) => {
    mocks.getAuth.mockResolvedValue({ sub: "other_user", role });
    cancellationTransaction(activeBooking(new Date(Date.now() + 7 * 60 * 60_000)));
    const res = await PATCH(new Request("https://example.test") as any, ctx());
    expect(res.status).toBe(403);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});
