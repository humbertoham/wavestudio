// src/app/api/webhooks/mercadopago/route.ts
import { createHmac, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  MercadoPagoConfig,
  MerchantOrder,
  Payment as MPPayment,
} from "mercadopago";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

type WebhookPayload = {
  action?: string;
  api_version?: string;
  data?: {
    id?: string | number;
    external_reference?: string;
    preference_id?: string;
  } | null;
  date_created?: string;
  id?: string | number;
  live_mode?: boolean;
  resource?: string;
  type?: string;
  user_id?: string | number;
};

type SignatureParts = {
  ts: string;
  v1: string;
};

type SignatureValidationResult =
  | {
      ok: true;
      dataId: string;
      requestId: string;
      ts: string;
      manifest: string;
    }
  | {
      ok: false;
      status: 400 | 401 | 500;
      error: string;
      reason: string;
      dataId: string | null;
      requestId: string | null;
    };

function j(status: number, body: any) {
  return NextResponse.json(body, { status });
}

function parseJsonObject<T>(raw: string): T | null {
  try {
    const parsed = raw ? JSON.parse(raw) : null;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    return parsed as T;
  } catch {
    return null;
  }
}

function mapStatus(s?: string) {
  switch ((s || "").toLowerCase()) {
    case "approved":
      return "APPROVED";
    case "rejected":
      return "REJECTED";
    case "cancelled":
      return "CANCELED";
    case "refunded":
      return "REFUNDED";
    default:
      return "PENDING";
  }
}

function readPositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.floor(parsed);
}

function resolveNotificationIdFromUrl(url: URL) {
  // Official docs use data.id in the query string. We keep an id fallback
  // to preserve compatibility with the existing integration formats.
  const dataId = url.searchParams.get("data.id")?.trim();
  if (dataId) return dataId;

  const legacyId = url.searchParams.get("id")?.trim();
  if (legacyId) return legacyId;

  return null;
}

function parseSignatureHeader(headerValue: string | null): SignatureParts | null {
  if (!headerValue) return null;

  let ts = "";
  let v1 = "";

  for (const part of headerValue.split(",")) {
    const [rawKey, rawValue] = part.split("=", 2);
    const key = rawKey?.trim().toLowerCase();
    const value = rawValue?.trim();

    if (!key || !value) continue;
    if (key === "ts") ts = value;
    if (key === "v1") v1 = value.toLowerCase();
  }

  if (!/^\d+$/.test(ts)) return null;
  if (!/^[a-f0-9]{64}$/i.test(v1)) return null;

  return { ts, v1 };
}

function buildSignatureManifest(dataId: string, requestId: string, ts: string) {
  return `id:${dataId};request-id:${requestId};ts:${ts};`;
}

