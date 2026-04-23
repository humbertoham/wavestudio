import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma, requireAdmin } from "../../../_utils";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const ADMIN_ADJUST_PACK_ID = "internal_admin_adjust";
const ADMIN_ADJUST_EXPIRY_MS = 10 * 365 * 24 * 60 * 60 * 1000;

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  const params = await ctx.params;
  const userId = typeof params?.id === "string" ? params.id.trim() : "";

  if (!userId) {
    return json(400, {
      ok: false,
      message: "userId requerido",
    });
  }

  let delta: number | undefined;
  let reason: unknown;

  try {
    let body: unknown;

    try {
      body = await req.json();
    } catch (error) {
      console.error(
        "POST /api/admin/users/[id]/tokens invalid JSON",
        { userId },
        error
      );
      return json(400, {
        ok: false,
        message: "Body JSON invalido",
      });
    }

    if (typeof body !== "object" || body === null) {
      return json(400, {
        ok: false,
        message: "Body JSON invalido",
      });
    }

    delta = (body as { delta?: unknown }).delta as number | undefined;
    reason = (body as { reason?: unknown }).reason;

    if (typeof delta !== "number" || !Number.isInteger(delta)) {
      return json(400, {
        ok: false,
        message: "Delta debe ser un entero",
      });
    }

    if (delta === 0) {
      return json(400, {
        ok: false,
        message: "Delta no puede ser 0",
      });
    }

    if (reason !== "ADMIN_ADJUST") {
      return json(400, {
        ok: false,
        message: "Reason invalido",
      });
    }

    const adjustmentDelta = delta;
    const adjustmentReason = "ADMIN_ADJUST" as const;

    const userExists = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!userExists) {
      return json(404, {
        ok: false,
        message: "Usuario no encontrado",
      });
    }

    const now = new Date();
    const packs = await prisma.packPurchase.findMany({
      where: {
        userId,
        expiresAt: { gt: now },
        classesLeft: { gt: 0 },
        OR: [{ pausedUntil: null }, { pausedUntil: { lte: now } }],
      },
      orderBy: { expiresAt: "asc" },
      select: { id: true, classesLeft: true },
    });

    const currentBalance = packs.reduce(
      (sum, pack) => sum + pack.classesLeft,
      0
    );
    const nextBalance = currentBalance + adjustmentDelta;

    if (nextBalance < 0) {
      return json(400, {
        ok: false,
        message: "El ajuste dejaria el saldo negativo",
        currentBalance,
      });
    }

    await prisma.$transaction(async (tx) => {
      if (adjustmentDelta > 0) {
        const adminPack = await tx.pack.upsert({
          where: { id: ADMIN_ADJUST_PACK_ID },
          update: {
            name: "Ajuste administrativo (Interno)",
            classes: 0,
            price: 0,
            validityDays: 3650,
            isActive: false,
            isVisible: false,
            oncePerUser: false,
            classesLabel: "Ajuste manual",
          },
          create: {
            id: ADMIN_ADJUST_PACK_ID,
            name: "Ajuste administrativo (Interno)",
            classes: 0,
            price: 0,
            validityDays: 3650,
            isActive: false,
            isVisible: false,
            oncePerUser: false,
            classesLabel: "Ajuste manual",
          },
        });

        console.info("POST /api/admin/users/[id]/tokens credit", {
          userId,
          delta: adjustmentDelta,
          currentBalance,
          nextBalance,
          adminPackId: adminPack.id,
        });

        await tx.packPurchase.create({
          data: {
            userId,
            packId: adminPack.id,
            classesLeft: adjustmentDelta,
            expiresAt: new Date(now.getTime() + ADMIN_ADJUST_EXPIRY_MS),
          },
        });

        await tx.tokenLedger.create({
          data: {
            userId,
            delta: adjustmentDelta,
            reason: adjustmentReason,
          },
        });

        return;
      }

      let remaining = Math.abs(adjustmentDelta);

      for (const pack of packs) {
        if (remaining <= 0) break;

        const use = Math.min(pack.classesLeft, remaining);

        await tx.packPurchase.update({
          where: { id: pack.id },
          data: {
            classesLeft: {
              decrement: use,
            },
          },
        });

        await tx.tokenLedger.create({
          data: {
            userId,
            packPurchaseId: pack.id,
            delta: -use,
            reason: adjustmentReason,
          },
        });

        remaining -= use;
      }
    });

    return json(200, {
      ok: true,
      previousBalance: currentBalance,
      delta: adjustmentDelta,
      newBalance: nextBalance,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      console.error(
        "POST /api/admin/users/[id]/tokens prisma error",
        {
          userId,
          delta,
          reason,
          code: error.code,
          meta: error.meta,
        }
      );

      if (error.code === "P2003") {
        return json(400, {
          ok: false,
          message: "Referencia invalida al ajustar tokens",
        });
      }

      if (error.code === "P2025") {
        return json(404, {
          ok: false,
          message: "Usuario no encontrado",
        });
      }
    }

    console.error(
      "POST /api/admin/users/[id]/tokens error",
      { userId, delta, reason },
      error
    );

    return json(500, {
      ok: false,
      message: "No se pudo ajustar el saldo de tokens",
    });
  }
}
