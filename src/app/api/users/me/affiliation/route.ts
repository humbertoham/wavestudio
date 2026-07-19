import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth";
import { DEFAULT_AUTHENTICATED_PATH } from "@/lib/login-navigation";

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

  return json(410, {
    error: "AFFILIATION_ONBOARDING_DISABLED",
    message: "La afiliacion ya no se confirma desde esta pagina.",
    redirectTo: DEFAULT_AUTHENTICATED_PATH,
  });
}
