import { NextRequest, NextResponse } from "next/server";
import { prisma, requireAdmin } from "../../../_utils";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

function j(status: number, body: any) {
  return NextResponse.json(body, { status });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  const { id: classId } = await ctx.params;
  const { userId } = await req.json();

  if (!userId) {
    return j(400, { error: "MISSING_USER_ID" });
  }

  const result = await prisma.$transaction(
    async (tx) => {
      // 1️⃣ Cargar clase con lock lógico
      const cls = await tx.class.findUnique({
        where: { id: classId },
        include: {
          bookings: {
            where: { status: "ACTIVE" },
          },
        },
      });

      if (!cls) throw { code: "CLASS_NOT_FOUND" };
      if (cls.isCanceled) throw { code: "CLASS_CANCELED" };

      // 2️⃣ Validar cupo
      const usedSpots = cls.bookings.reduce(
        (acc, b) => acc + (b.quantity ?? 1),
        0
      );

      if (usedSpots >= cls.capacity) {
        throw { code: "CLASS_FULL" };
      }

      // 3️⃣ Evitar booking duplicado
      const alreadyBooked = await tx.booking.findFirst({
        where: {
          classId,
          userId,
          status: "ACTIVE",
        },
      });

      if (alreadyBooked) {
        throw { code: "USER_ALREADY_BOOKED" };
      }

      // 4️⃣ Buscar pack con créditos disponibles
      const pack = await tx.packPurchase.findFirst({
        where: {
          userId,
          classesLeft: { gt: 0 },
          expiresAt: { gt: new Date() },
        },
        orderBy: {
          expiresAt: "asc",
        },
      });

      let corporateBalance = 0;

      if (!pack) {
        const agg = await tx.tokenLedger.aggregate({
          where: {
            userId,
            OR: [
              { packPurchaseId: null },
              { packPurchase: { expiresAt: { gt: new Date() } } },
            ],
          },
          _sum: { delta: true },
        });

        corporateBalance = agg._sum.delta ?? 0;

        if (corporateBalance < 1) {
          throw { code: "NO_CREDITS_AVAILABLE" };
        }
      }

      // 5️⃣ Crear booking
      const newBooking = await tx.booking.create({
        data: {
          userId,
          classId,
          quantity: 1,
          packPurchaseId: pack ? pack.id : null,
        },
      });

      if (pack) {
        // consumir pack
        await tx.packPurchase.update({
          where: { id: pack.id },
          data: {
            classesLeft: { decrement: 1 },
          },
        });

        await tx.tokenLedger.create({
          data: {
            userId,
            bookingId: newBooking.id,
            packPurchaseId: pack.id,
            delta: -1,
            reason: "BOOKING_DEBIT",
          },
        });
      } else {
        // corporate debit
        await tx.tokenLedger.create({
          data: {
            userId,
            bookingId: newBooking.id,
            delta: -1,
            reason: "BOOKING_DEBIT",
          },
        });
      }

      return newBooking;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    }
  );

  return NextResponse.json({
    ok: true,
    bookingId: result.id,
  });
}