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
  const { packId } = await req.json();

  if (!packId || typeof packId !== "string") {
    return json(400, {
      ok: false,
      message: "packId requerido",
    });
  }

  // 3️⃣ Verificar usuario
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });

  if (!user) {
    return json(404, {
      ok: false,
      message: "Usuario no encontrado",
    });
  }

  // 4️⃣ Verificar paquete
  const pack = await prisma.pack.findUnique({
    where: { id: packId },
  });

  if (!pack || !pack.isActive) {
    return json(400, {
      ok: false,
      message: "Paquete inválido o inactivo",
    });
  }

  // 5️⃣ Calcular vencimiento
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + pack.validityDays);

  // 6️⃣ Transacción (IMPORTANTÍSIMO)
  const result = await prisma.$transaction(async (tx) => {
    // 6a️⃣ Crear PackPurchase
    const purchase = await tx.packPurchase.create({
      data: {
        userId,
        packId: pack.id,
        classesLeft: pack.classes,
        expiresAt,
      },
    });

    // 6b️⃣ Acreditar tokens (expiran con el paquete)
    await tx.tokenLedger.create({
      data: {
        userId,
        packPurchaseId: purchase.id,
        delta: pack.classes,
        reason: "PURCHASE_CREDIT",
        // ⛔ NO usamos expiresAt aquí porque
        // el filtro se hace vía packPurchase.expiresAt
      },
    });

    return purchase;
  });

  // 7️⃣ Respuesta
  return json(200, {
    ok: true,
    purchase: {
      id: result.id,
      packId: pack.id,
      packName: pack.name,
      classes: pack.classes,
      expiresAt: result.expiresAt,
    },
  });
}
