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

type SignedRequestOptions = {
  dataId?: string;
  urlDataId?: string;
  urlId?: string | null;
  type?: string | null;
  topic?: string | null;
  requestId?: string | null;
  ts?: string;
  v1?: string;
  signWith?: string;
  body?: any;
  omitSignature?: boolean;
  omitRequestId?: boolean;
  secret?: string;
};

function buildSignedRequest(opts: SignedRequestOptions = {}) {
  const dataId = opts.dataId ?? "mp_payment_signed";
  const urlDataId = opts.urlDataId ?? dataId;
  const requestId = opts.requestId ?? "request_signed";
  const ts = opts.ts ?? Date.now().toString();
  const secret = opts.secret ?? WEBHOOK_SECRET;
  const signWith = (opts.signWith ?? dataId).toLowerCase();
  const manifest = `id:${signWith};request-id:${requestId};ts:${ts};`;
  const v1 =
    opts.v1 ?? createHmac("sha256", secret).update(manifest).digest("hex");

  const query = new URLSearchParams();
  if (opts.type !== null) query.set("type", opts.type ?? "payment");
  if (opts.topic) query.set("topic", opts.topic);
  if (urlDataId) query.set("data.id", urlDataId);
  if (opts.urlId) query.set("id", opts.urlId);

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (!opts.omitSignature) headers["x-signature"] = `ts=${ts},v1=${v1}`;
  if (!opts.omitRequestId) headers["x-request-id"] = requestId;

  const body = JSON.stringify(
    opts.body ?? {
      type: opts.type ?? "payment",
      action: "payment.created",
      data: { id: dataId },
    }
  );

  return new Request(
    `https://example.test/api/webhooks/mercadopago?${query.toString()}`,
    { method: "POST", headers, body }
  );
}

