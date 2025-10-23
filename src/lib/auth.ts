// lib/auth.ts
import { cookies as nextCookies } from "next/headers";
import type { NextRequest } from "next/server";
import { verifyToken, type JWTPayload } from "./jwt";

/**
 * Este archivo funciona en:
 *  - RSC/SSR (Node, usando cookies() de next/headers)
 *  - Edge/Route Handlers (leyendo cookies desde NextRequest o headers de Request)
 *  - Con fallback de DEV: header x-user-id o query ?userId=
 *
 * Modelo de payload esperado por tu JWT:
 * interface JWTPayload {
 *   sub: string;       // user id
 *   role: "USER" | "ADMIN";
 *   email?: string;
 *   // ...otros campos que firmes
 * }
 */

type AnyReq = NextRequest | Request | undefined | null;

// ───────────────────────────────────────────────────────────────────────────────
// Lectura de cookies de forma segura en Node/Edge
// ───────────────────────────────────────────────────────────────────────────────

async function readCookieUniversal(
  name: string,
  req?: AnyReq
): Promise<string | null> {
  // 1) Si tenemos NextRequest (Edge/route handler), usar sus cookies
  if (req && "cookies" in req && typeof (req as any).cookies?.get === "function") {
    try {
      // NextRequest.cookies.get(name)?.value
      // En Next 14 puede venir como { name, value }
      // @ts-ignore - tipos flexibles
      return (req as NextRequest).cookies.get(name)?.value ?? null;
    } catch {
      /* no-op */
    }
  }

  // 2) Si tenemos un Request plano (no NextRequest), leer desde headers "cookie"
  if (req instanceof Request && !(req as any).cookies) {
    const raw = req.headers.get("cookie") ?? "";
    const parsed = Object.fromEntries(
      raw.split(";").map((p) => {
        const i = p.indexOf("=");
        if (i === -1) return [p.trim(), ""];
        const k = p.slice(0, i).trim();
        const v = decodeURIComponent(p.slice(i + 1));
        return [k, v];
      })
    );
    return parsed[name] ?? null;
  }

  // 3) Contexto Node/RSC: usar cookies() de next/headers (puede ser sync o thenable)
  try {
    const c: any = nextCookies(); // thenable en edge, objeto en node
    const store = typeof c?.then === "function" ? await c : c;
    return store?.get?.(name)?.value ?? null;
  } catch {
    return null;
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// Lectura de Authorization: Bearer <token>
// ───────────────────────────────────────────────────────────────────────────────
function readBearer(req?: AnyReq): string | null {
  if (!req) return null;
  const h = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m?.[1] ?? null;
}

// ───────────────────────────────────────────────────────────────────────────────
// Parseo/Verificación de token
// ───────────────────────────────────────────────────────────────────────────────
function safeVerify(token: string | null | undefined): JWTPayload | null {
  if (!token) return null;
  try {
    return verifyToken(token);
  } catch {
    return null;
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// Helpers públicos
// ───────────────────────────────────────────────────────────────────────────────

/**
 * Lee la sesión JWT desde cookie "session" (y opcionalmente Authorization Bearer)
 * Usar en RSC/SSR cuando NO tienes el Request a la mano.
 * En Route Handlers prefiere getAuthFromRequest(req).
 */
export async function getAuth(): Promise<JWTPayload | null> {
  // cookie "session"
  const cookieToken = await readCookieUniversal("session");
  const fromCookie = safeVerify(cookieToken);
  if (fromCookie) return fromCookie;
  // sin Request no podemos leer Bearer; devolver null si no hay cookie válida
  return null;
}

/**
 * Igual que getAuth, pero con acceso a Request/NextRequest (Route Handlers).
 * 1) Cookie "session"
 * 2) Authorization: Bearer <jwt>
 */
export async function getAuthFromRequest(req: AnyReq): Promise<JWTPayload | null> {
  // Cookie
  const cookieToken = await readCookieUniversal("session", req);
  const fromCookie = safeVerify(cookieToken);
  if (fromCookie) return fromCookie;

  // Bearer
  const bearer = readBearer(req);
  const fromBearer = safeVerify(bearer);
  if (fromBearer) return fromBearer;

  return null;
}

/**
 * Fallback para DEV: obtiene userId aunque no exista sesión válida.
 * Orden:
 * 1) JWT válido (cookie o bearer) ⇒ payload.sub
 * 2) Header "x-user-id"
 * 3) Query string "?userId="
 */
export async function getUserIdFromRequest(req: AnyReq): Promise<string | null> {
  // 1) Sesión real
  const auth = await getAuthFromRequest(req);
  if (auth?.sub) return auth.sub;

  // 2) DEV fallback: header
  const headerId = req?.headers.get("x-user-id") ?? null;
  if (headerId) return headerId;

  // 3) DEV fallback: query
  try {
    const url = new URL((req as Request).url);
    const qId = url.searchParams.get("userId");
    if (qId) return qId;
  } catch {
    // no-op
  }

  return null;
}

/**
 * Lanza si no hay sesión válida. Úsalo en rutas que requieren login real.
 * (No usa fallbacks de DEV)
 */
export async function requireAuth(req?: AnyReq): Promise<JWTPayload> {
  const auth = req ? await getAuthFromRequest(req) : await getAuth();
  if (!auth) throw new Error("UNAUTHORIZED");
  return auth;
}

export async function requireAdmin(req?: AnyReq): Promise<JWTPayload> {
  const auth = await requireAuth(req);
  if (auth.role !== "ADMIN") throw new Error("FORBIDDEN");
  return auth;
}

export async function isAdmin(req?: AnyReq): Promise<boolean> {
  const auth = req ? await getAuthFromRequest(req) : await getAuth();
  return auth?.role === "ADMIN";
}

/**
 * Conveniencia: intenta obtener el usuario autenticado; si no hay,
 * devuelve un payload "mínimo" sólo si existe fallback de DEV (x-user-id / ?userId=).
 * Útil en endpoints que aceptan pruebas sin login formal.
 */
export async function getAuthOrDevFallback(req: AnyReq): Promise<JWTPayload | null> {
  const auth = await getAuthFromRequest(req);
  if (auth) return auth;

  const devId = await getUserIdFromRequest(req);
  if (devId) {
    // Construimos un payload mínimo para el UI durante dev
    return { sub: devId, role: "USER" } as JWTPayload;
  }
  return null;
}