function safeCompareHex(left: string, right: string) {
  const a = Buffer.from(left.toLowerCase(), "utf8");
  const b = Buffer.from(right.toLowerCase(), "utf8");

  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function validateSignature(req: Request, url: URL): SignatureValidationResult {
  const secret = process.env.MP_WEBHOOK_SECRET?.trim();
  const dataId = resolveNotificationIdFromUrl(url);
  const requestId = req.headers.get("x-request-id")?.trim() ?? null;
  const xSignature = req.headers.get("x-signature");

  if (!secret) {
    return {
      ok: false,
      status: 500,
      error: "WEBHOOK_SECRET_NOT_CONFIGURED",
      reason: "MISSING_SECRET",
      dataId,
      requestId,
    };
  }

  if (!dataId || !requestId || !xSignature) {
    return {
      ok: false,
      status: 400,
      error: "MALFORMED_REQUEST",
      reason: "MISSING_SIGNATURE_PARTS",
      dataId,
      requestId,
    };
  }

  const signature = parseSignatureHeader(xSignature);
  if (!signature) {
    return {
      ok: false,
      status: 400,
      error: "MALFORMED_REQUEST",
      reason: "INVALID_SIGNATURE_HEADER",
      dataId,
      requestId,
    };
  }

  const tsNumber = Number(signature.ts);
  if (Math.abs(Date.now() - tsNumber) > SIGNATURE_MAX_AGE_MS) {
    return {
      ok: false,
      status: 401,
      error: "INVALID_SIGNATURE",
      reason: "STALE_TIMESTAMP",
      dataId,
      requestId,
    };
  }

  const manifest = buildSignatureManifest(dataId, requestId, signature.ts);
  const computed = createHmac("sha256", secret).update(manifest).digest("hex");

  if (!safeCompareHex(computed, signature.v1)) {
    return {
      ok: false,
      status: 401,
      error: "INVALID_SIGNATURE",
      reason: "SIGNATURE_MISMATCH",
      dataId,
      requestId,
    };
  }

  return {
    ok: true,
    dataId,
    requestId,
    ts: signature.ts,
    manifest,
  };
}

async function updateWebhookLog(
  logId: string | null | undefined,
  processedOk: boolean,
  error: string
) {
  if (!logId) return;

  try {
    await prisma.webhookLog.update({
      where: { id: logId },
      data: { processedOk, error },
    });
  } catch (updateError) {
    console.error("MP_WEBHOOK_LOG_UPDATE_FAILED", {
      logId,
      error: updateError instanceof Error ? updateError.message : String(updateError),
    });
  }
}

async function getPaymentWithRetry(
  client: MercadoPagoConfig,
  id: string,
  attempts = 3
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await new MPPayment(client).get({ id });
    } catch (error) {
      if (attempt === attempts - 1) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  throw new Error("MP_PAYMENT_GET_FAILED_RETRY");
}

export async function POST(req: Request) {
  try {
    const raw = await req.text();
    const url = new URL(req.url);

    const signatureCheck = validateSignature(req, url);
    if (!signatureCheck.ok) {
      const logPayload = {
        dataId: signatureCheck.dataId,
        requestId: signatureCheck.requestId,
        reason: signatureCheck.reason,
      };

      if (signatureCheck.status === 401) {
        console.warn("MP_WEBHOOK_INVALID_SIGNATURE", logPayload);
      } else if (signatureCheck.status === 400) {
        console.warn("MP_WEBHOOK_MALFORMED", logPayload);
      } else {
        console.error("MP_WEBHOOK_CONFIG_ERROR", logPayload);
      }

      return j(signatureCheck.status, { error: signatureCheck.error });
    }

    const payload = parseJsonObject<WebhookPayload>(raw);
    if (!payload) {
      console.warn("MP_WEBHOOK_INVALID_JSON", {
        dataId: signatureCheck.dataId,
        requestId: signatureCheck.requestId,
      });
      return j(400, { error: "INVALID_JSON" });
    }

    const qType =
      url.searchParams.get("type") ||
      url.searchParams.get("topic") ||
      payload.type ||
      null;
    const qId = signatureCheck.dataId;

    const deliveryId =
      qId ||
      payload.id?.toString() ||
      payload.data?.id?.toString() ||
      payload.resource?.toString() ||
      null;

    const log = await prisma.webhookLog
      .create({
        data: {
          provider: "MERCADOPAGO",
          eventType: payload.type || payload.action || qType || "unknown",
          deliveryId,
          payload,
        },
      })
      .catch((createError) => {
        console.error("MP_WEBHOOK_LOG_CREATE_FAILED", {
          deliveryId,
          requestId: signatureCheck.requestId,
          error:
            createError instanceof Error ? createError.message : String(createError),
        });
        return null;
      });

    const accessToken = process.env.MP_ACCESS_TOKEN?.trim();
    if (!accessToken) {
      await updateWebhookLog(log?.id, false, "MP_ACCESS_TOKEN_MISSING");
      console.error("MP_WEBHOOK_CONFIG_ERROR", {
        dataId: signatureCheck.dataId,
        requestId: signatureCheck.requestId,
        reason: "MISSING_ACCESS_TOKEN",
      });
      return j(500, { error: "INTERNAL_ERROR" });
    }

    const client = new MercadoPagoConfig({ accessToken });

    let paymentId: string | null =
      qType === "payment" || payload.type === "payment"
        ? qId ?? payload.data?.id?.toString() ?? payload.id?.toString() ?? null
        : null;

    let prefIdFromMO: string | undefined;

    if (
      !paymentId &&
      (qType === "merchant_order" || payload.type === "merchant_order")
    ) {
      const merchantOrderId =
        qId ??
        payload.data?.id?.toString() ??
        payload.id?.toString() ??
        payload.resource?.toString()?.split("/").pop() ??
        null;

      if (merchantOrderId) {
        try {
          const merchantOrder = await new MerchantOrder(client).get({
            merchantOrderId,
          });
          prefIdFromMO = (merchantOrder as any)?.preference_id;

          const payments = (merchantOrder as any)?.payments || [];
          const approved = payments.find(
            (item: any) => item?.status === "approved"
          );
          paymentId = (approved?.id || payments?.[0]?.id)?.toString() ?? null;
        } catch {
          // Keep the existing retry-driven behavior below if we cannot resolve it yet.
        }
      }
    }

    if (!paymentId && typeof payload.resource === "string") {
      paymentId = payload.resource.split("/").pop() ?? null;
    }

    if (!paymentId) {
      await updateWebhookLog(log?.id, true, "NO_PAYMENT_ID");
      console.info("MP_WEBHOOK_NO_PAYMENT_ID", {
        dataId: signatureCheck.dataId,
        requestId: signatureCheck.requestId,
      });
      return j(200, { ok: true });
    }

    let mp: any;
    try {
      mp = await getPaymentWithRetry(client, paymentId);
    } catch (error) {
      await updateWebhookLog(log?.id, false, "MP_PAYMENT_GET_FAILED_RETRY");
      console.error("MP_WEBHOOK_MP_FETCH_FAILED", {
        mpPaymentId: paymentId,
        requestId: signatureCheck.requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      return j(500, { error: "INTERNAL_ERROR" });
    }

    const newStatus = mapStatus(mp?.status);
    const mpExtRef = mp?.external_reference ?? payload.data?.external_reference;
    const mpPrefId =
      mp?.preference_id ?? payload.data?.preference_id ?? prefIdFromMO;
    const mpPayerEmail = mp?.payer?.email;

    const [extUserId, extPackId, hintedPaymentId] = (mpExtRef ?? "").split("|");

    let local = await prisma.payment.findFirst({
      where: {
        OR: [
          { mpPaymentId: paymentId },
          mpPrefId ? { mpPreferenceId: mpPrefId } : undefined,
          mpExtRef ? { mpExternalRef: mpExtRef } : undefined,
        ].filter(Boolean) as any,
      },
      include: { checkoutLink: true, packPurchase: true },
    });

    if (!local && hintedPaymentId) {
      local = await prisma.payment.findUnique({
        where: { id: hintedPaymentId },
        include: { checkoutLink: true, packPurchase: true },
      });
    }

    if (!local) {
      await updateWebhookLog(log?.id, false, "LOCAL_PAYMENT_NOT_FOUND_RETRY");
      console.error("MP_WEBHOOK_LOCAL_PAYMENT_NOT_FOUND", {
        mpPaymentId: paymentId,
        requestId: signatureCheck.requestId,
      });
      return j(500, { error: "INTERNAL_ERROR" });
    }

    if (newStatus === "APPROVED") {
      const alreadyProcessed =
        !!local.packPurchase ||
        !!(await prisma.payment.findFirst({
          where: {
            mpPaymentId: paymentId,
            packPurchase: { isNot: null },
          },
          select: { id: true },
        }));

      if (alreadyProcessed) {
        await updateWebhookLog(log?.id, true, "ALREADY_CREDITED");
        console.info("MP_WEBHOOK_DUPLICATE", {
          mpPaymentId: paymentId,
          localPaymentId: local.id,
          requestId: signatureCheck.requestId,
        });
        return j(200, { ok: true });
      }
    }

    if (newStatus === "REFUNDED") {
      const paymentForRefund = await prisma.payment.findUnique({
        where: { id: local.id },
        include: {
          packPurchase: {
            include: {
              pack: {
                select: { classes: true },
              },
            },
          },
        },
      });
      const purchase = paymentForRefund?.packPurchase;

      if (purchase) {
        if (paymentForRefund.status === "REFUNDED") {
          await updateWebhookLog(log?.id, true, "ALREADY_REFUNDED");
          return j(200, { ok: true });
        }

        const credited = await prisma.tokenLedger.aggregate({
          where: {
            packPurchaseId: purchase.id,
            reason: "PURCHASE_CREDIT",
          },
          _sum: { delta: true },
        });

        const originalCredits = Math.max(
          0,
          credited._sum.delta ?? purchase.pack.classes
        );
        const usedCredits = Math.max(0, originalCredits - purchase.classesLeft);

        if (usedCredits > 0) {
          try {
            await prisma.$transaction(async (tx) => {
              await tx.payment.update({
                where: { id: local!.id },
                data: {
                  status: "REFUNDED",
                  mpPaymentId: paymentId,
                  mpPreferenceId: mpPrefId ?? local!.mpPreferenceId,
                  mpExternalRef: mpExtRef ?? local!.mpExternalRef,
                  mpPayerEmail: mpPayerEmail ?? local!.mpPayerEmail,
                  mpRaw: mp,
                },
              });

              if (purchase.classesLeft > 0) {
                await tx.packPurchase.update({
                  where: { id: purchase.id },
                  data: { classesLeft: 0 },
                });

                await tx.tokenLedger.create({
                  data: {
                    userId: purchase.userId,
                    packPurchaseId: purchase.id,
                    delta: -purchase.classesLeft,
                    reason: "ADMIN_ADJUST",
                  },
                });
              }

              await tx.user.update({
                where: { id: purchase.userId },
                data: {
                  bookingBlocked: true,
                  bookingBlockedAt: new Date(),
                },
              });

              await tx.bookingBlockLog.create({
                data: {
                  userId: purchase.userId,
                  blocked: true,
                },
              });

              await tx.checkoutLink.updateMany({
                where: { paymentId: local!.id },
                data: { status: "CANCELED" },
              });

              if (log?.id) {
                await tx.webhookLog.update({
                  where: { id: log.id },
                  data: {
                    processedOk: true,
                    error: `REFUND_DEBT_USED_CREDITS:${usedCredits}`,
                  },
                });
              }
            });
          } catch (error) {
            await updateWebhookLog(
              log?.id,
              false,
              `REFUND_DEBT_SYNC_FAILED:${error instanceof Error ? error.message : String(error)}`
            );
            console.error("MP_WEBHOOK_REFUND_DEBT_SYNC_FAILED", {
              mpPaymentId: paymentId,
              localPaymentId: local.id,
              purchaseId: purchase.id,
              requestId: signatureCheck.requestId,
              error: error instanceof Error ? error.message : String(error),
            });
            return j(200, { ok: false, error: "REFUND_DEBT_SYNC_FAILED" });
          }

          console.warn("MP_WEBHOOK_REFUND_BLOCKED_CREDITS_USED", {
            mpPaymentId: paymentId,
            localPaymentId: local.id,
            purchaseId: purchase.id,
            originalCredits,
            classesLeft: purchase.classesLeft,
            usedCredits,
            requestId: signatureCheck.requestId,
          });
          return j(200, { ok: true, debt: true });
        }
      }
    }

    try {
      await prisma.$transaction(async (tx) => {
        const updated = await tx.payment.update({
          where: { id: local!.id },
          data: {
            status: newStatus as any,
            mpPaymentId: paymentId,
            mpPreferenceId: mpPrefId ?? local!.mpPreferenceId,
            mpExternalRef: mpExtRef ?? local!.mpExternalRef,
            mpPayerEmail: mpPayerEmail ?? local!.mpPayerEmail,
            mpRaw: mp,
          },
        });

        const link = await tx.checkoutLink.findFirst({
          where: { paymentId: updated.id },
          select: {
            id: true,
            userId: true,
            packId: true,
            status: true,
          },
        });

        if (newStatus !== "APPROVED") {
          if (log?.id) {
            await tx.webhookLog.update({
              where: { id: log.id },
              data: { processedOk: true, error: `NO_CREDIT_STATUS_${newStatus}` },
            });
          }
          return;
        }

        const existing = await tx.packPurchase.findUnique({
          where: { paymentId: updated.id },
        });

        if (existing) {
          if (log?.id) {
            await tx.webhookLog.update({
              where: { id: log.id },
              data: { processedOk: true, error: "ALREADY_CREDITED" },
            });
          }
          return;
        }

        let beneficiaryUserId: string | null =
          (extUserId && extUserId !== "anon" ? extUserId : null) ??
          link?.userId ??
          null;

        if (!beneficiaryUserId && mpPayerEmail) {
          const email = mpPayerEmail.trim().toLowerCase();
          const user = await tx.user.upsert({
            where: { email },
            update: {},
            create: {
              name: email.split("@")[0],
              email,
              passwordHash: "TEMP-AUTO",
            },
            select: { id: true },
          });
          beneficiaryUserId = user.id;
        }

        if (!beneficiaryUserId) {
          throw new Error("NO_BENEFICIARY_USER");
        }

        let packId = link?.packId ?? extPackId ?? null;

        if (!packId) {
          const linkFallback = await tx.checkoutLink.findFirst({
            where: { paymentId: updated.id },
            select: { packId: true },
          });
          packId = linkFallback?.packId ?? null;
        }

        if (!packId) {
          throw new Error("PACK_ID_NOT_RESOLVED");
        }

        const pack = await tx.pack.findUnique({
          where: { id: packId },
          select: {
            id: true,
            classes: true,
            validityDays: true,
          },
        });

        if (!pack) {
          throw new Error("PACK_NOT_FOUND");
        }

        const creditedClasses =
          readPositiveInt(mp?.metadata?.packClasses) ??
          Math.max(1, pack.classes);
        const creditedValidityDays =
          readPositiveInt(mp?.metadata?.packValidityDays) ??
          Math.max(1, pack.validityDays);

        const purchase = await tx.packPurchase.create({
          data: {
            userId: beneficiaryUserId,
            packId: pack.id,
            classesLeft: creditedClasses,
            expiresAt: new Date(Date.now() + creditedValidityDays * 86400000),
            paymentId: updated.id,
          },
        });

        await tx.tokenLedger.create({
          data: {
            userId: beneficiaryUserId,
            packPurchaseId: purchase.id,
            delta: creditedClasses,
            reason: "PURCHASE_CREDIT",
          },
        });

        if (link && link.status !== "COMPLETED") {
          await tx.checkoutLink.update({
            where: { id: link.id },
            data: { status: "COMPLETED", completedAt: new Date() },
          });
        }

        if (log?.id) {
          await tx.webhookLog.update({
            where: { id: log.id },
            data: {
              processedOk: true,
              error: `CREDIT_OK_user=${beneficiaryUserId}_pack=${packId}`,
            },
          });
        }
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        await updateWebhookLog(log?.id, true, "ALREADY_CREDITED_CONCURRENT");
        console.info("MP_WEBHOOK_DUPLICATE", {
          mpPaymentId: paymentId,
          localPaymentId: local.id,
          requestId: signatureCheck.requestId,
        });
        return j(200, { ok: true });
      }

      await updateWebhookLog(
        log?.id,
        false,
        `TX_ERROR:${error instanceof Error ? error.message : String(error)}`
      );
      console.error("MP_WEBHOOK_TX_ERROR", {
        mpPaymentId: paymentId,
        localPaymentId: local.id,
        requestId: signatureCheck.requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      if (newStatus === "REFUNDED") {
        return j(200, { ok: false, error: "REFUND_SYNC_FAILED" });
      }
      return j(500, { error: "INTERNAL_ERROR" });
    }

    if ((mp?.status || "").toLowerCase() === "refunded") {
      try {
        await prisma.$transaction(async (tx) => {
          const payment = await tx.payment.findUnique({
            where: { id: local!.id },
            include: { packPurchase: true },
          });
          const purchase = payment?.packPurchase;

          if (purchase && purchase.classesLeft > 0) {
            const undo = purchase.classesLeft;

            const updatedPurchase = await tx.packPurchase.updateMany({
              where: {
                id: purchase.id,
                classesLeft: { gte: undo },
              },
              data: { classesLeft: { decrement: undo } },
            });

            if (updatedPurchase.count !== 1) {
              throw new Error("REFUND_BALANCE_CHANGED");
            }

            await tx.tokenLedger.create({
              data: {
                userId: purchase.userId,
                packPurchaseId: purchase.id,
                delta: -undo,
                reason: "CANCEL_REFUND",
              },
            });
          }

          const link = await tx.checkoutLink.findFirst({
            where: { paymentId: local!.id },
          });

          if (link && link.status !== "CANCELED") {
            await tx.checkoutLink.update({
              where: { id: link.id },
              data: { status: "CANCELED" },
            });
          }
        });

        await updateWebhookLog(log?.id, true, "REFUND_APPLIED");
      } catch (error) {
        await updateWebhookLog(
          log?.id,
          false,
          `REFUND_SYNC_FAILED:${error instanceof Error ? error.message : String(error)}`
        );
        console.error("MP_WEBHOOK_REFUND_SYNC_FAILED", {
          mpPaymentId: paymentId,
          localPaymentId: local.id,
          requestId: signatureCheck.requestId,
          error: error instanceof Error ? error.message : String(error),
        });
        return j(200, { ok: false, error: "REFUND_SYNC_FAILED" });
      }
    }

    console.info("MP_WEBHOOK_PROCESSED", {
      mpPaymentId: paymentId,
      localPaymentId: local.id,
      status: newStatus,
      requestId: signatureCheck.requestId,
    });

    return j(200, { ok: true });
  } catch (error) {
    console.error("MP_WEBHOOK_FATAL", {
      error: error instanceof Error ? error.message : String(error),
    });
    return j(500, { error: "INTERNAL_ERROR" });
  }
}
