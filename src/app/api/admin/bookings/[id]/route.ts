import { NextRequest, NextResponse } from "next/server";
import { prisma, requireAdmin } from "../../_utils";

export const runtime = "nodejs";

// App Router params async
type Ctx = { params: Promise<{ id: string }> };

function j(status: number, body: any) {
  return NextResponse.json(body, { status });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  const { id } = await ctx.params;

  // 1️⃣ Cargar booking
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      user: true,
    },
  });

  if (!booking) {
    return j(404, { error: "BOOKING_NOT_FOUND" });
  }

  // 2️⃣ Idempotencia: si ya está cancelado, no repetir
  if (booking.status === "CANCELED") {
    return j(200, { ok: true, alreadyCanceled: true });
  }

  // 3️⃣ Transacción completa
  await prisma.$transaction(async (tx) => {
    // 3a) Cancelar booking
    await tx.booking.update({
      where: { id: booking.id },
      data: {
        status: "CANCELED",
        canceledAt: new Date(),
      },
    });

    // 3b) Buscar débito original en ledger
    const debit = await tx.tokenLedger.findFirst({
      where: {
        bookingId: booking.id,
        reason: "BOOKING_DEBIT",
      },
      orderBy: { createdAt: "desc" },
    });

    // 3c) Si hubo débito, devolver tokens
    if (booking.userId && debit) {
      // devolver tokens al pack si existe
      if (debit.packPurchaseId) {
        await tx.packPurchase.update({
          where: { id: debit.packPurchaseId },
          data: {
            classesLeft: {
              increment: booking.quantity ?? 1,
            },
          },
        });
      }

      // ledger de reembolso
      await tx.tokenLedger.create({
        data: {
          userId: booking.userId,
          bookingId: booking.id,
          packPurchaseId: debit.packPurchaseId,
          delta: booking.quantity ?? 1,
          reason: "CANCEL_REFUND",
        },
      });
    }
  });

  return j(200, {
    ok: true,
    refunded: true,
    quantity: booking.quantity ?? 1,
  });
}
