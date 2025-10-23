// src/app/api/bookings/[id]/cancel/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CANCEL_WINDOW_MIN = 240; // 4h

function j(status: number, body: any) {
  return NextResponse.json(body, { status });
}

export async function PATCH(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuth();
    if (!auth) return j(401, { code: "UNAUTHENTICATED" });

    const { id } = await ctx.params;

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        class: {
          select: {
            id: true, title: true, focus: true, date: true, durationMin: true, creditCost: true,
            capacity: true,
            instructor: { select: { id: true, name: true } },
          },
        },
        packPurchase: { select: { id: true } },
      },
    });

    if (!booking) return j(404, { code: "NOT_FOUND" });
    if (booking.userId !== auth.sub) return j(403, { code: "FORBIDDEN" });
    if (booking.status !== "ACTIVE") return j(409, { code: "ALREADY_CANCELED" });

    // Regla de 4h
    const minutesUntilStart = Math.floor((booking.class.date.getTime() - Date.now()) / 60000);
    if (minutesUntilStart < CANCEL_WINDOW_MIN) {
      return j(409, { code: "WINDOW_CLOSED", message: "La ventana de cancelación ya cerró (4 horas antes)." });
    }

    const costPerSeat = booking.class.creditCost ?? 1;
    const seatsReleased = booking.quantity ?? 1;       // 👈 lugares que se liberan
    const refundTokens = seatsReleased * costPerSeat;  // tokens a devolver

    const result = await prisma.$transaction(async (tx) => {
      // 1) Marcar booking cancelado
      const updated = await tx.booking.update({
        where: { id: booking.id },
        data: { status: "CANCELED", canceledAt: new Date(), refundToken: true },
        include: {
          class: {
            select: {
              id: true, title: true, focus: true, date: true, durationMin: true, creditCost: true,
              instructor: { select: { id: true, name: true } },
            },
          },
        },
      });

      // 2) Ledger (+tokens por reembolso)
      await tx.tokenLedger.create({
        data: {
          userId: booking.userId,
          packPurchaseId: booking.packPurchase?.id ?? null,
          bookingId: booking.id,
          delta: refundTokens,
          reason: "CANCEL_REFUND",
        },
      });

      // 3) (Opcional) si mantienes classesLeft en PackPurchase
      if (booking.packPurchase?.id) {
        await tx.packPurchase.update({
          where: { id: booking.packPurchase.id },
          data: { classesLeft: { increment: refundTokens } },
        });
      }

      // 4) (Opcional) Promover waitlist por cada seat liberado
      //    Si prefieres solo notificar, reemplaza por una inserción en tu cola de notificaciones.
      for (let i = 0; i < seatsReleased; i++) {
        const next = await tx.waitlist.findFirst({
          where: { classId: booking.classId },
          orderBy: { position: "asc" },
        });
        if (!next) break;

        // Crea un booking provisional o directamente activo (según tu UX)
        await tx.booking.create({
          data: {
            userId: next.userId,
            classId: booking.classId,
            quantity: 1,
            // si usas tokens automáticos para waitlist, debítalos aquí;
            // si no, deja pendiente de confirmación por el usuario.
          },
        });

        // Elimina o avanza la waitlist
        await tx.waitlist.delete({ where: { id: next.id } });
      }

      return updated;
    }, { isolationLevel: "Serializable" });

    // Respuesta
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
