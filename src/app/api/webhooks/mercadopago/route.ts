// src/app/api/webhooks/mercadopago/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { MercadoPagoConfig, Payment, MerchantOrder } from "mercadopago";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function j(status: number, body: any) {
  return NextResponse.json(body, { status });
}

export async function POST(req: Request) {
  // Lee payload (MP puede mandar varios formatos)
  const payload = await req.json().catch(() => ({} as any));

  // Parámetros de la URL (MP a veces envía ?type=payment&id=123)
  const url = new URL(req.url);
  const qType = url.searchParams.get("type") || url.searchParams.get("topic");
  const qId = url.searchParams.get("id");

  // Guarda log básico (si se repite deliveryId, igual respondemos 200)
  const deliveryId =
    payload?.id?.toString() ||
    payload?.data?.id?.toString() ||
    payload?.resource?.toString() ||
    qId ||
    null;

  const log = await prisma.webhookLog.create({
    data: {
      provider: "MERCADOPAGO",
      eventType:
        payload?.type ||
        payload?.action ||
        qType ||
        "unknown",
      deliveryId,
      payload,
    },
  });

  try {
    if (!process.env.MP_ACCESS_TOKEN) {
      await prisma.webhookLog.update({
        where: { id: log.id },
        data: { processedOk: false, error: "MP_ACCESS_TOKEN_MISSING" },
      });
      // No 5xx para no forzar reintentos infinitos
      return j(200, { ok: true });
    }

    const client = new MercadoPagoConfig({
      accessToken: process.env.MP_ACCESS_TOKEN!,
    });

    // --- 1) Resolver el payment_id real desde varios formatos ---
    // a) Notificación "payment"
    let paymentId: string | undefined =
      qType === "payment"
        ? qId ?? payload?.data?.id?.toString() ?? payload?.id?.toString()
        : undefined;

    // b) Notificación "merchant_order": obtener el merchant_order e inferir el payment_id principal
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
          // toma el primer pago aprobado, si existe
          const approvedPay = (mo as any)?.payments?.find((p: any) => p?.status === "approved");
          if (approvedPay?.id) {
            paymentId = approvedPay.id.toString();
          }
        } catch (e) {
          // si falla, seguimos sin romper el webhook
        }
      }
    }

    // c) Último intento: algunos envíos mandan payload.resource ".../payments/{id}"
    if (!paymentId && typeof payload?.resource === "string") {
      paymentId = payload.resource.split("/").pop();
    }

    if (!paymentId) {
      // No hay nada procesable; marca OK para evitar reintentos eternos.
      await prisma.webhookLog.update({
        where: { id: log.id },
        data: { processedOk: true },
      });
      return j(200, { ok: true });
    }

    // --- 2) Consultar el pago en MP para validar estado y referencias ---
    let mpPayment: any;
    try {
      mpPayment = await new Payment(client).get({ id: paymentId });
    } catch (e: any) {
      // No pudimos obtener el pago → no bloquees reintentos
      await prisma.webhookLog.update({
        where: { id: log.id },
        data: { processedOk: false, error: "MP_PAYMENT_GET_FAILED" },
      });
      return j(200, { ok: true });
    }

    const mpStatus: string | undefined = mpPayment?.status; // 'approved' | 'rejected' | ...
    const mpExtRef: string | undefined = mpPayment?.external_reference ?? payload?.data?.external_reference;
    const mpPrefId: string | undefined =
      mpPayment?.preference_id ?? payload?.data?.preference_id ?? preferenceIdFromMO;

    // --- 3) Buscar nuestro Payment local ---
    let local = await prisma.payment.findFirst({
      where: {
        OR: [
          { mpPaymentId: paymentId },
          { mpPreferenceId: mpPrefId ?? undefined },
          { mpExternalRef: mpExtRef ?? undefined },
        ],
      },
      include: { checkoutLink: true, packPurchase: true },
    });

    // Si no existe, intenta por paymentId incrustado en external_reference
    if (!local && mpExtRef) {
      const parts = mpExtRef.split("|"); // userId|packId|paymentId|nonce
      const hintedPaymentId = parts[2];
      if (hintedPaymentId) {
        local = await prisma.payment.findUnique({
          where: { id: hintedPaymentId },
          include: { checkoutLink: true, packPurchase: true },
        });
      }
    }

    if (!local) {
      // No bloquees el webhook si no encuentras el pago local; deja log y 200
      await prisma.webhookLog.update({
        where: { id: log.id },
        data: { processedOk: true, error: "LOCAL_PAYMENT_NOT_FOUND" },
      });
      return j(200, { ok: true });
    }

    // --- 4) Actualiza estado local según MP ---
    // Mapa simple de estados
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

    // --- 5) Idempotencia + emisión de créditos ---
    await prisma.$transaction(async (tx) => {
      const updated = await tx.payment.update({
        where: { id: local!.id },
        data: {
          status: mapStatus(mpStatus),
          mpPaymentId: paymentId,
          mpPreferenceId: mpPrefId ?? local!.mpPreferenceId,
          mpExternalRef: mpExtRef ?? local!.mpExternalRef,
          mpPayerEmail: mpPayment?.payer?.email ?? local!.mpPayerEmail,
          mpRaw: mpPayment,
        },
        include: { checkoutLink: true, packPurchase: true },
      });

      if (updated.status !== "APPROVED") {
        return; // si no está aprobado, no acredites
      }

      // Si ya tiene PackPurchase, no hagas nada (idempotente)
      if (updated.packPurchase) {
        return;
      }

      // Resolver a quién acreditar
      // 1) userId desde el CheckoutLink (link personal)
      let beneficiaryUserId = updated.checkoutLink?.userId ?? null;

      // 2) si no viene userId, intenta por email del payer
      if (!beneficiaryUserId && updated.mpPayerEmail) {
        const u = await tx.user.findFirst({
          where: { email: updated.mpPayerEmail },
          select: { id: true },
        });
        beneficiaryUserId = u?.id ?? null;
      }

      if (!beneficiaryUserId) {
        // No encontramos usuario; no acreditamos pero no fallamos el webhook.
        // Podrías crear un PendingCredit aquí si implementaste ese modelo.
        return;
      }

      // Necesitamos el packId desde el CheckoutLink
      if (!updated.checkoutLink?.packId) {
        throw new Error("CHECKOUT_LINK_WITHOUT_PACK");
      }

      const pack = await tx.pack.findUnique({ where: { id: updated.checkoutLink.packId } });
      if (!pack) throw new Error("PACK_NOT_FOUND");

      // Crea PackPurchase + TokenLedger
      const purchase = await tx.packPurchase.create({
        data: {
          userId: beneficiaryUserId,
          packId: pack.id,
          classesLeft: pack.classes,
          expiresAt: new Date(Date.now() + pack.validityDays * 24 * 60 * 60 * 1000),
          paymentId: updated.id, // usa FK escalar por tipado
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

      await tx.checkoutLink.update({
        where: { id: updated.checkoutLink.id },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
    });

    await prisma.webhookLog.update({
      where: { id: log.id },
      data: { processedOk: true },
    });

    // Siempre responde 200 a MP
    return j(200, { ok: true });
  } catch (e: any) {
    // Nunca devolvemos 5xx a MP; solo marcamos el log con error y 200
    await prisma.webhookLog.update({
      where: { id: log.id },
      data: { processedOk: false, error: String(e?.message ?? e) },
    });
    return j(200, { ok: true });
  }
}
