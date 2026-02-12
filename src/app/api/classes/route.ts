// /src/app/api/classes/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, getAuth } from "@/lib/auth";
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
 *   startsAt: string;
 *   durationMin: number;
 *   capacity?: number | null;
 *   booked?: number | null;
 *   isFull?: boolean | null;
 *   isCanceled?: boolean;
 *   userHasBooking?: boolean;
 * }
 */
export async function GET(req: Request) {
  const auth = await getAuth(); // 👈 detectar usuario actual
  const userId = auth?.sub ?? null;

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const focus = searchParams.get("focus") ?? undefined;

  const now = new Date();

  let gte = from ? new Date(from) : now;
  if (isNaN(gte.getTime())) gte = now;
  if (gte < now) gte = now;

  let lt: Date | undefined = undefined;
  if (to) {
    const toDate = new Date(to);
    if (!isNaN(toDate.getTime())) lt = toDate;
  }

  if (lt && lt <= now) {
    return NextResponse.json([], {
      headers: { "Cache-Control": "no-store" },
    });
  }

  const where: any = {
    date: { gte, lt },
  };

  if (focus) where.focus = focus;

  const classes = await prisma.class.findMany({
    where,
    include: {
      instructor: true,
      bookings: {
        where: { status: BookingStatus.ACTIVE },
        select: {
          quantity: true,
          userId: true, // 👈 necesario para detectar booking propio
        },
      },
    },
    orderBy: { date: "asc" },
  });

  const payload = classes.map((c) => {
    const capacity: number | null = c.capacity ?? null;

    const booked: number | null = Array.isArray(c.bookings)
      ? c.bookings.reduce(
          (sum: number, b) => sum + (b.quantity ?? 0),
          0
        )
      : null;

    const isFull =
      typeof capacity === "number" && typeof booked === "number"
        ? booked >= capacity
        : false;

    const userHasBooking =
      userId != null
        ? c.bookings.some((b) => b.userId === userId)
        : false;

    return {
      id: c.id,
      title: c.title ?? "Clase",
      focus: c.focus ?? null,
      coach: c.instructor?.name ?? "—",
      startsAt: c.date.toISOString(),
      durationMin: c.durationMin ?? 60,
      capacity,
      booked,
      isFull,
      isCanceled: c.isCanceled ?? false,
      userHasBooking, // 👈 NUEVO
    };
  });

  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * POST /api/classes
 * Solo admin
 */
export async function POST(req: Request) {
  try {
    requireAdmin();

    const body = await req.json();
    const parsed = classCreateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "INVALID" }, { status: 400 });
    }

    const { date, ...rest } = parsed.data;

    const cls = await prisma.class.create({
      data: {
        ...rest,
        date: new Date(date),
      },
    });

    return NextResponse.json(cls, { status: 201 });
  } catch (e: any) {
    const code =
      e.message === "UNAUTHORIZED"
        ? 401
        : e.message === "FORBIDDEN"
        ? 403
        : 500;

    return NextResponse.json({ error: e.message }, { status: code });
  }
}
