// src/app/api/admin/bookings/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth"; // o getAuth + check de role

export const runtime = "nodejs";

const bodySchema = z.object({
  userId: z.string().min(1),
  classId: z.string().min(1),
});

export async function POST(req: Request) {
  // 1) AuthZ
  const me = await requireAdmin().catch(() => null);
  if (!me) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  // 2) Parse
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const { userId, classId } = parsed.data;

  // 3) Carga entidades mínimas
  const [klass, user] = await Promise.all([
    prisma.class.findUnique({
      where: { id: classId },
      select: { id: true, date: true, capacity: true },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    }),
  ]);

  if (!klass) return NextResponse.json({ error: "CLASS_NOT_FOUND" }, { status: 404 });
  if (!user)  return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 });

  // 4) Reglas de negocio
  if (klass.date < new Date()) {
    return NextResponse.json({ error: "CLASS_IN_PAST" }, { status: 409 });
  }

  // Capacidad (cuenta SOLO activas)
  const activeCount = await prisma.booking.count({
    where: { classId, status: "ACTIVE" },
  });
  if (typeof klass.capacity === "number" && activeCount >= klass.capacity) {
    return NextResponse.json({ error: "CLASS_FULL" }, { status: 409 });
  }

  // 5) Crear (maneja unique conflict si ya está inscrito)
  try {
    const booking = await prisma.booking.create({
      data: {
        userId,
        classId,
        status: "ACTIVE",
      },
      include: {
        class: { select: { id: true, title: true, date: true } },
        user: { select: { id: true, email: true } },
      },
    });

    return NextResponse.json(
      { ok: true, booking },
      { status: 201, headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    // Prisma conflict: P2002 → unique constraint failed
    if (e?.code === "P2002") {
      return NextResponse.json({ error: "ALREADY_ENROLLED" }, { status: 409 });
    }
    console.error("BOOKING_CREATE_ERROR", e);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
