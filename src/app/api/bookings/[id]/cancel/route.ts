// src/app/api/bookings/[id]/cancel/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CANCEL_WINDOW_MIN = 240; // 4 horas reales

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
            id: true,
            title: true,
            focus: true,
            date: true,
            durationMin: true,
            creditCost: true,
            instructor: { select: { id: true, name: true } },
          },
        },
        packPurchase: { select: { id: true } },
      },
    });

    if (!booking) return j(404, { code: "NOT_FOUND" });
    if (booking.userId !== auth.sub) return j(403, { code: "FORBIDDEN" });
    if (booking.status !== "ACTIVE")
      return j(409, { code: "ALREADY_CANCELED" });

    const minutesUntilStart = Math.floor(
      (booking.class.date.getTime() - Date.now()) / 60000
    );

    const isLateCancel = minutesUntilStart < CANCEL_WINDOW_MIN;

    const costPerSeat = booking.class.creditCost ?? 1;
    const seatsReleased = booking.quantity ?? 1;
    const refundTokens = seatsReleased * costPerSeat;

    const result = await prisma.$transaction(
      async (tx) => {
        // 1️⃣ Marcar booking cancelado
        const updated = await tx.booking.update({
          where: { id: booking.id },
          data: {
            status: "CANCELED",
            canceledAt: new Date(),
            refundToken: !isLateCancel, // true solo si hubo reembolso
          },
          include: {
            class: {
              select: {
                id: true,
                title: true,
                focus: true,
                date: true,
                durationMin: true,
                creditCost: true,
                instructor: { select: { id: true, name: true } },
              },
            },
          },
        });

        // 2️⃣ Si NO es cancelación tardía → devolver tokens
  if (!isLateCancel) {

  const alreadyRefunded = await tx.tokenLedger.findFirst({
    where: {
      bookingId: booking.id,
      reason: "CANCEL_REFUND",
    },
  });

  if (!alreadyRefunded) {

    const debits = await tx.tokenLedger.findMany({
      where: {
        bookingId: booking.id,
        reason: "BOOKING_DEBIT",
      },
    });

    for (const d of debits) {
      if (d.packPurchaseId) {
        await tx.packPurchase.update({
          where: { id: d.packPurchaseId },
          data: {
            classesLeft: { increment: Math.abs(d.delta) },
          },
        });
      }

      await tx.tokenLedger.create({
        data: {
          userId: booking.userId!,
          packPurchaseId: d.packPurchaseId,
          bookingId: booking.id,
          delta: Math.abs(d.delta),
          reason: "CANCEL_REFUND",
        },
      });
    }
  }
}

        // 3️⃣ Liberar cupos (promover waitlist si existe)
        for (let i = 0; i < seatsReleased; i++) {
          const next = await tx.waitlist.findFirst({
            where: { classId: booking.classId },
            orderBy: { position: "asc" },
          });

          if (!next) break;

          await tx.booking.create({
            data: {
              userId: next.userId,
              classId: booking.classId,
              quantity: 1,
            },
          });

          await tx.waitlist.delete({
            where: { id: next.id },
          });
        }

        return updated;
      },
      { isolationLevel: "Serializable" }
    );

    return j(200, {
      id: result.id,
      status: result.status,
      createdAt: result.createdAt,
      canceledAt: result.canceledAt,
      quantity: booking.quantity,
      lateCancel: isLateCancel, // 👈 importante para el frontend
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
