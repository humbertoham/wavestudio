import { NextRequest, NextResponse } from "next/server";
import { grantPackagePurchase, packageSnapshot } from "@/lib/monthly-unlimited";
import { assertNoMonthlyDuplicate } from "@/lib/package-checkout";
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

  if (!pack) {
    return json(400, {
      ok: false,
      message: "Paquete inválido",
    });
  }

  // 5️⃣ Calcular vencimiento

  // 6️⃣ Transacción (IMPORTANTÍSIMO)
  const snapshot = packageSnapshot(pack);
  let result;
  try {
    result = await prisma.$transaction(async tx => {
      await assertNoMonthlyDuplicate(tx, userId, snapshot);
      const payment = await tx.payment.create({ data: { provider: "ADMIN", status: "APPROVED", amount: pack.price, currency: "MXN", userId, packSnapshot: snapshot } });
      return grantPackagePurchase(tx, { userId, packId: pack.id, paymentId: payment.id, snapshot });
    });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code?.startsWith("UNLIMITED_")) return json(409, { ok: false, code });
    throw error;
  }

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
