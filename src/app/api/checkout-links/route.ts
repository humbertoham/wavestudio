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

    // ── Base URL robusta (env > header > origin de la request > fallback)
    const reqOrigin = (() => {
      try { return new URL(req.url).origin; } catch { return undefined; }
    })();
    const baseUrl =
      process.env.APP_BASE_URL?.trim() ||
      req.headers.get("x-forwarded-origin")?.trim() ||
      reqOrigin ||
      "http://localhost:3000";

    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(baseUrl);

    // ── Siempre definimos back_urls válidas
    const backUrls = {
      success: `${baseUrl}/pago/success`,
      failure: `${baseUrl}/pago/failure`,
      pending: `${baseUrl}/pago/pending`,
    };
    for (const [k, v] of Object.entries(backUrls)) {
      if (!v || !/^https?:\/\//i.test(v)) {
        return j(400, { error: "INVALID_BACK_URL", key: k, value: v, baseUrl });
      }
    }

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

    // ── Mercado Pago: crear Preference real (sin auto_return para evitar error)
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
      // Evitar webhook en localhost (MP suele rechazar localhost en sandbox)
      ...(isLocal ? {} : { notification_url: `${baseUrl}/api/webhooks/mercadopago` }),
    };

    console.log("Creating MP Preference with:", {
      back_urls: prefBody.back_urls,
      notification_url: prefBody.notification_url,
      baseUrl,
    });

    let pref;
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

    const initPoint = (pref as any).init_point || (pref as any).sandbox_init_point;
    if (!initPoint) {
      console.error("Preference sin init_point:", pref);
      return j(500, { error: "PREFERENCE_WITHOUT_INIT_POINT" });
    }

    // ── Persistir datos de MP y abrir link
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        mpPreferenceId: (pref as any).id ?? null,
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
