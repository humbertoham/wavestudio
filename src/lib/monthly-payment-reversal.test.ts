import { describe, expect, it, vi } from "vitest";

import { isBookingTransactionConflict, revokeUnlimitedPurchase } from "./monthly-unlimited";

const now = new Date("2026-10-20T12:00:00Z");
const adminRevokedAt = new Date("2026-10-19T12:00:00Z");
const adminKey = "admin-unlimited-revocation:unlimited_1";
const providerKey = "monthly-payment-reversal:unlimited_1";

function makeTx(adminReason = "Customer request", debit = 0) {
  const purchase = {
    id: "unlimited_1", type: "MONTHLY_UNLIMITED", userId: "user_1",
    revokedAt: adminRevokedAt, revocationReason: adminReason, classesLeft: 0,
  };
  const adminAudit = {
    id: "audit_1", userId: "user_1", packPurchaseId: purchase.id,
    delta: 0, reason: "ADMIN_ADJUST", idempotencyKey: adminKey,
    createdAt: adminRevokedAt,
    metadata: {
      source: "ADMIN", action: "UNLIMITED_REVOCATION", reason: adminReason,
      actorUserId: "admin_1", revokedAt: adminRevokedAt.toISOString(),
    },
  };
  const audits = new Map<string, any>([[adminKey, adminAudit]]);
  const booking = {
    id: "booking_1", userId: "user_1", classId: "class_1", status: "ACTIVE",
    quantity: debit ? 3 : 1, class: { date: new Date("2026-10-21T12:00:00Z") },
  };
  const state = { purchase, audits, booking, released: false, blocked: false, creditsLeft: 2 };
  const refunds: any[] = [];
  const tx = {
    packPurchase: {
      findUnique: vi.fn(async () => ({ ...purchase })),
      update: vi.fn(async ({ where, data }: any) => {
        if (where.id === "standard_1") state.creditsLeft += data.classesLeft.increment;
        else Object.assign(purchase, data);
        return purchase;
      }),
    },
    tokenLedger: {
      findUnique: vi.fn(async ({ where }: any) => audits.get(where.idempotencyKey) ?? null),
      findFirst: vi.fn(async () => refunds[0] ?? null),
      findMany: vi.fn(async () => debit ? [{ delta: -debit, packPurchaseId: "standard_1" }] : []),
      create: vi.fn(async ({ data }: any) => {
        if (data.idempotencyKey) audits.set(data.idempotencyKey, data);
        if (data.reason === "CANCEL_REFUND") refunds.push(data);
        return data;
      }),
    },
    unlimitedUsage: {
      findMany: vi.fn(async () => state.released ? [] : [{ booking }]),
      updateMany: vi.fn(async () => { state.released = true; return { count: 1 }; }),
    },
    booking: {
      updateMany: vi.fn(async ({ data }: any) => {
        if (booking.status !== "ACTIVE") return { count: 0 };
        Object.assign(booking, data);
        return { count: 1 };
      }),
    },
    user: {
      update: vi.fn(async () => { state.blocked = true; return {}; }),
      updateMany: vi.fn(async () => {
        if (state.blocked) return { count: 0 };
        state.blocked = true;
        return { count: 1 };
      }),
    },
    bookingBlockLog: { create: vi.fn(async () => ({})) },
  };
  return { tx, state, adminAudit };
}

