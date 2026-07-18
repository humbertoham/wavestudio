import type { NextResponse } from "next/server";

import { signToken, type AppRole, type JWTPayload } from "@/lib/jwt";

export const SESSION_COOKIE_NAME = "session";
export const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export type SessionUserState = {
  id: string;
  role: AppRole;
  affiliationConfirmedAt: Date | null;
  authVersion: number;
  wellhubPlanConfirmationRequired: boolean;
  wellhubPlanConfirmationCampaign: string | null;
};

function requestProtocol(req: Request) {
  const forwarded = req.headers
    .get("x-forwarded-proto")
    ?.split(",", 1)[0]
    ?.trim()
    .toLowerCase();
  if (forwarded === "http" || forwarded === "https") return forwarded;

  try {
    return new URL(req.url).protocol.replace(":", "").toLowerCase();
  } catch {
    return "";
  }
}

function isLoopbackRequest(req: Request) {
  try {
    const hostname = new URL(req.url).hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "127.0.0.1" ||
      hostname === "::1"
    );
  } catch {
    return false;
  }
}

export function sessionCookieUsesSecureTransport(req: Request) {
  if (requestProtocol(req) === "https") return true;
  if (isLoopbackRequest(req)) return false;
  return process.env.NODE_ENV === "production";
}

function baseSessionCookieOptions(req: Request) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: sessionCookieUsesSecureTransport(req),
    path: "/",
  };
}

export function buildSessionPayload(user: SessionUserState): JWTPayload {
  return {
    sub: user.id,
    role: user.role,
    affiliationConfirmed: user.affiliationConfirmedAt != null,
    sessionVersion: user.authVersion,
    wellhubPlanConfirmationRequired:
      user.wellhubPlanConfirmationRequired,
    wellhubPlanConfirmationCampaign:
      user.wellhubPlanConfirmationCampaign,
  };
}

/** Signs and attaches the server-only JWT to an existing route response. */
export function issueSessionCookie(
  response: NextResponse,
  req: Request,
  user: SessionUserState
) {
  const token = signToken(buildSessionPayload(user));
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    ...baseSessionCookieOptions(req),
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  });
}

export function clearSessionCookie(response: NextResponse, req: Request) {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    ...baseSessionCookieOptions(req),
    maxAge: 0,
    expires: new Date(0),
  });
}
