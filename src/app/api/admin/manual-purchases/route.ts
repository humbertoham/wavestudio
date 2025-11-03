import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuth } from "@/lib/auth";

export const runtime = "nodejs";

function j(status: number, body: any) {
  return NextResponse.json(body, { status });
}

export async function POST(req: Request) {
  try {
    const me = await getAuth();
    if (!me) return j(401, { error: "UNAUTHORIZED" });

    // Confirma que el usuario autenticado es ADMIN
    const meRow = await prisma.user.findUnique({
      where: { id: me.sub },
      select: { role: true }
    });
    if (!meRow || meRow.role !== "ADMIN") return j(403, { error: "FORBIDDEN" });

    const { userId, packId, note } = await req.json();

    if (!userId || !packId) return j(400, { error: "Missing userId or packId" });

    const [user, pack] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } }),
      prisma.pack.findUnique({ where: { id: packId } }),
    ]);

    if (!user) return j(404, { error: "User not found" });
    if (!pack) return j(404, { error: "Pack not found" });

    // Calcula expiración (hoy + validityDays)
    const now = new Date();
    const expiresAt = new Date(now.getTime());
    expiresAt.setDate(expiresAt.getDate() + pack.validityDays);

    const result = await prisma.$transaction(async (tx) => {
      // 1) Payment APPROVED (proveedor MERCADOPAGO para mantener el enum)
      const payment = await tx.payment.create({
        data: {
          provider: "MERCADOPAGO",
          status: "APPROVED",
          amount: pack.price,
          currency: "MXN",
          userId: user.id,
          // Campos MP en null; tag para identificar que fue venta manual
          mpExternalRef: "ADMIN_MANUAL",
          mpRaw: { source: "admin_manual", note: note ?? null, packId: pack.id, userId: user.id },
        }
      });

      // 2) PackPurchase
      const purchase = await tx.packPurchase.create({
        data: {
          userId: user.id,
          packId: pack.id,
          classesLeft: pack.classes,
          expiresAt,
          paymentId: payment.id, // 1–1
        }
      });

      // 3) TokenLedger (+classes)
      await tx.tokenLedger.create({
        data: {
          userId: user.id,
          packPurchaseId: purchase.id,
          delta: pack.classes,
          reason: "PURCHASE_CREDIT",
        }
      });

      return { payment, purchase };
    });

    return j(201, {
      ok: true,
      paymentId: result.payment.id,
      packPurchaseId: result.purchase.id,
      expiresAt,
      classesLeft: pack.classes,
      amount: pack.price,
    });
  } catch (err: any) {
    console.error("manual-purchase error:", err);
    return j(500, { error: "INTERNAL_ERROR" });
  }
}
