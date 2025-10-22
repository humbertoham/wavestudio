// src/app/api/webhooks/mercadopago/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { MercadoPagoConfig, Payment as MPPayment, MerchantOrder } from "mercadopago";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function j(status: number, body: any) {
  return NextResponse.json(body, { status });
}

function safeJson<T = any>(raw: string): T {
  try {
    return raw ? JSON.parse(raw) : ({} as T);
  } catch {
    return {} as T;
  }
}

function mapStatus(s?: string) {
  switch ((s || "").toLowerCase()) {
    case "approved": return "APPROVED";
    case "rejected": return "REJECTED";
    case "cancelled": return "CANCELED";
    case "refunded": return "REFUNDED";
    default: return "PENDING";
  }
}

export async function POST(req: Request) {
  // === 0) raw body + parsed ===
  const raw = await req.text();
  const payload = safeJson(raw);
  const url = new URL(req.url);

  const qType = url.searchParams.get("type") || url.searchParams.get("topic");
  const qId = url.searchParams.get("id");

  // === 1) deliveryId para tracking (no dedupe) ===
  const deliveryId =
    qId ||
    payload?.id?.toString() ||
    payload?.data?.id?.toString() ||
    payload?.resource?.toString() ||
    null;

  // === 2) Crear log inicial (siempre) ===
  let log = await prisma.webhookLog.create({
    data: {
      provider: "MERCADOPAGO",
      eventType: payload?.type || payload?.action || qType || "unknown",
      deliveryId,
      payload,
    },
  });

  // === NOTE: este webhook UNLICENSED-SIGNATURE (no valida secret) ===
  // Lo hacemos intencionalmente para pruebas: procesaremos *consultando a MP*
  // y solo acreditaremos si MP confirma el pago approved.

  // === 3) Asegurar MP_ACCESS_TOKEN ===
  const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
  if (!ACCESS_TOKEN) {
    await prisma.webhookLog.update({
      where: { id: log.id },
      data: { processedOk: false, error: "MP_ACCESS_TOKEN_MISSING" },
    });
    return j(200, { ok: true });
  }
  const client = new MercadoPagoConfig({ accessToken: ACCESS_TOKEN });

  // === 4) Resolver paymentId (payment / merchant_order / resource) ===
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
      } catch {
        // sigue adelante
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

  // === 5) Consultar el pago en MP (estado más reciente) ===
  let mp: any;
  try {
    mp = await new MPPayment(client).get({ id: paymentId });
  } catch (e) {
    await prisma.webhookLog.update({
      where: { id: log.id },
      data: { processedOk: false, error: "MP_PAYMENT_GET_FAILED" },
    });
    return j(200, { ok: true });
  }

  const mpStatus = mp?.status;
  const mpStatusDetail = mp?.status_detail;
  const mpExtRef = mp?.external_reference ?? payload?.data?.external_reference;
  const mpPrefId = mp?.preference_id ?? payload?.data?.preference_id ?? prefIdFromMO;
  const mpCurrency = mp?.currency_id;
  const mpAmount = typeof mp?.transaction_amount === "number" ? mp.transaction_amount : Number(mp?.transaction_amount);
  const mpPayerEmail = mp?.payer?.email;

  const [extUserId, extPackId, hintedPaymentId] = (mpExtRef ?? "").split("|");

  // === 6) Buscar Payment local por varias llaves ===
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

  // === 7) Procesar siempre el estado más reciente (idempotente) ===
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

      // Si no está aprobado, solo marcamos y salimos
      if (newStatus !== "APPROVED") {
        if (["REJECTED", "CANCELED", "REFUNDED"].includes(newStatus) && updated.checkoutLink && updated.checkoutLink.status !== "COMPLETED") {
          await tx.checkoutLink.update({ where: { id: updated.checkoutLink.id }, data: { status: "CANCELED" } });
        }
        await tx.webhookLog.update({ where: { id: log.id }, data: { processedOk: true, error: `NO_CREDIT_STATUS_${newStatus}` } });
        return;
      }

      // Si ya se acreditó: idempotencia
      if (updated.packPurchase) {
        if (updated.checkoutLink && updated.checkoutLink.status !== "COMPLETED") {
          await tx.checkoutLink.update({ where: { id: updated.checkoutLink.id }, data: { status: "COMPLETED", completedAt: new Date() } });
        }
        await tx.webhookLog.update({ where: { id: log.id }, data: { processedOk: true, error: "ALREADY_CREDITED" } });
        return;
      }

      // Resolver beneficiario (extUserId | checkoutLink.userId | mp.payer.email)
      let beneficiaryUserId: string | null =
        (extUserId && extUserId !== "anon" ? extUserId : null) ??
        updated.checkoutLink?.userId ?? null;

      if (!beneficiaryUserId && mpPayerEmail) {
        const email = String(mpPayerEmail).trim().toLowerCase();
        const u = await tx.user.upsert({
          where: { email },
          update: {},
          create: { name: email.split("@")[0], email, passwordHash: "TEMP-AUTO" },
          select: { id: true },
        });
        beneficiaryUserId = u.id;
        await tx.webhookLog.update({ where: { id: log.id }, data: { error: "AUTO_CREATED_USER_FOR_PAYER_EMAIL" } });
      }

      if (!beneficiaryUserId) {
        await tx.webhookLog.update({ where: { id: log.id }, data: { processedOk: true, error: "NO_BENEFICIARY_USER" } });
        return;
      }

      // Determinar pack
      const packId = updated.checkoutLink?.packId ?? (extPackId || null);
      if (!packId) throw new Error("CHECKOUT_LINK_WITHOUT_PACK");

      const pack = await tx.pack.findUnique({ where: { id: packId } });
      if (!pack) throw new Error("PACK_NOT_FOUND");

      // En modo pruebas no bloqueamos por mismatches de monto; solo anotamos
      if (typeof mpAmount === "number" && Number.isFinite(mpAmount) && mpAmount !== pack.price) {
        await tx.webhookLog.update({ where: { id: log.id }, data: { error: `AMOUNT_MISMATCH mp=${mpAmount} pack=${pack.price}` } });
      }
      if (mpCurrency && mpCurrency !== "MXN") {
        await tx.webhookLog.update({ where: { id: log.id }, data: { error: `CURRENCY_MISMATCH mp=${mpCurrency}` } });
      }

      // Crear PackPurchase + TokenLedger
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

  // If MP later refunds, revert (same behavior as your previous logic)
  if ((mpStatus || "").toLowerCase() === "refunded") {
    await prisma.$transaction(async (tx) => {
      const p = await tx.payment.findUnique({ where: { id: local!.id }, include: { packPurchase: true } });
      const pp = p?.packPurchase;
      if (pp && pp.classesLeft > 0) {
        const undo = pp.classesLeft;
        await tx.packPurchase.update({ where: { id: pp.id }, data: { classesLeft: { decrement: undo } } });
        await tx.tokenLedger.create({
          data: { userId: pp.userId, packPurchaseId: pp.id, delta: -undo, reason: "CANCEL_REFUND" },
        });
      }
      const link = await tx.checkoutLink.findFirst({ where: { paymentId: local!.id } });
      if (link && link.status !== "COMPLETED") {
        await tx.checkoutLink.update({ where: { id: link.id }, data: { status: "CANCELED" } });
      }
    });
  }

  return j(200, { ok: true });
}
