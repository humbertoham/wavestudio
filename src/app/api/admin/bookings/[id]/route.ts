import { NextRequest, NextResponse } from "next/server";
import { prisma, requireAdmin } from "../../_utils";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";

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

  // 2️⃣ Idempotencia: si ya está cancelado
  if (booking.status === "CANCELED") {
    return j(200, { ok: true, alreadyCanceled: true });
  }

  await prisma.$transaction(
    async (tx) => {

      // 🔒 evitar doble refund
      const alreadyRefunded = await tx.tokenLedger.findFirst({
        where: {
          bookingId: booking.id,
          reason: "CANCEL_REFUND",
        },
      });

      // 3️⃣ Cancelar booking
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: "CANCELED",
          canceledAt: new Date(),
        },
      });

      if (alreadyRefunded) return;

      // 4️⃣ Buscar TODOS los debits asociados
      const debits = await tx.tokenLedger.findMany({
        where: {
          bookingId: booking.id,
          reason: "BOOKING_DEBIT",
        },
      });

      for (const d of debits) {

        const refundAmount = Math.abs(d.delta);

        // devolver tokens al pack si existe
        if (d.packPurchaseId) {
          await tx.packPurchase.update({
            where: { id: d.packPurchaseId },
            data: {
              classesLeft: {
                increment: refundAmount,
              },
            },
          });
        }

        // ledger refund
        await tx.tokenLedger.create({
          data: {
            userId: booking.userId!,
            bookingId: booking.id,
            packPurchaseId: d.packPurchaseId,
            delta: refundAmount,
            reason: "CANCEL_REFUND",
          },
        });
      }
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    }
  );

  return j(200, {
    ok: true,
    refunded: true,
    quantity: booking.quantity ?? 1,
  });
}