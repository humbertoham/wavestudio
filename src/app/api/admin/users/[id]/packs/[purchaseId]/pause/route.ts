import { NextRequest, NextResponse } from "next/server";

import { prisma, requireAdmin } from "../../../../../_utils";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; purchaseId: string }> };

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PAUSE_DAYS = 30;

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS);
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  const { id: userId, purchaseId } = await ctx.params;
  const body = await req.json().catch(() => null);
  const days = Number((body as { days?: unknown } | null)?.days);

  if (!Number.isInteger(days) || days < 1 || days > MAX_PAUSE_DAYS) {
    return json(400, {
      ok: false,
      message: "La pausa debe ser de 1 a 30 dias",
    });
  }

  const result = await prisma.$transaction(async (tx) => {
    const purchase = await tx.packPurchase.findUnique({
      where: { id: purchaseId },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        pausedDays: true,
        pausedUntil: true,
      },
    });

    if (!purchase || purchase.userId !== userId) {
      return null;
    }

    const now = new Date();
    const pauseBase =
      purchase.pausedUntil && purchase.pausedUntil > now
        ? purchase.pausedUntil
        : now;

    return tx.packPurchase.update({
      where: { id: purchase.id },
      data: {
        pausedDays: { increment: days },
        pausedUntil: addDays(pauseBase, days),
        expiresAt: addDays(purchase.expiresAt, days),
      },
      select: {
        id: true,
        expiresAt: true,
        pausedDays: true,
        pausedUntil: true,
      },
    });
  });

  if (!result) {
    return json(404, {
      ok: false,
      message: "Paquete no encontrado para este usuario",
    });
  }

  return json(200, {
    ok: true,
    purchase: result,
  });
}
