import { NextRequest, NextResponse } from "next/server";
import { Prisma, Role } from "@prisma/client";

import { getUserFromSession, prisma } from "../../../_utils";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const ROLE_LABELS: Record<Role, string> = {
  USER: "User",
  COACH: "Coach",
  ADMIN: "Admin",
};

function j(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function parseRole(value: unknown): Role | null {
  if (value === Role.USER) return Role.USER;
  if (value === Role.COACH) return Role.COACH;
  if (value === Role.ADMIN) return Role.ADMIN;
  return null;
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const actor = await getUserFromSession(req);

  if (!actor) {
    return j(401, {
      error: "UNAUTHORIZED",
      message: "Inicia sesión para continuar.",
    });
  }

  if (actor.role !== Role.ADMIN) {
    return j(403, {
      error: "FORBIDDEN",
      message: "Solo un administrador puede cambiar roles.",
    });
  }

  const { id } = await ctx.params;

  if (actor.id === id) {
    return j(400, {
      error: "CANNOT_CHANGE_OWN_ROLE",
      message: "No puedes cambiar tu propio rol.",
    });
  }

  const body = await req.json().catch(() => null);
  const role = parseRole(
    body && typeof body === "object"
      ? (body as { role?: unknown }).role
      : null
  );

  if (!role) {
    return j(400, {
      error: "INVALID_ROLE",
      message: "Selecciona un rol válido.",
    });
  }

  try {
    const user = await prisma.user.update({
      where: { id },
      data: { role },
      select: {
        id: true,
        role: true,
      },
    });

    return j(200, {
      ok: true,
      message: `Rol actualizado a ${ROLE_LABELS[user.role]}.`,
      user,
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return j(404, {
        error: "USER_NOT_FOUND",
        message: "Usuario no encontrado.",
      });
    }

    console.error("PATCH /api/admin/users/[id]/role error:", error);
    return j(500, {
      error: "INTERNAL_ERROR",
      message: "No se pudo actualizar el rol.",
    });
  }
}
