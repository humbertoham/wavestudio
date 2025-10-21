import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { MercadoPagoConfig, Payment as MPPayment, MerchantOrder } from "mercadopago";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function j(status: number, body: any) {
  return NextResponse.json(body, { status });
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
async function hmacSha256Hex(secret: string, data: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeJson<T = any>(raw: string): T {
  try {
    return raw ? JSON.parse(raw) : ({} as T);
  } catch {
    return {} as T;
  }
}

function parseXSignature(header: string | null) {
  if (!header) return null;
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const [k, v] = kv.trim().split("=");
      return [k?.trim(), v?.trim()];
    })
  ) as Record<string, string>;
  return { ts: parts["ts"], v1: (parts["v1"] || parts["sha256"] || "").toLowerCase() };
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

// ─────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────
export async function POST(req: Request) {
  const raw = await req.text();
  const payload = safeJson(raw);
  const url = new URL(req.url);

  const qType = url.searchParams.get("type") || url.searchParams.get("topic");
  const qId = url.searchParams.get("id");

  // === deliveryId SOLO tracking ===
  const deliveryId =
    qId ||
    payload?.id?.toString() ||
    payload?.data?.id?.toString() ||
    payload?.resource?.toString() ||
    null;

  // === Log inicial ===
  let log = await prisma.webhookLog.create({
    data: {
      provider: "MERCADOPAGO",
      eventType: payload?.type || payload?.action || qType || "unknown",
      deliveryId,
      payload,
    },
  });

  // === Validación de firma (si hay secreto) ===
  const secret = process.env.MP_WEBHOOK_SECRET?.trim();
  const xSig = req.headers.get("x-signature");
  const legacySig = req.headers.get("x-hub-signature-256") || req.headers.get("x-mercadopago-signature");
  const fixedUrl = process.env.MP_NOTIFICATION_URL?.trim();

  try {
    if (secret) {
      if (xSig) {
        const { ts, v1 } = parseXSignature(xSig) || {};
        // usa la URL EXACTA configurada en MP
        const notificationUrl = fixedUrl || `${url.origin}${url.pathname}`;
        const canonical = `${deliveryId ?? ""}:${ts ?? ""}:${notificationUrl}:${raw}`;
        const expected = await hmacSha256Hex(secret, canonical);

        if (!v1 || v1 !== expected) {
          console.error("❌ Firma inválida MP", {
            deliveryId,
            ts,
            notificationUrl,
            expected,
            v1,
          });
          await prisma.webhookLog.update({
            where: { id: log.id },
            data: { processedOk: false, error: "INVALID_SIGNATURE" },
          });
          return j(200, { ok: true });
        }
      } else if (legacySig?.startsWith("sha256=")) {
        const got = legacySig.replace(/^sha256=/i, "").toLowerCase();
        const expected = await hmacSha256Hex(secret, raw);
        if (got !== expected) {
          await prisma.webhookLog.update({
            where: { id: log.id },
            data: { processedOk: false, error: "INVALID_SIGNATURE_LEGACY" },
          });
          return j(200, { ok: true });
        }
      }
    }
  } catch (e) {
    await prisma.webhookLog.update({
      where: { id: log.id },
      data: { processedOk: false, error: "SIGNATURE_CHECK_ERROR" },
    });
    return j(200, { ok: true });
  }

  // === Token de MP ===
  const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
  if (!ACCESS_TOKEN) {
    await prisma.webhookLog.update({
      where: { id: log.id },
      data: { processedOk: false, error: "MP_ACCESS_TOKEN_MISSING" },
    });
    return j(200, { ok: true });
  }
  const client = new MercadoPagoConfig({ accessToken: ACCESS_TOKEN });

  // === Resolver paymentId ===
  let paymentId: string | undefined =
    qType === "payment"
      ? qId ?? payload?.data?.id?.toString() ?? payload?.id?.toString()
      : undefined;

  let prefIdFromMO: string | undefined;
  if (!paymentId && (qType === "merchant_order" || payload?.type === "merchant_order")) {
    const moId =
      qId ??
      payload?.data?.id?.toString() ??
      payload?.id?.toString() ??
      payload?.resource?.toString()?.split("/").pop();
    if (moId) {
      try {
        const mo = await new MerchantOrder(client).get({ merchantOrderId: moId });
        prefIdFromMO = (mo as any)?.preference_id;
        const payments = (mo as any)?.payments || [];
        const approved = payments.find((p: any) => p?.status === "approved");
        paymentId = (approved?.id || payments?.[0]?.id)?.toString();
      } catch {}
    }
  }

  if (!paymentId && typeof payload?.resource === "string") {
    paymentId = payload.resource.split("/").pop();
  }

  if (!paymentId) {
    await prisma.webhookLog.update({
      where: { id: log.id },
      data: { processedOk: true, error: "NO_PAYMENT_ID" },
    });
    return j(200, { ok: true });
  }

  // === Consultar pago en MP ===
  let mp: any;
  try {
    mp = await new MPPayment(client).get({ id: paymentId });
  } catch {
    await prisma.webhookLog.update({
      where: { id: log.id },
      data: { processedOk: false, error: "MP_PAYMENT_GET_FAILED" },
    });
    return j(200, { ok: true });
  }

  const mpStatus = mp?.status;
  const mpExtRef = mp?.external_reference ?? payload?.data?.external_reference;
  const mpPrefId = mp?.preference_id ?? payload?.data?.preference_id ?? prefIdFromMO;
  const mpCurrency = mp?.currency_id;
  const mpAmount = typeof mp?.transaction_amount === "number" ? mp.transaction_amount : Number(mp?.transaction_amount);
  const mpPayerEmail = mp?.payer?.email;

  const [extUserId, extPackId, hintedPaymentId] = (mpExtRef ?? "").split("|");

  // === Buscar Payment local ===
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
    await prisma.webhookLog.update({
      where: { id: log.id },
      data: { processedOk: true, error: "LOCAL_PAYMENT_NOT_FOUND" },
    });
    return j(200, { ok: true });
  }

  // === Procesar estado más reciente ===
  try {
    await prisma.$transaction(async (tx) => {
      const newStatus = mapStatus(mpStatus);

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
        include: { checkoutLink: true, packPurchase: true },
      });

      if (newStatus !== "APPROVED") {
        if (["REJECTED", "CANCELED", "REFUNDED"].includes(newStatus) && updated.checkoutLink && updated.checkoutLink.status !== "COMPLETED") {
          await tx.checkoutLink.update({ where: { id: updated.checkoutLink.id }, data: { status: "CANCELED" } });
        }
        await tx.webhookLog.update({ where: { id: log.id }, data: { processedOk: true, error: `NO_CREDIT_STATUS_${newStatus}` } });
        return;
      }

      // Ya acreditado
      if (updated.packPurchase) {
        if (updated.checkoutLink && updated.checkoutLink.status !== "COMPLETED") {
          await tx.checkoutLink.update({ where: { id: updated.checkoutLink.id }, data: { status: "COMPLETED", completedAt: new Date() } });
        }
        await tx.webhookLog.update({ where: { id: log.id }, data: { processedOk: true, error: "ALREADY_CREDITED" } });
        return;
      }

      // Resolver beneficiario
      let beneficiaryUserId: string | null =
        (extUserId && extUserId !== "anon" ? extUserId : null) ??
        updated.checkoutLink?.userId ??
        null;

      if (!beneficiaryUserId && mpPayerEmail) {
        const email = String(mpPayerEmail).trim().toLowerCase();
        const u = await tx.user.upsert({
          where: { email },
          update: {},
          create: { name: email.split("@")[0], email, passwordHash: "TEMP-AUTO" },
          select: { id: true },
        });
        beneficiaryUserId = u.id;
        await tx.webhookLog.update({
          where: { id: log.id },
          data: { error: "AUTO_CREATED_USER_FOR_PAYER_EMAIL" },
        });
      }

      if (!beneficiaryUserId) {
        await tx.webhookLog.update({ where: { id: log.id }, data: { processedOk: true, error: "NO_BENEFICIARY_USER" } });
        return;
      }

      const packId = updated.checkoutLink?.packId ?? (extPackId || null);
      if (!packId) throw new Error("CHECKOUT_LINK_WITHOUT_PACK");

      const pack = await tx.pack.findUnique({ where: { id: packId } });
      if (!pack) throw new Error("PACK_NOT_FOUND");

      const purchase = await tx.packPurchase.create({
        data: {
          userId: beneficiaryUserId,
          packId: pack.id,
          classesLeft: pack.classes,
          expiresAt: new Date(Date.now() + pack.validityDays * 24 * 60 * 60 * 1000),
          paymentId: updated.id,
        },
      });

      await tx.tokenLedger.create({
        data: { userId: beneficiaryUserId, packPurchaseId: purchase.id, delta: pack.classes, reason: "PURCHASE_CREDIT" },
      });

      if (updated.checkoutLink) {
        await tx.checkoutLink.update({
          where: { id: updated.checkoutLink.id },
          data: { status: "COMPLETED", completedAt: new Date() },
        });
      }

      await tx.webhookLog.update({ where: { id: log.id }, data: { processedOk: true, error: "CREDIT_OK" } });
    });
  } catch (e: any) {
    await prisma.webhookLog.update({
      where: { id: log.id },
      data: { processedOk: false, error: `TX_ERROR:${String(e?.message ?? e)}` },
    });
    return j(200, { ok: true });
  }

  return j(200, { ok: true });
}
