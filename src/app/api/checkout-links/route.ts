// src/app/api/checkout-links/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { MercadoPagoConfig, Preference } from "mercadopago";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function j(status: number, body: any) {
  return NextResponse.json(body, { status });
}

export async function POST(req: Request) {
  try {
    const { packId, userId } = await req.json();

    // ── Validaciones básicas
    if (!packId) return j(400, { error: "PACK_ID_REQUIRED" });
    if (!process.env.MP_ACCESS_TOKEN) return j(500, { error: "MP_ACCESS_TOKEN_MISSING" });

    const pack = await prisma.pack.findUnique({ where: { id: packId } });
    if (!pack) return j(404, { error: "PACK_NOT_FOUND" });
    if (typeof pack.price !== "number" || pack.price <= 0) {
      return j(400, { error: "INVALID_PACK_PRICE", detail: pack.price });
    }

    // ── Base URL (obligamos a prod: https y no localhost)
    const reqOrigin = (() => {
      try { return new URL(req.url).origin; } catch { return undefined; }
    })();
    const baseUrl =
      process.env.APP_BASE_URL?.trim() ||
      req.headers.get("x-forwarded-origin")?.trim() ||
      reqOrigin ||
      "";

    if (!/^https:\/\//i.test(baseUrl) || /(localhost|127\.0\.0\.1)/i.test(baseUrl)) {
      return j(400, {
        error: "INVALID_BASE_URL_FOR_PRODUCTION",
        detail: "Configura APP_BASE_URL con tu dominio HTTPS público.",
        got: baseUrl || null,
      });
    }

    const backUrls = {
      success: `${baseUrl}/pago/success`,
      failure: `${baseUrl}/pago/failure`,
      pending: `${baseUrl}/pago/pending`,
    };

    // ── Registros locales
    const link = await prisma.checkoutLink.create({
      data: {
        code: crypto.randomUUID().slice(0, 8),
        status: "CREATED",
        packId,
        userId: userId ?? null,
        successUrl: backUrls.success,
        failureUrl: backUrls.failure,
        pendingUrl: backUrls.pending,
      },
    });

    const payment = await prisma.payment.create({
      data: {
        provider: "MERCADOPAGO",
        status: "PENDING",
        amount: pack.price,
        currency: "MXN",
        userId: userId ?? null,
        checkoutLink: { connect: { id: link.id } },
      },
    });

    // ── Mercado Pago (siempre producción)
    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN! });
    const preference = new Preference(client);
    const externalRef = `${userId ?? "anon"}|${packId}|${payment.id}|${crypto.randomUUID()}`;

    const prefBody: any = {
      items: [
        {
          id: pack.id,
          title: pack.name,
          quantity: 1,
          unit_price: pack.price,
          currency_id: "MXN",
          description: pack.classesLabel ?? undefined,
        },
      ],
      back_urls: backUrls,
      external_reference: externalRef,
      metadata: {
        userId: userId ?? null,
        packId,
        paymentId: payment.id,
        checkoutLinkId: link.id,
      },
      // Siempre webhook en prod
      notification_url: `${baseUrl}/api/webhooks/mercadopago`,
      auto_return: "approved", // opcional en prod
    };

    console.log("Creating MP Preference with:", {
      back_urls: prefBody.back_urls,
      notification_url: prefBody.notification_url,
      baseUrl,
    });

    let pref: any;
    try {
      pref = await preference.create({ body: prefBody });
    } catch (mpErr: any) {
      const detail = {
        message: mpErr?.message,
        status: mpErr?.status,
        cause: mpErr?.cause,
        error: mpErr?.error,
      };
      console.error("MP preference.create error:", detail);
      return j(502, { error: "MP_PREFERENCE_CREATE_FAILED", detail, sent: { back_urls: prefBody.back_urls } });
    }

    // ── Forzar producción: live_mode debe ser true y usamos init_point
    const liveMode = Boolean(pref?.live_mode);
    if (!liveMode) {
      console.error("Preference returned in SANDBOX while forcing PROD:", { prefId: pref?.id, liveMode });
      return j(409, {
        error: "PREFERENCE_NOT_LIVE",
        detail: "La preferencia no está en modo productivo. Verifica que el access token sea de producción.",
        prefId: pref?.id ?? null,
      });
    }

    const initPoint: string | undefined = pref?.init_point;
    if (!initPoint) {
      console.error("Preference sin init_point (prod):", pref);
      return j(500, { error: "PREFERENCE_WITHOUT_INIT_POINT" });
    }

    // ── Persistir datos de MP y abrir link
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        mpPreferenceId: pref?.id ?? null,
        mpInitPoint: initPoint,
        mpExternalRef: externalRef,
        mpRaw: pref as any,
      },
    });

    await prisma.checkoutLink.update({
      where: { id: link.id },
      data: { paymentId: payment.id, status: "OPEN" },
    });

    return j(200, { checkoutUrl: initPoint, code: link.code });
  } catch (e: any) {
    console.error("CHECKOUT_LINKS_POST_FATAL:", e);
    return j(500, { error: "INTERNAL_ERROR", detail: e?.message ?? String(e) });
  }
}
