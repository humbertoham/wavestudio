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
  const hdr = req.headers.get("x-forwarded-origin")?.trim() || req.headers.get("origin")?.trim() || "";
  let fromReq: string | undefined;
  try { fromReq = new URL(req.url).origin; } catch {}
  return env || hdr || fromReq || "";
}

function isHttpsPublic(url: string) {
  return /^https:\/\//i.test(url) && !/(localhost|127\.0\.0\.1)/i.test(url);
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
      notification_url: `${baseUrl}/api/webhooks/mercadopago`,
      auto_return: "approved",
    };

    // Log “inocuo” de lo que envías
    console.log("MP Preference.create →", {
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
        sent: { back_urls: prefBody.back_urls },
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
    const hasInitPoint = typeof pref?.init_point === "string" && pref.init_point.length > 0;
    const hasSandboxInit = typeof pref?.sandbox_init_point === "string" && pref.sandbox_init_point.length > 0;

    // Si no permitimos sandbox, exigimos live_mode true
    if (!allowSandbox && !liveMode) {
      console.error("Preference SANDBOX estando en modo estricto:", {
        prefId: pref?.id,
        liveMode,
        init_point: hasInitPoint,
        sandbox_init_point: hasSandboxInit,
      });
      return j(409, {
        error: "PREFERENCE_NOT_LIVE",
        detail:
          "Mercado Pago devolvió la preferencia en modo PRUEBA. Usa un access token APP_USR- y asegúrate de que tu cuenta esté habilitada en producción.",
        prefId: pref?.id ?? null,
        observed: { live_mode: pref?.live_mode, has_init_point: hasInitPoint, has_sandbox_init_point: hasSandboxInit },
        hints: [
          "En MP → Credenciales: habilita Modo Producción y completa verificación.",
          "Asegúrate de no estar usando un usuario de prueba como cobrador.",
        ],
      });
    }

    if (!hasInitPoint) {
      // En sandbox suele venir sandbox_init_point; en prod debe venir init_point
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
        mpInitPoint: pref.init_point,
        mpExternalRef: externalRef,
        mpRaw: pref as any,
      },
    });

    await prisma.checkoutLink.update({
      where: { id: link.id },
      data: { paymentId: payment.id, status: "OPEN" },
    });

    return j(200, { checkoutUrl: pref.init_point, code: link.code });
  } catch (e: any) {
    console.error("CHECKOUT_LINKS_POST_FATAL:", e);
    return j(500, { error: "INTERNAL_ERROR", detail: e?.message ?? String(e) });
  }
}
