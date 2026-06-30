import { NextResponse } from "next/server";

import { normalizeAffiliationAndPlan } from "@/lib/affiliation";
import { requireAuth } from "@/lib/auth";
import { signToken } from "@/lib/jwt";
import { prisma } from "@/lib/prisma";

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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, {
      error: "INVALID_JSON",
      message: "El body debe ser JSON valido.",
    });
  }

  const input = body && typeof body === "object" ? body : {};
  const normalized = normalizeAffiliationAndPlan(
    (input as { affiliation?: unknown }).affiliation,
    (input as { wellhubPlan?: unknown }).wellhubPlan
  );

  if (!normalized.ok) {
    return json(400, {
      error: normalized.code,
      message: normalized.message,
      fields: {
        [normalized.field]: [normalized.message],
      },
    });
  }

  const existing = await prisma.user.findUnique({
    where: { id: auth.sub },
    select: {
      id: true,
      role: true,
      affiliationConfirmedAt: true,
    },
  });

  if (!existing) {
    return json(404, {
      error: "USER_NOT_FOUND",
      message: "Usuario no encontrado.",
    });
  }

  if (existing.affiliationConfirmedAt) {
    return json(409, {
      error: "AFFILIATION_ALREADY_CONFIRMED",
      message: "Tu afiliacion ya fue confirmada.",
    });
  }

  const confirmedAt = new Date();
  const user = await prisma.user.update({
    where: { id: auth.sub },
    data: {
      affiliation: normalized.affiliation,
      wellhubPlan: normalized.wellhubPlan,
      affiliationConfirmedAt: confirmedAt,
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      affiliation: true,
      wellhubPlan: true,
      affiliationConfirmedAt: true,
    },
  });

  const token = signToken({
    sub: user.id,
    role: user.role,
    affiliationConfirmed: true,
  });

  const res = json(200, {
    ok: true,
    user: {
      ...user,
      affiliationConfirmed: true,
    },
  });

  res.cookies.set("session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return res;
}
