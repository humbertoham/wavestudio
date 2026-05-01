import { NextResponse } from "next/server";
import { BookingStatus } from "@prisma/client";

import { getAuth, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { classCreateSchema } from "@/lib/zod";

export const runtime = "nodejs";

/**
 * GET /api/classes?from=ISO&to=ISO&focus=...
 */
export async function GET(req: Request) {
  const auth = await getAuth();
  const userId = auth?.sub ?? null;

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const focus = searchParams.get("focus") ?? undefined;

  let gte = from ? new Date(from) : new Date();
  if (Number.isNaN(gte.getTime())) gte = new Date();

  let lt: Date | undefined;
  if (to) {
    const toDate = new Date(to);
    if (!Number.isNaN(toDate.getTime())) lt = toDate;
  }

  const where: {
    date: {
      gte: Date;
      lt?: Date;
    };
    focus?: string;
  } = {
    date: {
      gte,
      ...(lt ? { lt } : {}),
    },
  };

  if (focus) where.focus = focus;

  const classes = await prisma.class.findMany({
    where,
    include: {
      instructor: true,
      bookings: {
        where: { status: BookingStatus.ACTIVE },
        select: {
          id: true,
          quantity: true,
          userId: true,
        },
      },
      waitlist: {
        where: {
          userId: userId ?? "__anonymous__",
        },
        select: {
          id: true,
        },
        take: 1,
      },
    },
    orderBy: { date: "asc" },
  });

  const payload = classes.map((klass) => {
    const capacity = klass.capacity ?? null;

    const booked = Array.isArray(klass.bookings)
      ? klass.bookings.reduce(
          (sum, booking) => sum + (booking.quantity ?? 0),
          0
        )
      : null;

    const isFull =
      typeof capacity === "number" && typeof booked === "number"
        ? booked >= capacity
        : false;

    const userHasBooking =
      userId != null
        ? klass.bookings.some((booking) => booking.userId === userId)
        : false;

    const userBooking =
      userId != null
        ? klass.bookings.find((booking) => booking.userId === userId)
        : undefined;

    const userWaitlistEntry =
      userId != null && klass.waitlist.length > 0
        ? klass.waitlist[0]
        : undefined;

    return {
      id: klass.id,
      title: klass.title ?? "Clase",
      focus: klass.focus ?? null,
      coach: klass.instructor?.name ?? "-",
      startsAt: klass.date.toISOString(),
      durationMin: klass.durationMin ?? 60,
      creditCost: Math.max(1, klass.creditCost ?? 1),
      capacity,
      booked,
      isFull,
      isCanceled: klass.isCanceled ?? false,
      userHasBooking,
      bookingId: userBooking?.id ?? null,
      userOnWaitlist: !!userWaitlistEntry,
      waitlistEntryId: userWaitlistEntry?.id ?? null,
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
    await requireAdmin();

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
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "INTERNAL";
    const code =
      message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;

    return NextResponse.json({ error: message }, { status: code });
  }
}
