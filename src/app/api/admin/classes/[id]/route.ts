import { NextRequest, NextResponse } from "next/server";
import { prisma, requireAdmin, requireClassManager } from "../../_utils";
import { Prisma } from "@prisma/client";
import {
  countActiveClassDependencies,
  inactiveBookingWhere,
} from "@/lib/class-deletion";

export const runtime = "nodejs";

import { zonedTimeToUtc, utcToZonedTime } from "date-fns-tz";

const USER_TZ = "America/Monterrey";


// Tipar el contexto con params async (App Router)
type Ctx = { params: Promise<{ id: string }> };

function j(status: number, body: any) {
  return NextResponse.json(body, { status });
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  const { id } = await ctx.params;
  const raw = await req.json();

  // Si viene "date" en string, conviértelo a Date
  const { date, ...rest } = raw ?? {};
  const data: any = { ...rest };
  if (date) {
  const localLike = date.replace("T", " ");
  data.date = zonedTimeToUtc(localLike, USER_TZ);
}

  const item = await prisma.class.update({
    where: { id },
    data,
  });

  return NextResponse.json(item);
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  const { id } = await ctx.params;

  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          const cls = await tx.class.findUnique({
            where: { id },
            select: { id: true },
          });

          if (!cls) return { outcome: "not_found" as const };

          const dependencies = await countActiveClassDependencies(tx, id);

          if (
            dependencies.activeBookingCount > 0 ||
            dependencies.activeWaitlistCount > 0
          ) {
            return {
              outcome: "blocked" as const,
              ...dependencies,
            };
          }

          const inactiveBookingCount = await tx.booking.count({
            where: inactiveBookingWhere(id),
          });

          if (inactiveBookingCount > 0) {
            // Preserve cancelled bookings, attendance, refunds, and ledger/audit
            // relations. isCanceled is the existing flag excluded by the admin
            // list and checked by every booking and waitlist creation flow.
            await tx.class.update({
              where: { id },
              data: { isCanceled: true },
            });

            return {
              outcome: "archived" as const,
              inactiveBookingCount,
            };
          }

          await tx.class.delete({ where: { id } });
          return { outcome: "deleted" as const };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );

      if (result.outcome === "not_found") {
        return j(404, {
          ok: false,
          code: "CLASS_NOT_FOUND",
          message: "La clase no existe o ya fue eliminada.",
        });
      }

      if (result.outcome === "blocked") {
        return j(409, {
          ok: false,
          code: "CLASS_HAS_ACTIVE_DEPENDENCIES",
          message:
            "No se puede eliminar la clase porque todavía tiene reservas activas o personas en lista de espera.",
          details: {
            activeBookingCount: result.activeBookingCount,
            activeWaitlistCount: result.activeWaitlistCount,
          },
        });
      }

      if (result.outcome === "archived") {
        return NextResponse.json({
          ok: true,
          hardDeleted: false,
          archived: true,
          preservedInactiveBookingCount: result.inactiveBookingCount,
        });
      }

      return NextResponse.json({
        ok: true,
        hardDeleted: true,
        archived: false,
      });
    } catch (error: unknown) {
      const concurrentWrite =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2034" || error.code === "P2003");

      if (concurrentWrite && attempt < maxAttempts) continue;

      if (concurrentWrite) {
        return j(409, {
          ok: false,
          code: "CLASS_DELETE_CONFLICT",
          message:
            "La clase cambió mientras se intentaba eliminar. Intenta nuevamente.",
        });
      }

      console.error("DELETE /classes/:id error", error);
      return j(500, {
        ok: false,
        code: "UNEXPECTED_ERROR",
        message: "No se pudo eliminar la clase.",
      });
    }
  }

  return j(409, {
    ok: false,
    code: "CLASS_DELETE_CONFLICT",
    message: "La clase cambió mientras se intentaba eliminar. Intenta nuevamente.",
  });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const auth = await requireClassManager(req);
  if (auth) return auth;

  const { id } = await ctx.params;
  const raw = await req.json();

  const {
    title,
    focus,
    durationMin,
    capacity,
    instructorId,
    time, // "HH:MM" desde la UI
  } = raw ?? {};

  // 1️⃣ Cargar clase + bookings activos
  const cls = await prisma.class.findUnique({
    where: { id },
    include: {
      bookings: {
        where: { status: "ACTIVE" },
      },
    },
  });

  if (!cls) {
    return j(404, { error: "CLASS_NOT_FOUND" });
  }

  // 2️⃣ Validar cupo
  const usedSpots = cls.bookings.reduce(
    (acc, b) => acc + (b.quantity ?? 1),
    0
  );

  if (capacity !== undefined && capacity < usedSpots) {
    return j(400, {
      error: "CAPACITY_TOO_SMALL",
      usedSpots,
    });
  }

  // 3️⃣ Construir update seguro (whitelist)
  const data: any = {};

  if (title !== undefined) data.title = title;
  if (focus !== undefined) data.focus = focus;
  if (durationMin !== undefined) data.durationMin = durationMin;
  if (capacity !== undefined) data.capacity = capacity;
  if (instructorId !== undefined) data.instructorId = instructorId;

  if (durationMin !== undefined) {
  data.durationMin = Number(durationMin);
}

  if (capacity !== undefined) {
  data.capacity = Number(capacity);
}


  // 4️⃣ Cambio de hora (sin cambiar fecha)
  // 4️⃣ Cambio de hora respetando zona México
if (time) {
  const [hh, mm] = String(time).split(":").map(Number);

  if (Number.isFinite(hh) && Number.isFinite(mm)) {
    const originalUTC = new Date(cls.date);

    // Convertimos UTC guardado → hora local México
    const mexicoZoned = utcToZonedTime(originalUTC, USER_TZ);

    const yyyy = mexicoZoned.getFullYear();
    const MM = String(mexicoZoned.getMonth() + 1).padStart(2, "0");
    const dd = String(mexicoZoned.getDate()).padStart(2, "0");

    const HH = String(hh).padStart(2, "0");
    const mmStr = String(mm).padStart(2, "0");

    const localLike = `${yyyy}-${MM}-${dd} ${HH}:${mmStr}`;

    // Convertimos México → UTC real
    const utcDate = zonedTimeToUtc(localLike, USER_TZ);

    data.date = utcDate;
  }
}




  const updated = await prisma.class.update({
  where: { id },
  data,
  include: {
    bookings: true,
    instructor: true, // opcional pero recomendado
  },
});


  return NextResponse.json(updated);
}

