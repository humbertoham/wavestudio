import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth";
import { CorporateCreditError } from "@/lib/corporate-credits";
import { signToken } from "@/lib/jwt";
import { prisma } from "@/lib/prisma";
import { isWellhubPlan } from "@/lib/wellhub";
import {
  WELLHUB_CONFIRMATION_MAX_RETRIES,
  WellhubPlanConfirmationError,
  confirmWellhubPlanInTransaction,
} from "@/lib/wellhub-plan-confirmation";

export const runtime = "nodejs";

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(req: Request) {
  const auth = await requireAuth(req).catch(() => null);
  if (!auth) {
    return json(401, {
      error: "UNAUTHORIZED",
      message: "Inicia sesion para continuar.",
    });
  }

  const body = await req.json().catch(() => null);
  const selectedPlan =
    body && typeof body === "object"
      ? (body as { wellhubPlan?: unknown }).wellhubPlan
      : null;

  if (!isWellhubPlan(selectedPlan)) {
    return json(400, {
      error: "INVALID_WELLHUB_PLAN",
      message: "Selecciona un plan de WellHub valido.",
    });
  }

  try {
    let result: Awaited<
      ReturnType<typeof confirmWellhubPlanInTransaction>
    > | null = null;

    for (
      let attempt = 1;
      attempt <= WELLHUB_CONFIRMATION_MAX_RETRIES;
      attempt += 1
    ) {
      try {
        result = await prisma.$transaction(
          (tx) =>
            confirmWellhubPlanInTransaction(tx, {
              userId: auth.sub,
              selectedPlan,
            }),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        );
        break;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === "P2034" || error.code === "P2002") &&
          attempt < WELLHUB_CONFIRMATION_MAX_RETRIES
        ) {
          continue;
        }
        throw error;
      }
    }

    if (!result) {
      return json(409, {
        error: "CONFIRMATION_CONFLICT",
        message: "No se pudo confirmar el plan. Intenta de nuevo.",
      });
    }

    const res = json(200, {
      ok: true,
      confirmation: result,
    });
    res.cookies.set(
      "session",
      signToken({
        sub: auth.sub,
        role: auth.role,
        affiliationConfirmed: auth.affiliationConfirmed,
        sessionVersion: auth.sessionVersion,
        wellhubPlanConfirmationRequired: false,
        wellhubPlanConfirmationCampaign: result.campaign,
      }),
      {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
      }
    );
    return res;
  } catch (error) {
    if (error instanceof WellhubPlanConfirmationError) {
      const status = error.code === "USER_NOT_FOUND" ? 404 : 409;
      const messages: Record<string, string> = {
        USER_NOT_FOUND: "Usuario no encontrado.",
        NOT_WELLHUB:
          "Tu afiliacion ya no es WellHub. Contacta a soporte.",
        CONFIRMATION_NOT_REQUIRED:
          "Tu plan de WellHub ya fue confirmado.",
        CAMPAIGN_STATE_INVALID:
          "No se pudo validar la campana. Contacta a soporte.",
        ALREADY_CONFIRMED: "Tu plan de WellHub ya fue confirmado.",
      };
      return json(status, {
        error: error.code,
        message: messages[error.code],
      });
    }

    if (error instanceof CorporateCreditError) {
      return json(409, {
        error: error.code,
        message:
          "No se pudieron sincronizar tus creditos. Tu confirmacion sigue pendiente.",
      });
    }

    console.error("[wellhub-plan-confirmation] failed", {
      userId: auth.sub,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return json(500, {
      error: "CONFIRMATION_FAILED",
      message:
        "No se pudo guardar tu plan ni sincronizar tus creditos. Intenta de nuevo.",
    });
  }
}
