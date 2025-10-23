// /src/app/api/classes/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { classCreateSchema } from "@/lib/zod";
import { BookingStatus } from "@prisma/client";

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
 *   booked?: number | null; // SUM(quantity) de bookings ACTIVE
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
      lt: to ? new Date(to) : undefined, // to exclusivo
    };
  }
  if (focus) where.focus = focus;

  const classes = await prisma.class.findMany({
    where,
    include: {
      instructor: true, // instructor.name
      bookings: {
        where: { status: BookingStatus.ACTIVE },
        select: { quantity: true },
      },
    },
    orderBy: { date: "asc" },
  });

  const payload = classes.map((c) => {
    const capacity: number | null = (c as any).capacity ?? null;

    // SUMA quantity (no length)
    const booked: number | null = Array.isArray((c as any).bookings)
      ? (c as any).bookings.reduce(
          (sum: number, b: { quantity: number | null }) => sum + (b.quantity ?? 0),
          0
        )
      : null;

    const isFull =
      typeof capacity === "number" && typeof booked === "number"
        ? booked >= capacity
        : false;

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
    headers: { "Cache-Control": "no-store" },
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
    const code =
      e.message === "UNAUTHORIZED" ? 401 :
      e.message === "FORBIDDEN"   ? 403 : 500;
    return NextResponse.json({ error: e.message }, { status: code });
  }
}
