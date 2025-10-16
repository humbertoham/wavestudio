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

export async function POST(req: Request) {
  // === 0) Raw body + firma (si hay secreto) ===
  const raw = await req.text();
  const payload = safeJson(raw);

  const url = new URL(req.url);
  const qType = url.searchParams.get("type") || url.searchParams.get("topic");
  const qId = url.searchParams.get("id");

  // Firma: soporta varios headers comunes
  const secret = process.env.MP_WEBHOOK_SECRET?.trim();
  const sigHeader =
    req.headers.get("x-signature") ||
    req.headers.get("x-hub-signature-256") ||
    req.headers.get("x-mercadopago-signature") ||
    null;

  if (secret && sigHeader) {
    try {
      const expected = await hmacSha256Hex(secret, raw);
      const got = sigHeader.replace(/^sha256=/i, "").toLowerCase();
      if (got !== expected) {
        // Firma inválida → no procesamos, pero respondemos 200 para no reintentar
        return j(200, { ok: true, ignored: true, reason: "INVALID_SIGNATURE" });
      }
    } catch {
      // Si algo falla calculando firma, ignora procesamiento
      return j(200, { ok: true, ignored: true, reason: "SIGNATURE_CHECK_ERROR" });
    }
  }
  // Si no hay secreto configurado o no viene header, seguimos normal.

  // === 1) deliveryId (para dedupe de entrada) ===
  const deliveryId =
    payload?.id?.toString() ||
    payload?.data?.id?.toString() ||
    payload?.resource?.toString() ||
    qId ||
    null;

  // Dedupe rápido por deliveryId si ya lo vimos
  if (deliveryId) {
    const exists = await prisma.webhookLog.findFirst({
      where: { provider: "MERCADOPAGO", deliveryId },
      select: { id: true, processedOk: true },
    });
    if (exists?.processedOk) {
      return j(200, { ok: true, deduped: true });
    }
  }

  // Creamos log
  let log = await prisma.webhookLog.create({
    data: {
      provider: "MERCADOPAGO",
      eventType: payload?.type || payload?.action || qType || "unknown",
      deliveryId,
      payload, // Considera redactar PII si lo necesitas
    },
  });

  try {
    if (!process.env.MP_ACCESS_TOKEN) {
      await prisma.webhookLog.update({
        where: { id: log.id },
        data: { processedOk: false, error: "MP_ACCESS_TOKEN_MISSING" },
      });
      return j(200, { ok: true });
    }

    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN! });

    // === 2) Resolver paymentId ===
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
          // ignoramos, seguimos con otras rutas
        }
      }
    }

    if (!paymentId && typeof payload?.resource === "string") {
      paymentId = payload.resource.split("/").pop();
    }

    if (!paymentId) {
      await prisma.webhookLog.update({
        where: { id: log.id },
        data: { processedOk: true },
      });
      return j(200, { ok: true });
    }

    // === 3) Consultar MP Payment ===
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
    const mpPrefId: string | undefined = mp?.preference_id ?? payload?.data?.preference_id ?? preferenceIdFromMO;
    const mpCurrency: string | undefined = mp?.currency_id;
    const mpAmount: number | undefined = typeof mp?.transaction_amount === "number" ? mp.transaction_amount : Number(mp?.transaction_amount);
    const mpPayerEmail: string | undefined = mp?.payer?.email;

    // Parse de external_reference (userId|packId|paymentId|nonce)
    const [extUserId, extPackId, hintedPaymentId] = (mpExtRef ?? "").split("|");

    // === 4) Ubicar Payment local (prioridad: mpPaymentId > mpPreferenceId > mpExternalRef > hintedPaymentId) ===
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

    // === 5) Mapear estado ===
    const mapStatus = (s?: string) => {
      switch (s) {
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

    // === 6) Transacción: actualizar y acreditar si corresponde ===
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

      // Cerrar/cambiar estado del CheckoutLink según resultado no exitoso
      if (["REJECTED", "CANCELED", "REFUNDED"].includes(newStatus)) {
        if (updated.checkoutLink && updated.checkoutLink.status !== "COMPLETED") {
          await tx.checkoutLink.update({
            where: { id: updated.checkoutLink.id },
            data: { status: "CANCELED" },
          });
        }
      }

      // Si no está aprobado, no acredites
      if (newStatus !== "APPROVED") return;

      // Idempotencia: si ya hay PackPurchase, salimos
      if (updated.packPurchase) {
        // Si no estaba completo, márcalo completo ahora
        if (updated.checkoutLink && updated.checkoutLink.status !== "COMPLETED") {
          await tx.checkoutLink.update({
            where: { id: updated.checkoutLink.id },
            data: { status: "COMPLETED", completedAt: new Date() },
          });
        }
        return;
      }

      // === 6.1 Resolver beneficiario ===
      let beneficiaryUserId: string | null =
        (extUserId && extUserId !== "anon" ? extUserId : null) ??
        updated.checkoutLink?.userId ??
        null;

      if (!beneficiaryUserId && mpPayerEmail) {
        const u = await tx.user.findFirst({ where: { email: mpPayerEmail }, select: { id: true } });
        beneficiaryUserId = u?.id ?? null;
      }
      if (!beneficiaryUserId) {
        // No se puede acreditar: deja todo consistente y sal
        return;
      }

      // === 6.2 Determinar Pack y validar monto/moneda ===
      const packId = updated.checkoutLink?.packId ?? (extPackId || null);
      if (!packId) throw new Error("CHECKOUT_LINK_WITHOUT_PACK");

      const pack = await tx.pack.findUnique({ where: { id: packId } });
      if (!pack) throw new Error("PACK_NOT_FOUND");

      // Validación anti-discrepancias
      if (typeof mpAmount === "number" && Number.isFinite(mpAmount)) {
        if (mpAmount !== pack.price) {
          // Si no coincide, no acredites (queda pendiente para revisión)
          await tx.payment.update({
            where: { id: updated.id },
            data: { status: "PENDING" as any },
          });
          return;
        }
      }
      if (mpCurrency && mpCurrency !== "MXN") {
        await tx.payment.update({
          where: { id: updated.id },
          data: { status: "PENDING" as any },
        });
        return;
      }

      // === 6.3 Crear PackPurchase + TokenLedger y cerrar link ===
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
    });

    // === 7) Si es REFUNDED, revertir saldo disponible (no consumido) ===
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
        // Marcar link como cancelado si no estaba completo
        const link = await tx.checkoutLink.findFirst({ where: { paymentId: local!.id } });
        if (link && link.status !== "COMPLETED") {
          await tx.checkoutLink.update({
            where: { id: link.id },
            data: { status: "CANCELED" },
          });
        }
      });
    }

    await prisma.webhookLog.update({
      where: { id: log.id },
      data: {
        processedOk: true,
        // útil para soporte/conciliación
        error: mpStatus ? `mp.status=${mpStatus} detail=${mpStatusDetail ?? ""}` : null,
      },
    });

    return j(200, { ok: true });
  } catch (e: any) {
    await prisma.webhookLog.update({
      where: { id: log.id },
      data: { processedOk: false, error: String(e?.message ?? e) },
    });
    // Siempre 200 para no ciclar reintentos
    return j(200, { ok: true });
  }
}
