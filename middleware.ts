import { errors as joseErrors, jwtVerify } from "jose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import {
  WELLHUB_CONFIRMATION_PATH,
  hasPendingWellhubPlanConfirmation,
  isWellhubConfirmationAllowedPath,
  shouldRequireWellhubPlanConfirmation,
  type WellhubConfirmationState,
} from "@/lib/wellhub-confirmation-gate";

const secret = new TextEncoder().encode(process.env.JWT_SECRET!);

function apiError(error: string, message: string, status: number) {
  return NextResponse.json(
    { error, message },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

function loginRedirect(req: NextRequest, nextPath: string) {
  return NextResponse.redirect(
    new URL(`/login?next=${encodeURIComponent(nextPath)}`, req.url)
  );
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const token = req.cookies.get("session")?.value;
  let payload: Record<string, unknown> | null = null;
  let wellhubConfirmationState: WellhubConfirmationState | null = null;
  let invalidatedSession = false;
  let invalidatedUserRequiresConfirmation = false;

  if (token) {
    try {
      const verified = await jwtVerify(token, secret);
      const sub =
        typeof verified.payload.sub === "string"
          ? verified.payload.sub
          : null;

      if (sub) {
        const user = await prisma.user.findUnique({
          where: { id: sub },
          select: {
            role: true,
            affiliation: true,
            authVersion: true,
            wellhubPlanConfirmationRequired: true,
            wellhubPlanConfirmationCampaign: true,
            wellhubPlanConfirmations: {
              where: { status: "PENDING" },
              select: { campaign: true },
            },
          },
        });

        if (user) {
          wellhubConfirmationState = {
            affiliation: user.affiliation,
            wellhubPlanConfirmationRequired:
              user.wellhubPlanConfirmationRequired,
            wellhubPlanConfirmationCampaign:
              user.wellhubPlanConfirmationCampaign,
            pendingWellhubPlanConfirmationCampaigns:
              user.wellhubPlanConfirmations.map((record) => record.campaign),
          };
          const signedVersion = Number.isInteger(
            verified.payload.sessionVersion
          )
            ? Number(verified.payload.sessionVersion)
            : 0;

          if (signedVersion === user.authVersion) {
            payload = {
              ...verified.payload,
              role: user.role,
              sessionVersion: user.authVersion,
              wellhubPlanConfirmationRequired:
                user.wellhubPlanConfirmationRequired,
              wellhubPlanConfirmationCampaign:
                user.wellhubPlanConfirmationCampaign,
            };
          } else {
            invalidatedSession = true;
            invalidatedUserRequiresConfirmation =
              hasPendingWellhubPlanConfirmation(wellhubConfirmationState);
          }
        } else {
          invalidatedSession = true;
        }
      }
    } catch (error) {
      if (!(error instanceof joseErrors.JOSEError)) {
        console.error("[middleware] auth state lookup failed", {
          pathname,
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
        return apiError(
          "AUTH_STATE_UNAVAILABLE",
          "No se pudo verificar el acceso. Intenta de nuevo.",
          503
        );
      }
      payload = null;
    }
  }

  if (
    invalidatedSession &&
    !isWellhubConfirmationAllowedPath(pathname)
  ) {
    if (pathname.startsWith("/api")) {
      return apiError(
        "SESSION_INVALIDATED",
        "Tu sesion debe renovarse para continuar.",
        401
      );
    }
    return loginRedirect(
      req,
      invalidatedUserRequiresConfirmation
        ? WELLHUB_CONFIRMATION_PATH
        : `${pathname}${search}`
    );
  }

  if (
    shouldRequireWellhubPlanConfirmation(
      pathname,
      wellhubConfirmationState
    )
  ) {
    if (pathname.startsWith("/api")) {
      return apiError(
        "WELLHUB_PLAN_CONFIRMATION_REQUIRED",
        "Confirma tu plan actual de WellHub para continuar.",
        428
      );
    }
    return NextResponse.redirect(
      new URL(WELLHUB_CONFIRMATION_PATH, req.url)
    );
  }

  if (pathname.startsWith("/admin")) {
    if (!payload) return loginRedirect(req, pathname);
    if (payload.role !== "ADMIN") {
      return NextResponse.redirect(new URL("/", req.url));
    }
  }

  return NextResponse.next();
}

export const runtime = "nodejs";

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|woff2?|ttf|webmanifest)$).*)",
  ],
};
