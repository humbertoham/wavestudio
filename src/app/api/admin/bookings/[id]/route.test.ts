import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthFromRequest: vi.fn(),
  prisma: {
    user: { findUnique: vi.fn() },
    booking: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/auth", () => ({ getAuthFromRequest: mocks.getAuthFromRequest }));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));

import { DELETE } from "./route";

const request = () => new Request("https://example.test/api/admin/bookings/booking_1", { method: "DELETE" }) as any;
const context = () => ({ params: Promise.resolve({ id: "booking_1" }) });

describe("manager cancellation policy exceptions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-30T12:00:00Z"));
    mocks.getAuthFromRequest.mockResolvedValue({ sub: "manager_1" });
    mocks.prisma.booking.findUnique.mockResolvedValue({
      id: "booking_1", userId: "user_1", status: "ACTIVE", quantity: 1,
    });
  });
  afterEach(() => vi.useRealTimers());

  it.each(["ADMIN", "COACH"])("keeps the existing time-independent %s refund override", async (role) => {
    mocks.prisma.user.findUnique.mockResolvedValue({ id: "manager_1", role });
    const tx = {
      booking: { update: vi.fn() },
      tokenLedger: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([{ delta: -2, packPurchaseId: "purchase_1" }]),
        create: vi.fn(),
      },
      packPurchase: { update: vi.fn() },
    };
    mocks.prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));
    const res = await DELETE(request(), context());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, refunded: true });
    expect(tx.packPurchase.update).toHaveBeenCalledWith({
      where: { id: "purchase_1" }, data: { classesLeft: { increment: 2 } },
    });
    expect(tx.booking.update).toHaveBeenCalledWith({
      where: { id: "booking_1" }, data: { status: "CANCELED", canceledAt: new Date() },
    });
  });

  it("still rejects regular users before loading or changing a booking", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ id: "user_1", role: "USER" });
    expect((await DELETE(request(), context())).status).toBe(403);
    expect(mocks.prisma.booking.findUnique).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("still rejects unauthenticated requests", async () => {
    mocks.getAuthFromRequest.mockResolvedValue(null);
    expect((await DELETE(request(), context())).status).toBe(401);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("preserves duplicate manager cancellation idempotency", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ id: "manager_1", role: "ADMIN" });
    mocks.prisma.booking.findUnique.mockResolvedValue({ id: "booking_1", status: "CANCELED" });
    const res = await DELETE(request(), context());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, alreadyCanceled: true });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});
