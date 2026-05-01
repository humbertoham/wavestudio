import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    webhookLog: {
      create: vi.fn(),
      update: vi.fn(),
    },
    payment: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    tokenLedger: {
      aggregate: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  paymentGet: vi.fn(),
  MercadoPagoConfig: vi.fn(),
  Payment: vi.fn(),
  MerchantOrder: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("mercadopago", () => ({
  MercadoPagoConfig: mocks.MercadoPagoConfig,
  Payment: mocks.Payment,
  MerchantOrder: mocks.MerchantOrder,
}));

import { POST } from "./route";

const WEBHOOK_SECRET = "test_webhook_secret";

function signedWebhookRequest(dataId = "mp_payment_1") {
  const ts = Date.now().toString();
  const requestId = "request_1";
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const v1 = createHmac("sha256", WEBHOOK_SECRET)
    .update(manifest)
    .digest("hex");

  return new Request(
    `https://example.test/api/webhooks/mercadopago?type=payment&data.id=${dataId}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": requestId,
        "x-signature": `ts=${ts},v1=${v1}`,
      },
      body: JSON.stringify({
        type: "payment",
        data: { id: dataId },
      }),
    }
  );
}

function localPayment() {
  return {
    id: "payment_1",
    status: "APPROVED",
    mpPreferenceId: "pref_old",
    mpExternalRef: "old_ref",
    mpPayerEmail: null,
    checkoutLink: { id: "checkout_1" },
    packPurchase: { id: "purchase_1" },
  };
}

function refundedMpPayment() {
  return {
    id: "mp_payment_1",
    status: "refunded",
    preference_id: "pref_1",
    external_reference: "user_1|pack_1|payment_1",
    payer: { email: "user@example.test" },
  };
}

function purchaseForRefund(classesLeft: number, packClasses: number, status = "APPROVED") {
  return {
    id: "payment_1",
    status,
    packPurchase: {
      id: "purchase_1",
      userId: "user_1",
      classesLeft,
      pack: { classes: packClasses },
    },
  };
}

describe("POST /api/webhooks/mercadopago refund handling", () => {
  beforeEach(() => {
    process.env.MP_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.MP_ACCESS_TOKEN = "APP_USR-test";
    mocks.prisma.webhookLog.create.mockResolvedValue({ id: "webhook_log_1" });
    mocks.prisma.webhookLog.update.mockResolvedValue({});
    mocks.Payment.mockImplementation(function PaymentMock() {
      return { get: mocks.paymentGet };
    });
    mocks.paymentGet.mockResolvedValue(refundedMpPayment());
    mocks.prisma.payment.findFirst.mockResolvedValue(localPayment());
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    delete process.env.MP_WEBHOOK_SECRET;
    delete process.env.MP_ACCESS_TOKEN;
  });

  it("acknowledges used-credit refunds, removes remaining credits, blocks the user, and records debt", async () => {
    const tx = {
      payment: { update: vi.fn().mockResolvedValue({ id: "payment_1" }) },
      packPurchase: { update: vi.fn().mockResolvedValue({ id: "purchase_1" }) },
      tokenLedger: { create: vi.fn().mockResolvedValue({ id: "ledger_1" }) },
      user: { update: vi.fn().mockResolvedValue({ id: "user_1" }) },
      bookingBlockLog: { create: vi.fn().mockResolvedValue({ id: "block_log_1" }) },
      checkoutLink: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      webhookLog: { update: vi.fn().mockResolvedValue({ id: "webhook_log_1" }) },
    };
    mocks.prisma.payment.findUnique.mockResolvedValue(
      purchaseForRefund(2, 5)
    );
    mocks.prisma.tokenLedger.aggregate.mockResolvedValue({
      _sum: { delta: 5 },
    });
    mocks.prisma.$transaction.mockImplementation(async (callback: any) =>
      callback(tx)
    );

    const res = await POST(signedWebhookRequest());

    await expect(res.json()).resolves.toEqual({ ok: true, debt: true });
    expect(res.status).toBe(200);
    expect(tx.payment.update).toHaveBeenCalledWith({
      where: { id: "payment_1" },
      data: expect.objectContaining({
        status: "REFUNDED",
        mpPaymentId: "mp_payment_1",
        mpPreferenceId: "pref_1",
        mpExternalRef: "user_1|pack_1|payment_1",
        mpPayerEmail: "user@example.test",
      }),
    });
    expect(tx.packPurchase.update).toHaveBeenCalledWith({
      where: { id: "purchase_1" },
      data: { classesLeft: 0 },
    });
    expect(tx.tokenLedger.create).toHaveBeenCalledWith({
      data: {
        userId: "user_1",
        packPurchaseId: "purchase_1",
        delta: -2,
        reason: "ADMIN_ADJUST",
      },
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: expect.objectContaining({
        bookingBlocked: true,
        bookingBlockedAt: expect.any(Date),
      }),
    });
    expect(tx.bookingBlockLog.create).toHaveBeenCalledWith({
      data: {
        userId: "user_1",
        blocked: true,
      },
    });
    expect(tx.checkoutLink.updateMany).toHaveBeenCalledWith({
      where: { paymentId: "payment_1" },
      data: { status: "CANCELED" },
    });
    expect(tx.webhookLog.update).toHaveBeenCalledWith({
      where: { id: "webhook_log_1" },
      data: {
        processedOk: true,
        error: "REFUND_DEBT_USED_CREDITS:3",
      },
    });
  });

  it("acknowledges unused-pack refunds and removes all remaining PackPurchase credits", async () => {
    const genericTx = {
      payment: {
        update: vi.fn().mockResolvedValue({ id: "payment_1" }),
      },
      checkoutLink: {
        findFirst: vi.fn().mockResolvedValue({ id: "checkout_1" }),
      },
      webhookLog: {
        update: vi.fn().mockResolvedValue({ id: "webhook_log_1" }),
      },
      packPurchase: {
        findUnique: vi.fn(),
        create: vi.fn(),
      },
      user: {
        upsert: vi.fn(),
      },
      pack: {
        findUnique: vi.fn(),
      },
      tokenLedger: {
        create: vi.fn(),
      },
    };
    const refundTx = {
      payment: {
        findUnique: vi.fn().mockResolvedValue({
          id: "payment_1",
          packPurchase: {
            id: "purchase_1",
            userId: "user_1",
            classesLeft: 5,
          },
        }),
      },
      packPurchase: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      tokenLedger: {
        create: vi.fn().mockResolvedValue({ id: "ledger_1" }),
      },
      checkoutLink: {
        findFirst: vi.fn().mockResolvedValue({
          id: "checkout_1",
          status: "OPEN",
        }),
        update: vi.fn().mockResolvedValue({ id: "checkout_1" }),
      },
    };
    mocks.prisma.payment.findUnique.mockResolvedValue(
      purchaseForRefund(5, 5)
    );
    mocks.prisma.tokenLedger.aggregate.mockResolvedValue({
      _sum: { delta: 5 },
    });
    mocks.prisma.$transaction
      .mockImplementationOnce(async (callback: any) => callback(genericTx))
      .mockImplementationOnce(async (callback: any) => callback(refundTx));

    const res = await POST(signedWebhookRequest());

    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(res.status).toBe(200);
    expect(genericTx.payment.update).toHaveBeenCalledWith({
      where: { id: "payment_1" },
      data: expect.objectContaining({ status: "REFUNDED" }),
    });
    expect(refundTx.packPurchase.updateMany).toHaveBeenCalledWith({
      where: {
        id: "purchase_1",
        classesLeft: { gte: 5 },
      },
      data: { classesLeft: { decrement: 5 } },
    });
    expect(refundTx.tokenLedger.create).toHaveBeenCalledWith({
      data: {
        userId: "user_1",
        packPurchaseId: "purchase_1",
        delta: -5,
        reason: "CANCEL_REFUND",
      },
    });
    expect(refundTx.checkoutLink.update).toHaveBeenCalledWith({
      where: { id: "checkout_1" },
      data: { status: "CANCELED" },
    });
    expect(mocks.prisma.webhookLog.update).toHaveBeenCalledWith({
      where: { id: "webhook_log_1" },
      data: { processedOk: true, error: "REFUND_APPLIED" },
    });
  });

  it("is idempotent for duplicate refund webhooks", async () => {
    mocks.prisma.payment.findUnique.mockResolvedValue(
      purchaseForRefund(0, 5, "REFUNDED")
    );

    const res = await POST(signedWebhookRequest());

    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(res.status).toBe(200);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.prisma.webhookLog.update).toHaveBeenCalledWith({
      where: { id: "webhook_log_1" },
      data: { processedOk: true, error: "ALREADY_REFUNDED" },
    });
  });

  it("falls back to purchase.pack.classes when PURCHASE_CREDIT ledger rows are missing", async () => {
    const tx = {
      payment: { update: vi.fn().mockResolvedValue({ id: "payment_1" }) },
      packPurchase: { update: vi.fn().mockResolvedValue({ id: "purchase_1" }) },
      tokenLedger: { create: vi.fn().mockResolvedValue({ id: "ledger_1" }) },
      user: { update: vi.fn().mockResolvedValue({ id: "user_1" }) },
      bookingBlockLog: { create: vi.fn().mockResolvedValue({ id: "block_log_1" }) },
      checkoutLink: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      webhookLog: { update: vi.fn().mockResolvedValue({ id: "webhook_log_1" }) },
    };
    mocks.prisma.payment.findUnique.mockResolvedValue(
      purchaseForRefund(1, 4)
    );
    mocks.prisma.tokenLedger.aggregate.mockResolvedValue({
      _sum: { delta: null },
    });
    mocks.prisma.$transaction.mockImplementation(async (callback: any) =>
      callback(tx)
    );

    const res = await POST(signedWebhookRequest());

    await expect(res.json()).resolves.toEqual({ ok: true, debt: true });
    expect(res.status).toBe(200);
    expect(tx.tokenLedger.create).toHaveBeenCalledWith({
      data: {
        userId: "user_1",
        packPurchaseId: "purchase_1",
        delta: -1,
        reason: "ADMIN_ADJUST",
      },
    });
    expect(tx.webhookLog.update).toHaveBeenCalledWith({
      where: { id: "webhook_log_1" },
      data: {
        processedOk: true,
        error: "REFUND_DEBT_USED_CREDITS:3",
      },
    });
  });
});
