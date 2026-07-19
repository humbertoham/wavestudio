import { NextRequest, NextResponse } from "next/server";
import { prisma, requireAdmin, requireClassManager } from "../../_utils";
import { Prisma } from "@prisma/client";
import { executeClassDeletion } from "@/lib/class-deletion-response";

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
    select: { deletedAt: true },
  });
  if (!existing || existing.deletedAt) {
    return j(404, { error: "CLASS_NOT_FOUND" });
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

