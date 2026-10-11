import { NextRequest, NextResponse } from "next/server";
import { prisma, requireAdmin, requireClassManager } from "../../_utils";
import { businessClassDay } from "@/lib/unlimited-calendar";
import { Prisma } from "@prisma/client";
import { executeClassDeletion } from "@/lib/class-deletion-response";
import { syncWellhubClassSafely } from "@/lib/wellhub/booking/sync";
import { withoutWellhubClassIdentifiers } from "@/lib/wellhub/booking/serialize";

export const runtime = "nodejs";

import { zonedTimeToUtc, utcToZonedTime } from "date-fns-tz";

const USER_TZ = "America/Monterrey";


// Tipar el contexto con params async (App Router)
type Ctx = { params: Promise<{ id: string }> };

function j(status: number, body: any) {
  return NextResponse.json(body, { status });
}

async function hasUnlimitedDateConflict(classId: string, date: unknown) {
  if (!(date instanceof Date)) return false;
  const day = businessClassDay(date).serviceDate;
  return Boolean(await prisma.unlimitedUsage.findFirst({ where: { booking: { classId }, releasedAt: null, serviceDate: { not: day } }, select: { id: true } }));
}
function dateConflict() { return j(409, { code: "CLASS_HAS_UNLIMITED_USAGE", error: "CLASS_HAS_UNLIMITED_USAGE", message: "Esta clase tiene usos ilimitados registrados y no puede cambiar de día. Crea otra sesión para la nueva fecha." }); }
function isDateConstraint(error: unknown) { return /CLASS_HAS_UNLIMITED_USAGE/.test(String((error as { meta?: { database_error?: string }; message?: string })?.meta?.database_error ?? (error as { message?: string })?.message)); }

export async function PUT(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  const { id } = await ctx.params;
  const raw = await req.json();

  // Si viene "date" en string, conviértelo a Date
  const { title, focus, durationMin, capacity, instructorId, date } = raw ?? {};
  const data: Prisma.ClassUpdateInput = {};
  if (title !== undefined) data.title = String(title);
  if (focus !== undefined) data.focus = String(focus);
  if (durationMin !== undefined) data.durationMin = Number(durationMin);
  if (capacity !== undefined) data.capacity = Number(capacity);
  if (instructorId !== undefined) {
    data.instructor = { connect: { id: String(instructorId) } };
  }
  if (date) {
    const localLike = String(date).replace("T", " ");
    data.date = zonedTimeToUtc(localLike, USER_TZ);
  }

  const existing = await prisma.class.findUnique({
    where: { id },
    include: {
      bookings: {
        where: { status: "ACTIVE" },
        select: { quantity: true },
      },
    },
  });
  if (!existing || existing.deletedAt) {
    return j(404, { error: "CLASS_NOT_FOUND" });
  }

  const usedSpots = existing.bookings.reduce(
    (sum, booking) => sum + (booking.quantity ?? 1),
    0
  );
  if (capacity !== undefined && Number(capacity) < usedSpots) {
    return j(400, { error: "CAPACITY_TOO_SMALL", usedSpots });
  }

  if (await hasUnlimitedDateConflict(id, data.date)) return dateConflict();
  let item;
  try { item = await prisma.class.update({
    where: { id },
    data,
  });

  } catch (error) { if (isDateConstraint(error)) return dateConflict(); throw error; }
  await syncWellhubClassSafely(id);

  return NextResponse.json(withoutWellhubClassIdentifiers(item));
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  const { id } = await ctx.params;
  return executeClassDeletion(id);
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

  if (!cls || cls.deletedAt) {
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




  if (await hasUnlimitedDateConflict(id, data.date)) return dateConflict();
  let updated;
  try { updated = await prisma.class.update({
  where: { id },
  data,
  include: {
    bookings: true,
    instructor: true, // opcional pero recomendado
  },
});

  } catch (error) { if (isDateConstraint(error)) return dateConflict(); throw error; }
  await syncWellhubClassSafely(id);


  return NextResponse.json(withoutWellhubClassIdentifiers(updated));
}
