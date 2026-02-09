import { NextRequest, NextResponse } from "next/server";
import { prisma, requireAdmin } from "../../../_utils";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

function j(status: number, body: any) {
  return NextResponse.json(body, { status });
}

export async function GET(req: NextRequest, ctx: Ctx) {
  // 🔐 Validar admin
  const auth = await requireAdmin(req);
  if (auth) return auth;

  const { id } = await ctx.params;
  const now = new Date();

  // 1️⃣ Usuario
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      dateOfBirth: true,
      phone: true,
      emergencyPhone: true,
      affiliation: true,
    },
  });

  if (!user) {
    return j(404, {
      ok: false,
      message: "Usuario no encontrado",
    });
  }

  // 2️⃣ Paquetes comprados / asignados
  const purchases = await prisma.packPurchase.findMany({
    where: { userId: id },
    orderBy: { createdAt: "desc" },
    include: {
      pack: {
        select: {
          id: true,
          name: true,
          classes: true,
          validityDays: true,
          price: true,
        },
      },
      payment: {
        select: {
          id: true,
          status: true,
        },
      },
    },
  });

  // ✅ 3️⃣ SALDO REAL DESDE LEDGER (FUENTE DE VERDAD)
  const tokenAgg = await prisma.tokenLedger.aggregate({
  where: {
    userId: id,
    OR: [
      { packPurchaseId: null }, // ADMIN_ADJUST
      { packPurchase: { expiresAt: { gt: now } } }, // paquetes vigentes
    ],
  },
  _sum: { delta: true },
});

const tokenBalance = Math.max(0, tokenAgg._sum.delta ?? 0);


  // 4️⃣ Reservas
  const bookings = await prisma.booking.findMany({
    where: { userId: id },
    orderBy: { createdAt: "desc" },
    include: {
      class: {
        select: {
          id: true,
          title: true,
          date: true,
          instructor: {
            select: { id: true, name: true },
          },
        },
      },
      packPurchase: {
        select: {
          id: true,
          pack: {
            select: { id: true, name: true },
          },
        },
      },
    },
  });

  // 5️⃣ Response
  return j(200, {
    ok: true,

    user,

    // 🔥 ESTE ES EL SALDO QUE DEBE USAR TODO EL SISTEMA
    tokenBalance,

    purchases: purchases.map((p) => ({
      id: p.id,
      createdAt: p.createdAt,
      expiresAt: p.expiresAt,
      classesLeft: p.classesLeft,
      isExpired: p.expiresAt < now,
      pack: p.pack,
      payment: p.payment ?? null,
    })),

    bookings: bookings.map((b) => ({
      id: b.id,
      status: b.status,
      quantity: b.quantity,
      createdAt: b.createdAt,
      class: {
        id: b.class.id,
        title: b.class.title,
        date: b.class.date,
        instructor: b.class.instructor ?? null,
      },
      packPurchase: b.packPurchase ?? null,
    })),
  });
}