describe("provider payment reversal after admin unlimited revocation", () => {
  it.each([
    ["REFUND", "REFUND"],
    ["REFUND", "CHARGEBACK"],
    ["Customer moved away", "REFUND"],
    ["Customer moved away", "CHARGEBACK"],
  ])("processes the human admin reason %s followed by provider %s exactly once", async (adminReason, providerReason) => {
    const { tx, state, adminAudit } = makeTx(adminReason);
    const originalAudit = structuredClone(adminAudit);

    const first = await revokeUnlimitedPurchase(tx as any, "unlimited_1", providerReason, now);
    const replay = await revokeUnlimitedPurchase(tx as any, "unlimited_1", providerReason, now);

    expect(first).toEqual({
      debt: providerReason === "CHARGEBACK",
      released: [{ classId: "class_1", seatsReleased: 1 }],
    });
    expect(replay.released).toEqual([]);
    expect(state.booking.status).toBe("CANCELED");
    expect(state.released).toBe(true);
    expect(state.purchase.revokedAt).toEqual(adminRevokedAt);
    expect(state.purchase.revocationReason).toBe(adminReason);
    expect(state.audits.get(adminKey)).toEqual(originalAudit);
    expect(state.audits.get(providerKey)).toMatchObject({
      delta: 0, reason: "ADMIN_ADJUST", userId: "user_1", packPurchaseId: "unlimited_1",
      metadata: { source: "MERCADO_PAGO", action: "UNLIMITED_PAYMENT_REVERSAL", reason: providerReason },
    });
    expect(tx.tokenLedger.create).toHaveBeenCalledTimes(1);
    expect(tx.booking.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.unlimitedUsage.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.packPurchase.update.mock.calls.every(([args]) => !args.data.classesLeft)).toBe(true);
    expect(state.creditsLeft).toBe(2);
    expect(tx.bookingBlockLog.create).toHaveBeenCalledTimes(providerReason === "CHARGEBACK" ? 1 : 0);
  });

  it("refunds only actual standard-credit debits from a mixed booking", async () => {
    const { tx, state } = makeTx("REFUND", 2);

    const first = await revokeUnlimitedPurchase(tx as any, "unlimited_1", "REFUND", now);
    await revokeUnlimitedPurchase(tx as any, "unlimited_1", "REFUND", now);

    expect(first.released).toEqual([{ classId: "class_1", seatsReleased: 3 }]);
    expect(state.creditsLeft).toBe(4);
    expect(state.purchase.classesLeft).toBe(0);
    expect(tx.tokenLedger.create.mock.calls.filter(([args]) => args.data.reason === "CANCEL_REFUND"))
      .toEqual([[{ data: {
        userId: "user_1", bookingId: "booking_1", packPurchaseId: "standard_1",
        delta: 2, reason: "CANCEL_REFUND",
      } }]]);
    expect(state.purchase.revokedAt).toEqual(adminRevokedAt);
  });

  it.each(["missing", "wrong-action"])("keeps prior non-admin reversal idempotent for %s audit", async (kind) => {
    const { tx, state, adminAudit } = makeTx("REFUND");
    if (kind === "missing") state.audits.delete(adminKey);
    else adminAudit.metadata.action = "SOMETHING_ELSE";

    expect(await revokeUnlimitedPurchase(tx as any, "unlimited_1", "REFUND", now))
      .toEqual({ debt: false, released: [] });
    expect(tx.unlimitedUsage.findMany).not.toHaveBeenCalled();
    expect(tx.tokenLedger.create).not.toHaveBeenCalled();
    expect(state.booking.status).toBe("ACTIVE");
  });

  it("preserves chargeback escalation after a prior refund marker without repeating booking effects", async () => {
    const { tx, state } = makeTx();
    await revokeUnlimitedPurchase(tx as any, "unlimited_1", "REFUND", now);
    await revokeUnlimitedPurchase(tx as any, "unlimited_1", "CHARGEBACK", now);
    await revokeUnlimitedPurchase(tx as any, "unlimited_1", "CHARGEBACK", now);

    expect(state.blocked).toBe(true);
    expect(tx.bookingBlockLog.create).toHaveBeenCalledTimes(1);
    expect(tx.booking.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.tokenLedger.create).toHaveBeenCalledTimes(1);
    expect(state.purchase.revokedAt).toEqual(adminRevokedAt);
    expect(state.audits.get(providerKey).metadata.reason).toBe("REFUND");
  });

  it("does not repeat debt block logs when spent usage is followed by replay and chargeback", async () => {
    const { tx, state } = makeTx();
    state.booking.class.date = new Date("2026-10-19T11:00:00Z");

    expect((await revokeUnlimitedPurchase(tx as any, "unlimited_1", "REFUND", now)).debt).toBe(true);
    await revokeUnlimitedPurchase(tx as any, "unlimited_1", "REFUND", now);
    await revokeUnlimitedPurchase(tx as any, "unlimited_1", "CHARGEBACK", now);
    await revokeUnlimitedPurchase(tx as any, "unlimited_1", "CHARGEBACK", now);

    expect(tx.bookingBlockLog.create).toHaveBeenCalledTimes(1);
    expect(tx.tokenLedger.create).toHaveBeenCalledTimes(1);
    expect(state.released).toBe(false);
    expect(tx.booking.updateMany).not.toHaveBeenCalled();
    expect(state.purchase.revokedAt).toEqual(adminRevokedAt);
  });

  it("retains chargeback escalation for a prior provider-origin refund", async () => {
    const { tx, state } = makeTx("REFUND");
    state.audits.delete(adminKey);

    await revokeUnlimitedPurchase(tx as any, "unlimited_1", "CHARGEBACK", now);
    await revokeUnlimitedPurchase(tx as any, "unlimited_1", "CHARGEBACK", now);

    expect(state.purchase.revocationReason).toBe("CHARGEBACK");
    expect(state.purchase.revokedAt).toEqual(adminRevokedAt);
    expect(tx.bookingBlockLog.create).toHaveBeenCalledTimes(1);
    expect(tx.unlimitedUsage.findMany).not.toHaveBeenCalled();
  });

  it.each([["idempotencyKey"], "TokenLedger_idempotencyKey_key"])(
    "retries a provider marker uniqueness race with target %j", (target) => {
      expect(isBookingTransactionConflict({ code: "P2002", meta: { target } })).toBe(true);
    },
  );

  it("limits named-model idempotency conflicts to the token ledger", () => {
    expect(isBookingTransactionConflict({
      code: "P2002", meta: { target: ["idempotencyKey"], modelName: "TokenLedger" },
    })).toBe(true);
    expect(isBookingTransactionConflict({
      code: "P2002", meta: { target: ["idempotencyKey"], modelName: "UnrelatedModel" },
    })).toBe(false);
  });
});
