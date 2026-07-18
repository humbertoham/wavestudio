import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  getVerifiedSessionCookiePayload,
  requireAuth,
} from "@/lib/auth";
import { CorporateCreditError } from "@/lib/corporate-credits";
import { prisma } from "@/lib/prisma";
import {
  issueSessionCookie,
  type SessionUserState,
} from "@/lib/session-cookie";
import { isWellhubPlan } from "@/lib/wellhub";
import { WELLHUB_CONFIRMATION_DESTINATION } from "@/lib/wellhub-confirmation-ui";
import {
  WELLHUB_CONFIRMATION_MAX_RETRIES,
  WellhubPlanConfirmationError,
  confirmWellhubPlanInTransaction,
} from "@/lib/wellhub-plan-confirmation";
import {
  getCompletedWellhubSessionState,
  getRecoverableWellhubSessionState,
} from "@/lib/wellhub-session-recovery";

export const runtime = "nodejs";

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function successWithSession(
  req: Request,
  sessionUser: SessionUserState,
  body: Record<string, unknown>
) {
  try {
    const response = json(200, {
      ok: true,
      redirectTo: WELLHUB_CONFIRMATION_DESTINATION,
      sessionCookieWritten: true,
      ...body,
    });
    issueSessionCookie(response, req, sessionUser);
    return response;
  } catch (error) {
    console.error("[wellhub-plan-confirmation] session renewal failed", {
      userId: sessionUser.id,
      sessionCookieWritten: false,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return json(500, {
      error: "SESSION_RENEWAL_FAILED",
      message:
        "No se pudo renovar tu sesion. Presiona Guardar y continuar para reintentarlo sin repetir tus creditos.",
    });
  }
}

function confirmationErrorResponse(error: WellhubPlanConfirmationError) {
  const status = error.code === "USER_NOT_FOUND" ? 404 : 409;
  const messages: Record<WellhubPlanConfirmationError["code"], string> = {
    USER_NOT_FOUND: "Usuario no encontrado.",
    NOT_WELLHUB: "Tu afiliacion ya no es WellHub. Contacta a soporte.",
    CONFIRMATION_NOT_REQUIRED: "Tu plan de WellHub ya fue confirmado.",
    CAMPAIGN_STATE_INVALID:
      "No se pudo validar la campana. Contacta a soporte.",
    ALREADY_CONFIRMED: "Tu plan de WellHub ya fue confirmado.",
    SESSION_STATE_CHANGED:
      "Tu sesion cambio antes de confirmar. Inicia sesion nuevamente.",
  };
  return json(status, { error: error.code, message: messages[error.code] });
}

export async function POST(req: Request) {
  const auth = await requireAuth(req).catch(() => null);

  if (!auth) {
    const stalePayload = await getVerifiedSessionCookiePayload(req);
    if (!stalePayload) {
      return json(401, {
        error: "UNAUTHORIZED",
        message: "Inicia sesion para continuar.",
      });
    }

    try {
      const recovered = await getRecoverableWellhubSessionState(stalePayload);
      if (!recovered) {
        return json(401, {
          error: "SESSION_RECOVERY_NOT_AVAILABLE",
          message:
            "Esta sesion no se puede recuperar de forma segura. Inicia sesion nuevamente.",
        });
      }
      return successWithSession(req, recovered, {
        alreadyConfirmed: true,
        sessionRecovered: true,
      });
    } catch (error) {
      console.error("[wellhub-plan-confirmation] recovery lookup failed", {
        userId: stalePayload.sub,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      return json(500, {
        error: "SESSION_RECOVERY_FAILED",
        message: "No se pudo recuperar tu sesion. Intenta de nuevo.",
      });
    }
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
              expectedAuthVersion: auth.sessionVersion ?? 0,
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

    const { sessionUser, ...confirmation } = result;
    return successWithSession(req, sessionUser, {
      confirmation,
      alreadyConfirmed: false,
      sessionRecovered: false,
    });
  } catch (error) {
    if (
      error instanceof WellhubPlanConfirmationError &&
      (error.code === "CONFIRMATION_NOT_REQUIRED" ||
        error.code === "ALREADY_CONFIRMED" ||
        error.code === "SESSION_STATE_CHANGED")
    ) {
      let completed: SessionUserState | null;
      try {
        completed = await getCompletedWellhubSessionState(auth.sub);
      } catch (lookupError) {
        console.error("[wellhub-plan-confirmation] completed lookup failed", {
          userId: auth.sub,
          errorName:
            lookupError instanceof Error ? lookupError.name : "UnknownError",
        });
        return json(500, {
          error: "SESSION_RECOVERY_FAILED",
          message: "No se pudo recuperar tu sesion. Intenta de nuevo.",
        });
      }
      if (completed) {
        return successWithSession(req, completed, {
          alreadyConfirmed: true,
          sessionRecovered: false,
        });
      }
    }

    if (error instanceof WellhubPlanConfirmationError) {
      return confirmationErrorResponse(error);
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
