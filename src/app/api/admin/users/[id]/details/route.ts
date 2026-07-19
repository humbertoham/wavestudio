import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { normalizeAffiliationAndPlan } from "@/lib/affiliation";
import {
  CorporateCreditError,
  applyAdminAffiliationAndWellhubSync,
} from "@/lib/corporate-credits";
import { prisma, getUserFromSession, requireAdmin } from "../../../_utils";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
const MAX_SERIALIZABLE_RETRIES = 3;

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

  const creditHistory = await prisma.tokenLedger.findMany({
    where: { userId: id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      delta: true,
      reason: true,
      metadata: true,
      createdAt: true,
      packPurchase: {
        select: {
          id: true,
          pack: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      booking: {
        select: {
          id: true,
          class: {
            select: {
              title: true,
              date: true,
            },
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

    creditHistory: creditHistory.map((entry) => ({
      id: entry.id,
      delta: entry.delta,
      reason: entry.reason,
      metadata: entry.metadata,
      createdAt: entry.createdAt,
      packPurchase: entry.packPurchase ?? null,
      booking: entry.booking ?? null,
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
    const actor = await getUserFromSession(req);
    let result: Awaited<
      ReturnType<typeof applyAdminAffiliationAndWellhubSync>
    > | null = null;

    for (let attempt = 1; attempt <= MAX_SERIALIZABLE_RETRIES; attempt += 1) {
      try {
        result = await prisma.$transaction(
          (tx) =>
            applyAdminAffiliationAndWellhubSync(tx, {
              userId: id,
              nextAffiliation: normalized.affiliation,
              nextWellhubPlan: normalized.wellhubPlan,
              adminActorId: actor?.id ?? null,
            }),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        );
        break;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2034" &&
          attempt < MAX_SERIALIZABLE_RETRIES
        ) {
          continue;
        }

        throw error;
      }
    }

    if (!result) {
      return j(409, {
        ok: false,
        message: "No se pudo sincronizar la afiliacion. Intenta de nuevo.",
      });
    }

    return j(200, {
      ok: true,
      user: result.user,
      tokenBalance: result.tokenBalance,
      wellhubSync: {
        previousBalance: result.previousBalance,
        tokenBalance: result.tokenBalance,
        previousAffiliation: result.previousAffiliation,
        newAffiliation: result.newAffiliation,
        previousWellhubPlan: result.previousWellhubPlan,
        newWellhubPlan: result.newWellhubPlan,
        previousMonthlyEntitlement: result.previousMonthlyEntitlement,
        newMonthlyEntitlement: result.newMonthlyEntitlement,
        creditDeltaApplied: result.creditDeltaApplied,
        traceabilityCreated: result.traceabilityCreated,
        ledgerEntryId: result.ledgerEntryId,
        cycleId: result.cycleId,
      },
    });
  } catch (error) {
    if (error instanceof CorporateCreditError && error.code === "USER_NOT_FOUND") {
      return j(404, {
        ok: false,
        message: "Usuario no encontrado",
      });
    }

    if (
      error instanceof CorporateCreditError &&
      error.code === "INSUFFICIENT_WELLHUB_CREDITS"
    ) {
      return j(409, {
        ok: false,
        message:
          "No se pudo ajustar el saldo WellHub porque los creditos cambiaron durante la operacion.",
      });
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return j(404, {
        ok: false,
        message: "Usuario no encontrado",
      });
    }

    console.error("PATCH /api/admin/users/[id]/details error:", error);
    return j(500, {
      ok: false,
      message: "No se pudo actualizar la afiliacion.",
    });
  }
}
