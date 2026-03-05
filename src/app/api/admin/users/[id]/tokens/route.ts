import { NextRequest, NextResponse } from "next/server";
import { prisma, requireAdmin } from "../../../_utils";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  // 1️⃣ Validar admin
  const auth = await requireAdmin(req);
  if (auth) return auth;

  const { id: userId } = await ctx.params;

  // 2️⃣ Leer payload
  const { delta, reason } = await req.json();

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
      message: "Reason inválido",
    });
  }

  // 3️⃣ Verificar usuario
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

  // 4️⃣ Obtener packs vigentes
  const packs = await prisma.packPurchase.findMany({
    where: {
      userId,
      expiresAt: { gt: now },
      classesLeft: { gt: 0 },
    },
    orderBy: { expiresAt: "asc" },
    select: { id: true, classesLeft: true },
  });

  const currentBalance = packs.reduce(
    (sum, p) => sum + p.classesLeft,
    0
  );

  const nextBalance = currentBalance + delta;

  // 5️⃣ Proteger contra saldo negativo
  if (nextBalance < 0) {
    return json(400, {
      ok: false,
      message: "El ajuste dejaría el saldo negativo",
      currentBalance,
    });
  }

  // 6️⃣ Transacción
  await prisma.$transaction(async (tx) => {

    // ➕ ADMIN AGREGA TOKENS
    if (delta > 0) {

      await tx.packPurchase.create({
        data: {
          userId,
          packId: "ADMIN_ADJUST", // etiqueta lógica
          classesLeft: delta,
          expiresAt: new Date(
            Date.now() + 10 * 365 * 24 * 60 * 60 * 1000 // 10 años
          ),
        },
      });

      await tx.tokenLedger.create({
        data: {
          userId,
          delta,
          reason,
        },
      });

      return;
    }

    // ➖ ADMIN QUITA TOKENS
    let remaining = Math.abs(delta);

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
          reason,
        },
      });

      remaining -= use;
    }
  });

  return json(200, {
    ok: true,
    previousBalance: currentBalance,
    delta,
    newBalance: nextBalance,
  });
}