import { NextRequest, NextResponse } from "next/server";
import { prisma, requireAdmin, requireClassManager } from "../../admin/_utils";

type Ctx = {
  params: Promise<{ id: string }>;
};

/**
 * =========================
 * GET /api/classes/:id
 * Detalle de clase (ADMIN/COACH)
 * =========================
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const auth = await requireClassManager(req);
  if (auth) return auth;

  const { id } = await ctx.params;

  const cls = await prisma.class.findUnique({
    where: { id },
    include: {
      instructor: true,
      bookings: {
        orderBy: [{ createdAt: "desc" }],
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              affiliation: true,
            },
          },
        },
      },
      waitlist: {
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              affiliation: true,
            },
          },
        },
      },
    },
  });

  if (!cls) {
    return NextResponse.json(
      { error: "NOT_FOUND" },
      { status: 404 }
    );
  }

  const bookedUserIds = Array.from(
    new Set(
      cls.bookings
        .map((booking) => booking.userId)
        .filter((userId): userId is string => Boolean(userId))
    )
  );

  const bookingHistory = bookedUserIds.length
    ? await prisma.booking.findMany({
        where: {
          userId: { in: bookedUserIds },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          userId: true,
        },
      })
    : [];

  const firstBookingIdByUserId = new Map<string, string>();
  for (const booking of bookingHistory) {
    if (booking.userId && !firstBookingIdByUserId.has(booking.userId)) {
      firstBookingIdByUserId.set(booking.userId, booking.id);
    }
  }

  // NEW USER is tied to the first-ever reservation row, even if that first
  // reservation was later canceled, so later bookings do not show the label.
  return NextResponse.json({
    ...cls,
    bookings: cls.bookings.map((booking) => ({
      ...booking,
      isFirstBooking:
        !!booking.userId &&
        firstBookingIdByUserId.get(booking.userId) === booking.id,
    })),
  });
}

/**
 * =========================
 * DELETE /api/classes/:id
 * Eliminar clase (ADMIN)
 * =========================
 */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  const { id } = await ctx.params;

  const [bookings, waitlist] = await Promise.all([
    prisma.booking.count({ where: { classId: id, status: "ACTIVE" } }),
    prisma.waitlist.count({ where: { classId: id } }),
  ]);

  if (bookings > 0 || waitlist > 0) {
    return NextResponse.json(
      {
        code: "CLASS_HAS_DEPENDENCIES",
        details: { bookings, waitlist },
      },
      { status: 409 }
    );
  }

  try {
    await prisma.class.delete({
      where: { id },
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    // Prisma: registro no encontrado
    if (e?.code === "P2025") {
      return NextResponse.json(
        { error: "NOT_FOUND" },
        { status: 404 }
      );
    }

    if (e?.code === "P2003") {
      return NextResponse.json(
        {
          code: "CLASS_HAS_DEPENDENCIES",
          details: { bookings, waitlist },
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: "ERROR" },
      { status: 500 }
    );
  }
}