describe("POST /api/webhooks/mercadopago signature validation", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.MP_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.MP_ACCESS_TOKEN = "APP_USR-test";
    mocks.prisma.webhookLog.create.mockResolvedValue({ id: "webhook_log_sig" });
    mocks.prisma.webhookLog.update.mockResolvedValue({});
    mocks.Payment.mockImplementation(function PaymentMock() {
      return { get: mocks.paymentGet };
    });
    mocks.MerchantOrder.mockImplementation(function MerchantOrderMock() {
      return { get: vi.fn().mockResolvedValue({ payments: [] }) };
    });
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    delete process.env.MP_WEBHOOK_SECRET;
    delete process.env.MP_ACCESS_TOKEN;
    warnSpy?.mockRestore?.();
    infoSpy?.mockRestore?.();
    errorSpy?.mockRestore?.();
  });

  it("accepts a valid payment.created webhook (URL data.id, lowercase)", async () => {
    mocks.paymentGet.mockResolvedValue({
      id: "mp_payment_signed",
      status: "pending",
      external_reference: null,
    });
    mocks.prisma.payment.findFirst.mockResolvedValue({
      id: "payment_local",
      status: "PENDING",
      mpPreferenceId: null,
      mpExternalRef: null,
      mpPayerEmail: null,
      checkoutLink: null,
      packPurchase: null,
    });
    mocks.prisma.$transaction.mockImplementation(async (cb: any) =>
      cb({
        payment: { update: vi.fn().mockResolvedValue({ id: "payment_local" }) },
        checkoutLink: { findFirst: vi.fn().mockResolvedValue(null) },
        packPurchase: { findUnique: vi.fn().mockResolvedValue(null) },
        webhookLog: { update: vi.fn().mockResolvedValue({}) },
      })
    );

    const res = await POST(buildSignedRequest());
    expect(res.status).toBe(200);
  });

  it("accepts a webhook whose data.id is mixed case (lowercased manifest)", async () => {
    mocks.paymentGet.mockResolvedValue({
      id: "MP_Payment_MIXED",
      status: "pending",
    });
    mocks.prisma.payment.findFirst.mockResolvedValue({
      id: "payment_mixed",
      status: "PENDING",
      mpPreferenceId: null,
      mpExternalRef: null,
      mpPayerEmail: null,
      checkoutLink: null,
      packPurchase: null,
    });
    mocks.prisma.$transaction.mockImplementation(async (cb: any) =>
      cb({
        payment: { update: vi.fn().mockResolvedValue({ id: "payment_mixed" }) },
        checkoutLink: { findFirst: vi.fn().mockResolvedValue(null) },
        packPurchase: { findUnique: vi.fn().mockResolvedValue(null) },
        webhookLog: { update: vi.fn().mockResolvedValue({}) },
      })
    );

    const dataId = "MP_Payment_MIXED";
    const res = await POST(
      buildSignedRequest({
        dataId,
        urlDataId: dataId,
        signWith: dataId,
      })
    );
    expect(res.status).toBe(200);
  });

  it("accepts a merchant_order topic webhook with ?id= and returns 200", async () => {
    const moId = "merchant_order_777";
    const res = await POST(
      buildSignedRequest({
        type: null,
        topic: "merchant_order",
        urlDataId: undefined,
        urlId: moId,
        dataId: moId,
        body: { topic: "merchant_order" },
      })
    );
    expect(res.status).toBe(200);
  });

  it("accepts a topic_merchant_order_wh event as ignored 200", async () => {
    const moId = "merchant_order_888";
    mocks.MerchantOrder.mockImplementation(function MerchantOrderMock() {
      return { get: vi.fn().mockResolvedValue({ payments: [] }) };
    });
    const res = await POST(
      buildSignedRequest({
        type: "topic_merchant_order_wh",
        urlDataId: undefined,
        urlId: moId,
        dataId: moId,
        body: { type: "topic_merchant_order_wh", data: { id: moId } },
      })
    );
    expect(res.status).toBe(200);
  });

  it("falls back to body data.id when URL has no data.id", async () => {
    const dataId = "body_only_payment";
    mocks.paymentGet.mockResolvedValue({ id: dataId, status: "pending" });
    mocks.prisma.payment.findFirst.mockResolvedValue({
      id: "payment_body",
      status: "PENDING",
      mpPreferenceId: null,
      mpExternalRef: null,
      mpPayerEmail: null,
      checkoutLink: null,
      packPurchase: null,
    });
    mocks.prisma.$transaction.mockImplementation(async (cb: any) =>
      cb({
        payment: { update: vi.fn().mockResolvedValue({ id: "payment_body" }) },
        checkoutLink: { findFirst: vi.fn().mockResolvedValue(null) },
        packPurchase: { findUnique: vi.fn().mockResolvedValue(null) },
        webhookLog: { update: vi.fn().mockResolvedValue({}) },
      })
    );

    const res = await POST(
      buildSignedRequest({
        dataId,
        urlDataId: undefined,
        body: { type: "payment", data: { id: dataId } },
      })
    );
    expect(res.status).toBe(200);
  });

  it("returns 401 for an invalid signature", async () => {
    const req = buildSignedRequest({
      v1: "0".repeat(64),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "INVALID_SIGNATURE" });
  });

  it("returns 401 when x-signature is missing", async () => {
    const res = await POST(buildSignedRequest({ omitSignature: true }));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "INVALID_SIGNATURE" });
  });

  it("returns 401 when x-request-id is missing", async () => {
    const res = await POST(buildSignedRequest({ omitRequestId: true }));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "INVALID_SIGNATURE" });
  });

  it("returns 200 (ignored) for an unsupported but validly signed event", async () => {
    const res = await POST(
      buildSignedRequest({
        type: "plan",
        urlDataId: "plan_42",
        dataId: "plan_42",
        body: { type: "plan", data: { id: "plan_42" } },
      })
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it("never logs the full signature or full computed hash", async () => {
    await POST(
      buildSignedRequest({
        v1: "0".repeat(64),
      })
    );
    const calls = warnSpy.mock.calls.flat().filter(Boolean);
    for (const arg of calls) {
      if (typeof arg === "string") continue;
      const dump = JSON.stringify(arg);
      expect(dump).not.toContain(WEBHOOK_SECRET);
      expect(dump).not.toMatch(/[a-f0-9]{64}/);
    }
  });

  it("populates computedPrefix on SIGNATURE_MISMATCH", async () => {
    await POST(buildSignedRequest({ v1: "0".repeat(64) }));
    const mismatchCall = warnSpy.mock.calls.find(
      ([label]: any[]) => label === "MP_WEBHOOK_INVALID_SIGNATURE"
    );
    expect(mismatchCall).toBeDefined();
    const ctx = mismatchCall![1] as { reason: string; computedPrefix: string | null };
    expect(ctx.reason).toBe("SIGNATURE_MISMATCH");
    expect(ctx.computedPrefix).toMatch(/^[a-f0-9]{8}$/);
  });
});

describe("POST /api/webhooks/mercadopago timestamp handling", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.MP_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.MP_ACCESS_TOKEN = "APP_USR-test";
    mocks.prisma.webhookLog.create.mockResolvedValue({ id: "webhook_log_ts" });
    mocks.prisma.webhookLog.update.mockResolvedValue({});
    mocks.Payment.mockImplementation(function PaymentMock() {
      return { get: mocks.paymentGet };
    });
    mocks.MerchantOrder.mockImplementation(function MerchantOrderMock() {
      return { get: vi.fn().mockResolvedValue({ payments: [] }) };
    });
    mocks.paymentGet.mockResolvedValue({ id: "ts_payment", status: "pending" });
    mocks.prisma.payment.findFirst.mockResolvedValue({
      id: "payment_ts",
      status: "PENDING",
      mpPreferenceId: null,
      mpExternalRef: null,
      mpPayerEmail: null,
      checkoutLink: null,
      packPurchase: null,
    });
    mocks.prisma.$transaction.mockImplementation(async (cb: any) =>
      cb({
        payment: { update: vi.fn().mockResolvedValue({ id: "payment_ts" }) },
        checkoutLink: { findFirst: vi.fn().mockResolvedValue(null) },
        packPurchase: { findUnique: vi.fn().mockResolvedValue(null) },
        webhookLog: { update: vi.fn().mockResolvedValue({}) },
      })
    );
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    delete process.env.MP_WEBHOOK_SECRET;
    delete process.env.MP_ACCESS_TOKEN;
    warnSpy?.mockRestore?.();
    infoSpy?.mockRestore?.();
  });

  it("accepts a valid signature with a far-past timestamp (no STALE rejection)", async () => {
    const oldTs = (Date.now() - 24 * 60 * 60 * 1000).toString();
    const res = await POST(
      buildSignedRequest({ dataId: "ts_payment", ts: oldTs })
    );
    expect(res.status).toBe(200);
    const skewCall = warnSpy.mock.calls.find(
      ([label]: any[]) => label === "MP_WEBHOOK_TIMESTAMP_SKEW"
    );
    expect(skewCall).toBeDefined();
    const ctx = skewCall![1] as { reason: string; skewSeconds: number | null };
    expect(ctx.reason).toBe("OLD_TIMESTAMP");
    expect(typeof ctx.skewSeconds).toBe("number");
  });

  it("accepts a valid signature with a far-future timestamp", async () => {
    const futureTs = (Date.now() + 24 * 60 * 60 * 1000).toString();
    const res = await POST(
      buildSignedRequest({ dataId: "ts_payment", ts: futureTs })
    );
    expect(res.status).toBe(200);
    const skewCall = warnSpy.mock.calls.find(
      ([label]: any[]) => label === "MP_WEBHOOK_TIMESTAMP_SKEW"
    );
    expect(skewCall).toBeDefined();
    expect((skewCall![1] as any).reason).toBe("FUTURE_TIMESTAMP");
  });

  it("accepts a valid signature with a non-numeric ts string", async () => {
    const oddTs = "abc-not-a-number";
    const res = await POST(
      buildSignedRequest({ dataId: "ts_payment", ts: oddTs })
    );
    expect(res.status).toBe(200);
    const skewCall = warnSpy.mock.calls.find(
      ([label]: any[]) => label === "MP_WEBHOOK_TIMESTAMP_SKEW"
    );
    expect(skewCall).toBeDefined();
    expect((skewCall![1] as any).reason).toBe("NON_NUMERIC_TS");
    expect((skewCall![1] as any).skewSeconds).toBeNull();
  });

  it("still rejects with 401 SIGNATURE_MISMATCH when the ts is old but the hash is wrong", async () => {
    const oldTs = (Date.now() - 24 * 60 * 60 * 1000).toString();
    const res = await POST(
      buildSignedRequest({
        dataId: "ts_payment",
        ts: oldTs,
        v1: "0".repeat(64),
      })
    );
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "INVALID_SIGNATURE" });
    const mismatch = warnSpy.mock.calls.find(
      ([label]: any[]) => label === "MP_WEBHOOK_INVALID_SIGNATURE"
    );
    expect(mismatch).toBeDefined();
    expect((mismatch![1] as any).reason).toBe("SIGNATURE_MISMATCH");
  });

  it("still rejects with 401 SIGNATURE_MISMATCH when the ts is in the future but the hash is wrong", async () => {
    const futureTs = (Date.now() + 24 * 60 * 60 * 1000).toString();
    const res = await POST(
      buildSignedRequest({
        dataId: "ts_payment",
        ts: futureTs,
        v1: "0".repeat(64),
      })
    );
    expect(res.status).toBe(401);
    const mismatch = warnSpy.mock.calls.find(
      ([label]: any[]) => label === "MP_WEBHOOK_INVALID_SIGNATURE"
    );
    expect((mismatch![1] as any).reason).toBe("SIGNATURE_MISMATCH");
  });

  it("never emits a STALE_TIMESTAMP rejection reason", async () => {
    const cases = [
      Date.now() - 24 * 60 * 60 * 1000,
      Date.now() + 24 * 60 * 60 * 1000,
      Date.now(),
    ].map((ms) => ms.toString());

    for (const ts of cases) {
      await POST(buildSignedRequest({ dataId: "ts_payment", ts }));
      await POST(
        buildSignedRequest({
          dataId: "ts_payment",
          ts,
          v1: "0".repeat(64),
        })
      );
    }

    const allReasons = warnSpy.mock.calls
      .map(([, ctx]: any[]) => (ctx as any)?.reason)
      .filter(Boolean);
    expect(allReasons).not.toContain("STALE_TIMESTAMP");
  });
});

describe("middleware does not block /api/webhooks/mercadopago", () => {
  it("does not require onboarding for webhook requests without a session", async () => {
    const mod = await import("@/lib/affiliation-gate");

    expect(
      mod.shouldRequireAffiliationOnboarding(
        "/api/webhooks/mercadopago",
        null
      )
    ).toBe(false);
  });
});
