import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { normalizeAffiliationAndPlan } from "@/lib/affiliation";
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
      role: true,
      createdAt: true,
      dateOfBirth: true,
      phone: true,
      emergencyPhone: true,
      affiliation: true,
      wellhubPlan: true,
      affiliationConfirmedAt: true,
      bookingBlocked: true,
      bookingBlockedAt: true,
      bookingBlockLogs: {
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          blocked: true,
          createdAt: true,
        },
      },
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

  // ✅ 3️⃣ SALDO REAL DESDE PACKS (TOKENS NO EXPIRADOS)
  const tokenBalance = purchases
    .filter(
      (p) =>
        p.expiresAt > now &&
        p.classesLeft > 0 &&
        (!p.pausedUntil || p.pausedUntil <= now)
    )
    .reduce((sum, p) => sum + p.classesLeft, 0);

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

    // 🔥 saldo correcto
    tokenBalance,

    purchases: purchases.map((p) => ({
      id: p.id,
      createdAt: p.createdAt,
      expiresAt: p.expiresAt,
      classesLeft: p.classesLeft,
      pausedDays: p.pausedDays,
      pausedUntil: p.pausedUntil,
      isPaused: !!p.pausedUntil && p.pausedUntil > now,
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

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const input = body && typeof body === "object" ? body : {};
  const normalized = normalizeAffiliationAndPlan(
    (input as { affiliation?: unknown }).affiliation,
    (input as { wellhubPlan?: unknown }).wellhubPlan
  );

  if (!normalized.ok) {
    return j(400, {
      ok: false,
      error: normalized.code,
      message: normalized.message,
      fields: {
        [normalized.field]: [normalized.message],
      },
    });
  }

  try {
    const user = await prisma.user.update({
      where: { id },
      data: {
        affiliation: normalized.affiliation,
        wellhubPlan: normalized.wellhubPlan,
        affiliationConfirmedAt: new Date(),
      },
      select: {
        id: true,
        affiliation: true,
        wellhubPlan: true,
        affiliationConfirmedAt: true,
      },
    });

    return j(200, {
      ok: true,
      user,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return j(404, {
          ok: false,
          message: "Usuario no encontrado",
        });
      }

      if (error.code === "P2021" || error.code === "P2022") {
        return j(503, {
          ok: false,
          error: "SCHEMA_MIGRATION_REQUIRED",
          message:
            "La base de datos de este ambiente no tiene las migraciones requeridas.",
        });
      }
    }

    console.error("PATCH /api/admin/users/[id]/details error:", error);
    return j(500, {
      ok: false,
      message: "No se pudo actualizar la afiliacion.",
    });
  }
}
