import { NextRequest, NextResponse } from "next/server";
import { prisma, requireAdmin } from "../../_utils";
import { Prisma } from "@prisma/client";

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

  // 1) Validación rápida: ¿hay dependencias?
  const [bookings, waiters] = await Promise.all([
    prisma.booking.count({ where: { classId: id, status: "ACTIVE" } }),
    prisma.waitlist.count({ where: { classId: id } }),
  ]);

  // Si quieres BLOQUEAR el borrado duro cuando existan dependencias,
  // descomenta este bloque para devolver 409 en lugar de intentar borrar:
  /*
  if (bookings > 0 || waiters > 0) {
    return j(409, {
      ok: false,
      code: "CLASS_HAS_DEPENDENCIES",
      message:
        "No se puede eliminar la clase porque tiene reservas o lista de espera. Cancélala (isCanceled=true) o elimina primero las dependencias.",
      details: { bookings, waitlist: waiters },
    });
  }
  */

  try {
    // 2) Intento de hard delete (si no hay dependencias, esto pasa sin problema)
    await prisma.class.delete({ where: { id } });
    return NextResponse.json({ ok: true, hardDeleted: true });
  } catch (e: unknown) {
    // 3) Si truena por FK, hacemos soft delete en su lugar
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2003" // Foreign key constraint failed
    ) {
      // Soft delete: marcar cancelada para que no aparezca como disponible
      const updated = await prisma.class.update({
        where: { id },
        data: { isCanceled: true },
      });

      return j(200, {
        ok: true,
        hardDeleted: false,
        softDeleted: true,
        reason: "FOREIGN_KEY_CONSTRAINT",
        message:
          "La clase tenía dependencias (reservas/lista de espera). Se marcó como cancelada (isCanceled=true).",
        class: { id: updated.id, isCanceled: updated.isCanceled },
        dependencies: { bookings, waitlist: waiters },
      });
    }

    // Otros errores: regresarlos con detalle para depurar sin 500 silencioso
    console.error("DELETE /classes/:id error", e);
    return j(500, {
      ok: false,
      code: "UNEXPECTED_ERROR",
      message: "No se pudo eliminar la clase.",
    });
  }
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin(req);
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

