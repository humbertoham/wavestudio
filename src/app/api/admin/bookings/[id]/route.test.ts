import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireClassManager: vi.fn(), transaction: vi.fn() }));
vi.mock("../../_utils", () => ({
  requireClassManager: mocks.requireClassManager,
  prisma: { $transaction: mocks.transaction },
}));

import { DELETE } from "./route";

const ctx = { params: Promise.resolve({ id: "booking_1" }) };

function makeTx(entitlementType: string, minutes: number) {
  return {
    booking: {
      findUnique: vi.fn().mockResolvedValue({
        id: "booking_1", userId: "user_1", status: "ACTIVE", entitlementType,
        quantity: 1, class: { date: new Date(Date.now() + minutes * 60_000) },
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    unlimitedUsage: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    tokenLedger: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([{ delta: -1, packPurchaseId: "standard_1" }]),
      create: vi.fn().mockResolvedValue({}),
    },
    packPurchase: { update: vi.fn().mockResolvedValue({}) },
  };
}

describe("class manager cancellation with monthly unlimited", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireClassManager.mockResolvedValue(null);
  });

  it("preserves the existing class manager authorization gate", async () => {
    mocks.requireClassManager.mockResolvedValue(new Response(null, { status: 403 }));

    expect((await DELETE(new Request("https://example.test") as any, ctx))?.status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("preserves standard credit refunds when the manager cancels a late booking", async () => {
    const tx = makeTx("CREDITS", 60);
    mocks.transaction.mockImplementation(async (callback: any) => callback(tx));

    const res = await DELETE(new Request("https://example.test") as any, ctx);

    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toMatchObject({ refunded: true });
    expect(tx.packPurchase.update).toHaveBeenCalledWith({
      where: { id: "standard_1" }, data: { classesLeft: { increment: 1 } },
    });
    expect(tx.unlimitedUsage.updateMany).not.toHaveBeenCalled();
  });

  it.each([[300, true], [60, false]])(
    "applies unlimited cancellation rules at %i minutes", async (minutes, onTime) => {
      const tx = makeTx("MIXED", minutes);
      mocks.transaction.mockImplementation(async (callback: any) => callback(tx));

      const res = await DELETE(new Request("https://example.test") as any, ctx);

      expect(res?.status).toBe(200);
      await expect(res?.json()).resolves.toMatchObject({ refunded: onTime });
      expect(tx.unlimitedUsage.updateMany).toHaveBeenCalledTimes(onTime ? 1 : 0);
      expect(tx.packPurchase.update).toHaveBeenCalledTimes(onTime ? 1 : 0);
    },
  );
});
