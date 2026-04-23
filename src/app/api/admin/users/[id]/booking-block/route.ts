import { NextRequest, NextResponse } from "next/server";

import { prisma, requireAdmin } from "../../../_utils";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  const { id: userId } = await ctx.params;
  const body = await req.json().catch(() => null);
  const bookingBlocked = (body as { bookingBlocked?: unknown } | null)
    ?.bookingBlocked;

  if (typeof bookingBlocked !== "boolean") {
    return json(400, {
      ok: false,
      message: "bookingBlocked debe ser booleano",
    });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      bookingBlocked: true,
      bookingBlockedAt: true,
    },
  });

  if (!user) {
    return json(404, {
      ok: false,
      message: "Usuario no encontrado",
    });
  }

  if (user.bookingBlocked === bookingBlocked) {
    return json(200, {
      ok: true,
      user,
      changed: false,
    });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const nextUser = await tx.user.update({
      where: { id: userId },
      data: {
        bookingBlocked,
        bookingBlockedAt: bookingBlocked ? new Date() : null,
      },
      select: {
        id: true,
        bookingBlocked: true,
        bookingBlockedAt: true,
      },
    });

    await tx.bookingBlockLog.create({
      data: {
        userId,
        blocked: bookingBlocked,
      },
    });

    return nextUser;
  });

  return json(200, {
    ok: true,
    user: updated,
    changed: true,
  });
}
