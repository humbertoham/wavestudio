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

  // 3️⃣ Verificar que el usuario exista
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

  // 4️⃣ Calcular saldo actual (ledger-based)
  const agg = await prisma.tokenLedger.aggregate({
    where: { userId },
    _sum: { delta: true },
  });

  const currentBalance = agg._sum.delta ?? 0;
  const nextBalance = currentBalance + delta;

  // 5️⃣ Proteger contra saldo negativo
  if (nextBalance < 0) {
    return json(400, {
      ok: false,
      message: "El ajuste dejaría el saldo negativo",
      currentBalance,
    });
  }

  // 6️⃣ Registrar ajuste en el ledger
  await prisma.tokenLedger.create({
    data: {
      userId,
      delta,
      reason, // ADMIN_ADJUST
    },
  });

  // 7️⃣ Respuesta
  return json(200, {
    ok: true,
    previousBalance: currentBalance,
    delta,
    newBalance: nextBalance,
  });
}
