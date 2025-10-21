// src/app/api/webhooks/mercadopago/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { MercadoPagoConfig, Payment as MPPayment, MerchantOrder } from "mercadopago";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function j(status: number, body: any) {
  return NextResponse.json(body, { status });
}

// HMAC util (hex)
async function hmacSha256Hex(secret: string, data: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Safe JSON parse
function safeJson<T = any>(raw: string): T {
  try {
    return raw ? JSON.parse(raw) : ({} as T);
  } catch {
    return {} as T;
  }
}

// Parse x-signature: "ts=..., v1=..."
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

export async function POST(req: Request) {
  // === 0) Raw body, URL, payload ===
  const raw = await req.text();
  const payload = safeJson(raw);
  const url = new URL(req.url);

  const qType = url.searchParams.get("type") || url.searchParams.get("topic");
  const qId = url.searchParams.get("id");

  // === 1) deliveryId para idempotencia ===
  const deliveryId =
    payload?.id?.toString() ||
    payload?.data?.id?.toString() ||
    payload?.resource?.toString() ||
    qId ||
    null;

  // Dedupe rápido si ya fue procesado ok
  if (deliveryId) {
    const exists = await prisma.webhookLog.findFirst({
      where: { provider: "MERCADOPAGO", deliveryId, processedOk: true },
      select: { id: true },
    });
    if (exists) {
      return j(200, { ok: true, deduped: true });
    }
  }

  // === 2) Crear log INICIAL (antes de validar firma) ===
  let log = await prisma.webhookLog.create({
    data: {
      provider: "MERCADOPAGO",
      eventType: payload?.type || payload?.action || qType || "unknown",
      deliveryId,
      payload,
    },
  });

  // === 3) Validación de firma (opcional, correcta) ===
  const secret = process.env.MP_WEBHOOK_SECRET?.trim();
  const xSig = req.headers.get("x-signature");
  const legacySig =
    req.headers.get("x-hub-signature-256") || req.headers.get("x-mercadopago-signature");

  try {
    if (secret) {
      if (xSig) {
        // Cadena canónica: `${id}:${ts}:${notification_url}:${raw_body}`
        const parsed = parseXSignature(xSig);
        const ts = parsed?.ts || "";
        const v1 = parsed?.v1 || "";
        // URL canónica sin querystring
        const notificationUrl = `${url.origin}${url.pathname}`;
        const canonical = `${deliveryId ?? ""}:${ts}:${notificationUrl}:${raw}`;
        const expected = await hmacSha256Hex(secret, canonical);
        if (!v1 || v1 !== expected) {
          await prisma.webhookLog.update({
            where: { id: log.id },
            data: { processedOk: false, error: "INVALID_SIGNATURE" },
          });
          return j(200, { ok: true });
        }
      } else if (legacySig?.startsWith("sha256=")) {
        // Fallback legacy: HMAC(body)
        const got = legacySig.replace(/^sha256=/i, "").toLowerCase();
        const expected = await hmacSha256Hex(secret, raw);
        if (got !== expected) {
          await prisma.webhookLog.update({
            where: { id: log.id },
            data: { processedOk: false, error: "INVALID_SIGNATURE_LEGACY" },
          });
          return j(200, { ok: true });
        }
      } else {
        // Sin header de firma → permitimos, pero lo dejamos asentado
        await prisma.webhookLog.update({
          where: { id: log.id },
          data: { error: "NO_SIGNATURE_HEADER" },
        });
      }
    }
  } catch {
    await prisma.webhookLog.update({
      where: { id: log.id },
      data: { processedOk: false, error: "SIGNATURE_CHECK_ERROR" },
    });
    return j(200, { ok: true });
  }

  // === 4) Token de MP presente ===
  if (!process.env.MP_ACCESS_TOKEN) {
    await prisma.webhookLog.update({
      where: { id: log.id },
      data: { processedOk: false, error: "MP_ACCESS_TOKEN_MISSING" },
    });
    return j(200, { ok: true });
  }

  const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN! });

  // === 5) Resolver paymentId (incluye merchant_order y resource) ===
  let paymentId: string | undefined =
    qType === "payment"
      ? qId ?? payload?.data?.id?.toString() ?? payload?.id?.toString()
      : undefined;

  let preferenceIdFromMO: string | undefined;

  if (!paymentId && (qType === "merchant_order" || payload?.type === "merchant_order")) {
    const moId =
      qId ??
      payload?.data?.id?.toString() ??
      payload?.id?.toString() ??
      payload?.resource?.toString()?.split("/").pop();
    if (moId) {
      try {
        const mo = await new MerchantOrder(client).get({ merchantOrderId: moId });
        preferenceIdFromMO = (mo as any)?.preference_id;
        const approvedPay = (mo as any)?.payments?.find((p: any) => p?.status === "approved");
        if (approvedPay?.id) paymentId = approvedPay.id.toString();
      } catch {
        // seguimos con otros caminos
      }
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

  // === 6) Consultar Payment en MP ===
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

  const mpStatus: string | undefined = mp?.status; // approved | rejected | pending | cancelled | refunded
  const mpStatusDetail: string | undefined = mp?.status_detail;
  const mpExtRef: string | undefined = mp?.external_reference ?? payload?.data?.external_reference;
  const mpPrefId: string | undefined =
    mp?.preference_id ?? payload?.data?.preference_id ?? preferenceIdFromMO;
  const mpCurrency: string | undefined = mp?.currency_id;
  const mpAmount: number | undefined =
    typeof mp?.transaction_amount === "number"
      ? mp.transaction_amount
      : Number(mp?.transaction_amount);
  const mpPayerEmail: string | undefined = mp?.payer?.email;

  const [extUserId, extPackId, hintedPaymentId] = (mpExtRef ?? "").split("|");

  // === 7) Buscar Payment local ===
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

  // === 8) Mapear estado ===
  const mapStatus = (s?: string) => {
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
  };

  // === 9) Transacción: actualizar y (si corresponde) acreditar ===
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

    // Cierra/cancela link si corresponde
    if (["REJECTED", "CANCELED", "REFUNDED"].includes(newStatus)) {
      if (updated.checkoutLink && updated.checkoutLink.status !== "COMPLETED") {
        await tx.checkoutLink.update({
          where: { id: updated.checkoutLink.id },
          data: { status: "CANCELED" },
        });
      }
      await tx.webhookLog.update({
        where: { id: log.id },
        data: { error: `NO_CREDIT_STATUS_${newStatus}`, processedOk: true },
      });
      return;
    }

    if (newStatus !== "APPROVED") {
      await tx.webhookLog.update({
        where: { id: log.id },
        data: { error: "NO_CREDIT_STATUS_PENDING", processedOk: true },
      });
      return;
    }

    // Idempotencia si ya se acreditó
    if (updated.packPurchase) {
      if (updated.checkoutLink && updated.checkoutLink.status !== "COMPLETED") {
        await tx.checkoutLink.update({
          where: { id: updated.checkoutLink.id },
          data: { status: "COMPLETED", completedAt: new Date() },
        });
      }
      await tx.webhookLog.update({
        where: { id: log.id },
        data: { error: "ALREADY_CREDITED", processedOk: true },
      });
      return;
    }

    // === 9.1 Beneficiario ===
    let beneficiaryUserId: string | null =
      (extUserId && extUserId !== "anon" ? extUserId : null) ??
      updated.checkoutLink?.userId ??
      null;

    if (!beneficiaryUserId && mpPayerEmail) {
      const email = String(mpPayerEmail).trim().toLowerCase();
      const u = await tx.user.findFirst({ where: { email }, select: { id: true } });
      beneficiaryUserId = u?.id ?? null;
    }

    if (!beneficiaryUserId) {
      await tx.webhookLog.update({
        where: { id: log.id },
        data: { error: "NO_BENEFICIARY_USER", processedOk: true },
      });
      return;
    }

    // === 9.2 Pack + validaciones ===
    const packId = updated.checkoutLink?.packId ?? (extPackId || null);
    if (!packId) throw new Error("CHECKOUT_LINK_WITHOUT_PACK");

    const pack = await tx.pack.findUnique({ where: { id: packId } });
    if (!pack) throw new Error("PACK_NOT_FOUND");

    // En pruebas podrías querer relajar validaciones; aquí solo registramos el motivo y continuamos.
    if (typeof mpAmount === "number" && Number.isFinite(mpAmount) && mpAmount !== pack.price) {
      // No detenemos; solo anotar
      await tx.webhookLog.update({
        where: { id: log.id },
        data: { error: `AMOUNT_MISMATCH mp=${mpAmount} pack=${pack.price}` },
      });
    }
    if (mpCurrency && mpCurrency !== "MXN") {
      await tx.webhookLog.update({
        where: { id: log.id },
        data: { error: `CURRENCY_MISMATCH mp=${mpCurrency}` },
      });
    }

    // === 9.3 Crear PackPurchase + TokenLedger y cerrar link ===
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
      data: {
        userId: beneficiaryUserId,
        packPurchaseId: purchase.id,
        delta: pack.classes,
        reason: "PURCHASE_CREDIT",
      },
    });

    if (updated.checkoutLink) {
      await tx.checkoutLink.update({
        where: { id: updated.checkoutLink.id },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
    }

    await tx.webhookLog.update({
      where: { id: log.id },
      data: { processedOk: true, error: "CREDIT_OK" },
    });
  });

  // === 10) Si MP dijo refunded, revertir disponible no consumido ===
  if (["refunded"].includes((mpStatus || "").toLowerCase())) {
    await prisma.$transaction(async (tx) => {
      const p = await tx.payment.findUnique({
        where: { id: local!.id },
        include: { packPurchase: true },
      });
      const pp = p?.packPurchase;
      if (pp && pp.classesLeft > 0) {
        const undo = pp.classesLeft;
        await tx.packPurchase.update({
          where: { id: pp.id },
          data: { classesLeft: { decrement: undo } },
        });
        await tx.tokenLedger.create({
          data: {
            userId: pp.userId,
            packPurchaseId: pp.id,
            delta: -undo,
            reason: "CANCEL_REFUND",
          },
        });
      }
      const link = await tx.checkoutLink.findFirst({ where: { paymentId: local!.id } });
      if (link && link.status !== "COMPLETED") {
        await tx.checkoutLink.update({
          where: { id: link.id },
          data: { status: "CANCELED" },
        });
      }
    });
  }

  return j(200, { ok: true });
}
