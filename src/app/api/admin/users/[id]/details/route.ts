// app/api/admin/users/[id]/details/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma, requireAdmin } from "../../../_utils"; // ajusta el import
import { z } from "zod";

export const runtime = "nodejs";

// Tipo de contexto con params asincrónico
type Ctx = { params: Promise<{ id: string }> };

// Helper para JSON response con status
function j(status: number, body: any) {
  return NextResponse.json(body, { status });
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  const { id } = await ctx.params;

  // 1) Buscar usuario base
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

  if (!user) return j(404, { ok: false, message: "Usuario no encontrado" });

  // 2) Calcular saldo de tokens
  const agg = await prisma.tokenLedger.aggregate({
    where: { userId: id },
    _sum: { delta: true },
  });
  const tokenBalance = agg._sum.delta ?? 0;

  // 3) Paquetes comprados
  const purchases = await prisma.packPurchase.findMany({
    where: { userId: id },
    orderBy: { createdAt: "desc" },
    include: {
      pack: { select: { id: true, name: true, classes: true, validityDays: true, price: true } },
      payment: { select: { id: true, status: true } },
    },
  });

  // 4) Reservas (con clase e instructor)
  const bookings = await prisma.booking.findMany({
    where: { userId: id },
    orderBy: { createdAt: "desc" },
    include: {
      class: {
        select: {
          id: true,
          title: true,
          date: true,
          instructor: { select: { id: true, name: true } },
        },
      },
      packPurchase: {
        select: {
          id: true,
          pack: { select: { id: true, name: true } },
        },
      },
    },
  });

  // 5) Respuesta final
  return j(200, {
    ok: true,
    user,
    tokenBalance,
    purchases: purchases.map(p => ({
      id: p.id,
      createdAt: p.createdAt,
      expiresAt: p.expiresAt,
      classesLeft: p.classesLeft,
      pack: p.pack,
      payment: p.payment ?? null,
    })),
    bookings: bookings.map(b => ({
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