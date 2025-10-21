// src/app/api/checkout-links/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { MercadoPagoConfig, Preference } from "mercadopago";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function j(status: number, body: any) {
  return NextResponse.json(body, { status });
}

// ───────────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────────
function isProdAccessToken(token: string | undefined): token is string {
  return !!token && /^APP_USR-/.test(token);
}

function redactToken(token?: string) {
  if (!token) return null;
  return token.slice(0, 10) + "...redacted";
}

function getBaseUrl(req: Request) {
  const env = process.env.APP_BASE_URL?.trim();
  const hdr =
    req.headers.get("x-forwarded-origin")?.trim() ||
    req.headers.get("origin")?.trim() ||
    "";
  let fromReq: string | undefined;
  try { fromReq = new URL(req.url).origin; } catch {}
  return env || hdr || fromReq || "";
}

function isHttpsPublic(url: string) {
  return /^https:\/\//i.test(url) && !/(localhost|127\.0\.0\.1)/i.test(url);
}

// detecta dominios productivos de MP (mx, ar, br, etc.)
function isProdInitPoint(url: string | undefined) {
  if (!url) return false;
  return /^https:\/\/www\.mercadopago\.com([a-z\.]*)?\/checkout\//i.test(url);
}

export async function POST(req: Request) {
  try {
    const { packId, userId } = await req.json();

    // ── Validaciones básicas
    if (!packId) return j(400, { error: "PACK_ID_REQUIRED" });

    const token = process.env.MP_ACCESS_TOKEN;
    if (!token) return j(500, { error: "MP_ACCESS_TOKEN_MISSING" });

    const pack = await prisma.pack.findUnique({ where: { id: packId } });
    if (!pack) return j(404, { error: "PACK_NOT_FOUND" });
    if (typeof pack.price !== "number" || pack.price <= 0) {
      return j(400, { error: "INVALID_PACK_PRICE", detail: pack.price });
    }

    // ── Base URL (forzamos dominio público HTTPS en prod)
    const baseUrl = getBaseUrl(req);
    if (!isHttpsPublic(baseUrl)) {
      return j(400, {
        error: "INVALID_BASE_URL_FOR_PRODUCTION",
        detail: "Configura APP_BASE_URL con tu dominio HTTPS público.",
        got: baseUrl || null,
      });
    }

    // ── Chequeos de credenciales/entorno
    const allowSandbox = process.env.ALLOW_SANDBOX === "1";
    if (!allowSandbox && !isProdAccessToken(token)) {
      return j(409, {
        error: "NON_PROD_TOKEN",
        detail: "El access token no es de producción (debe comenzar con APP_USR-).",
        hint: "Coloca el access token de producción en MP_ACCESS_TOKEN (no la public key).",
        observed: redactToken(token),
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

    // ── Mercado Pago
    const client = new MercadoPagoConfig({ accessToken: token });
    const preference = new Preference(client);

    // external_reference ÚNICO y no vacío (requisito de MP)
    const externalRef = [
      userId ?? "anon",
      packId,
      payment.id,
      crypto.randomUUID(),
    ].join("|");

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
      external_reference: externalRef, // ✅ obligatorio
      metadata: {
        userId: userId ?? null,
        packId,
        paymentId: payment.id,
        checkoutLinkId: link.id,
      },
      notification_url: `${baseUrl}/api/webhooks/mercadopago`,
      auto_return: "approved",
      // ⚠️ NO incluir payment_methods con { id: "" } ni arrays vacíos si no necesitas exclusiones
    };

    // Log inocuo
    console.log("MP Preference.create →", {
      token: redactToken(token),
      baseUrl,
      back_urls: prefBody.back_urls,
      notification_url: prefBody.notification_url,
      has_external_reference: !!prefBody.external_reference,
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

      // Clasificación de errores comunes
      const isInvalidToken =
        detail?.error === "bad_request" &&
        (detail?.cause?.some?.((c: any) => /invalid_token/i.test(c?.code || c?.description || "")) ||
         /invalid_token/i.test(String(detail?.message)));

      const code = isInvalidToken ? 401 : 502;
      const error =
        isInvalidToken ? "MP_INVALID_ACCESS_TOKEN" : "MP_PREFERENCE_CREATE_FAILED";

      console.error("MP preference.create error:", detail);
      return j(code, {
        error,
        detail,
        sent: { back_urls: prefBody.back_urls, external_reference: !!prefBody.external_reference },
        hints: isInvalidToken
          ? [
              "Verifica que MP_ACCESS_TOKEN sea el de producción (APP_USR-...) y no esté expirado/revocado.",
              "En el panel de Mercado Pago, regenera credenciales si es necesario.",
            ]
          : [
              "Revisa si tu cuenta está habilitada para cobrar en producción (verificación/KYC y datos de cobro).",
              "Valida que los montos/moneda sean válidos para tu país.",
            ],
      });
    }

    // ── Validaciones de respuesta MP
    const liveMode = Boolean(pref?.live_mode);
    const initPoint: string | undefined = pref?.init_point;
    const sandboxInit: string | undefined = pref?.sandbox_init_point;

    const hasInitPoint = typeof initPoint === "string" && initPoint.length > 0;
    const hasSandboxInit = typeof sandboxInit === "string" && sandboxInit.length > 0;
    const initPointIsProd = isProdInitPoint(initPoint);

    // Modo estricto: solo bloqueo si NO es live y además NO hay init_point productivo
    if (!allowSandbox && !liveMode && !initPointIsProd) {
      console.error("Preference no productiva en modo estricto:", {
        prefId: pref?.id,
        liveMode,
        init_point: initPoint,
        sandbox_init_point: sandboxInit,
      });
      return j(409, {
        error: "PREFERENCE_NOT_LIVE",
        detail:
          "Mercado Pago devolvió la preferencia en modo prueba y sin link productivo. Verifica token/cuenta.",
        prefId: pref?.id ?? null,
        observed: {
          live_mode: pref?.live_mode,
          has_init_point: hasInitPoint,
          has_sandbox_init_point: hasSandboxInit,
        },
        hints: [
          "Usa access token APP_USR- de la cuenta cobradora.",
          "Completa verificación/KYC y datos de cobro si faltan.",
        ],
      });
    }

    if (!hasInitPoint) {
      console.error("Preference sin init_point utilizable:", {
        prefId: pref?.id,
        liveMode,
        hasSandboxInit,
        prefKeys: Object.keys(pref || {}),
      });
      return j(500, {
        error: "PREFERENCE_WITHOUT_INIT_POINT",
        detail: "La preferencia no trajo init_point en la respuesta.",
        prefId: pref?.id ?? null,
      });
    }

    // ── Persistencia
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        mpPreferenceId: pref?.id ?? null,
        mpInitPoint: initPoint!,
        mpExternalRef: externalRef,
        mpRaw: pref as any,
      },
    });

    await prisma.checkoutLink.update({
      where: { id: link.id },
      data: { paymentId: payment.id, status: "OPEN" },
    });

    return j(200, { checkoutUrl: initPoint!, code: link.code });
  } catch (e: any) {
    console.error("CHECKOUT_LINKS_POST_FATAL:", e);
    return j(500, { error: "INTERNAL_ERROR", detail: e?.message ?? String(e) });
  }
}
