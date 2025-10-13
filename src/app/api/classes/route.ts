// /src/app/api/classes/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { classCreateSchema } from "@/lib/zod";

export const runtime = "nodejs";

/**
 * GET /api/classes?from=ISO&to=ISO&focus=...
 *
 * Respuesta (ApiSession[]):
 * {
 *   id: string;
 *   title: string;
 *   focus?: string | null;
 *   coach: string;
 *   startsAt: string;      // ISO
 *   durationMin: number;   // default 60 si no existe
 *   capacity?: number | null;
 *   booked?: number | null;
 *   isFull?: boolean | null;
 * }
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const focus = searchParams.get("focus") ?? undefined;

  const where: any = {};
  if (from || to) {
    where.date = {
      gte: from ? new Date(from) : undefined,
      lt:  to   ? new Date(to)   : undefined, // usamos lt para que el to sea exclusivo
    };
  }
  if (focus) where.focus = focus;

  // Ajusta los nombres de campos a tu esquema real de Prisma
  const classes = await prisma.class.findMany({
    where,
    include: {
      instructor: true,   // se asume instructor.name
      bookings: true,     // se asume para contar lugares tomados
    },
    orderBy: { date: "asc" },
  });

  const payload = classes.map((c) => {
    const capacity = (c as any).capacity ?? null;
    const booked = Array.isArray((c as any).bookings) ? (c as any).bookings.length : null;
    const isFull =
      (c as any).isFull ??
      (typeof capacity === "number" && typeof booked === "number" ? booked >= capacity : null);

    return {
      id: c.id,
      title: (c as any).title ?? "Clase",
      focus: (c as any).focus ?? null,
      coach: (c as any).instructor?.name ?? "—",
      startsAt: c.date.toISOString(),
      durationMin: (c as any).durationMin ?? 60,
      capacity,
      booked,
      isFull,
    };
  });

  return NextResponse.json(payload, {
    // Evita cachear en el edge/navegador si lo deseas
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(req: Request) {
  try {
    requireAdmin();
    const body = await req.json();
    const parsed = classCreateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "INVALID" }, { status: 400 });

    const { date, ...rest } = parsed.data;
    const cls = await prisma.class.create({
      data: { ...rest, date: new Date(date) },
    });
    return NextResponse.json(cls, { status: 201 });
  } catch (e: any) {
    const code = e.message === "UNAUTHORIZED" ? 401 : e.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: e.message }, { status: code });
  }
}
