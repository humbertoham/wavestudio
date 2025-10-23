// src/app/api/bookings/[id]/cancel/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CANCEL_WINDOW_MIN = 240; // 4h

function j(status: number, body: any) {
  return NextResponse.json(body, { status });
}

export async function PATCH(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await getAuth();
    if (!auth) return j(401, { code: "UNAUTHENTICATED" });

    const id = params.id;

    // Trae booking con lo necesario
    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        class: { select: { id: true, date: true, durationMin: true, creditCost: true } },
        // packPurchase para poder devolver clasesLeft si lo llevas en columna
        packPurchase: { select: { id: true } },
      },
    });

    if (!booking) return j(404, { code: "NOT_FOUND" });
    if (booking.userId !== auth.sub) return j(403, { code: "FORBIDDEN" });
    if (booking.status !== "ACTIVE") return j(409, { code: "ALREADY_CANCELED" });

    // Regla de 4h
    const start = booking.class.date;
    const minutesUntilStart = Math.floor((start.getTime() - Date.now()) / 60000);
    if (minutesUntilStart < CANCEL_WINDOW_MIN) {
      return j(409, { code: "WINDOW_CLOSED", message: "La ventana de cancelación ya cerró (4 horas antes)." });
    }

    const cost = booking.class.creditCost ?? 1;
    const refundTokens = (booking.quantity ?? 1) * cost;

    const result = await prisma.$transaction(async (tx) => {
      // 1) Marcar booking cancelado (idempotencia simple)
      const updated = await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: "CANCELED",
          canceledAt: new Date(),
          refundToken: true,
        },
        include: {
          class: {
            select: {
              id: true, title: true, focus: true, date: true, durationMin: true, creditCost: true,
              instructor: { select: { id: true, name: true } },
            },
          },
        },
      });

      // 2) Crear asiento en el ledger (devolución)
      await tx.tokenLedger.create({
        data: {
          userId: booking.userId,
          packPurchaseId: booking.packPurchase?.id ?? null,
          bookingId: booking.id,
          delta: refundTokens,          // suma tokens
          reason: "CANCEL_REFUND",
        },
      });

      // 3) (Opcional) si mantienes clasesLeft en PackPurchase, refléjalo
      if (booking.packPurchase?.id) {
        await tx.packPurchase.update({
          where: { id: booking.packPurchase.id },
          data: { classesLeft: { increment: refundTokens } },
        });
      }

      return updated;
    });

    // Devuelve el booking actualizado (page.tsx lo refresca en el array)
    return j(200, {
      id: result.id,
      status: result.status,
      createdAt: result.createdAt,
      canceledAt: result.canceledAt,
      quantity: booking.quantity,
      class: {
        id: result.class.id,
        title: result.class.title,
        focus: result.class.focus,
        date: result.class.date.toISOString(),
        durationMin: result.class.durationMin,
        creditCost: result.class.creditCost ?? 1,
        instructor: result.class.instructor,
      },
    });
  } catch (e) {
    console.error(e);
    return j(500, { code: "INTERNAL" });
  }
}
