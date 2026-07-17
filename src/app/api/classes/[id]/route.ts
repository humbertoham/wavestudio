import { NextRequest, NextResponse } from "next/server";
import { prisma, requireClassManager } from "../../admin/_utils";
import { getNewUserBookingIds } from "@/lib/new-user";
import { executeClassDeletion } from "@/lib/class-deletion-response";

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

  if (!cls || cls.deletedAt) {
    return NextResponse.json(
      { error: "NOT_FOUND" },
      { status: 404 }
    );
  }

  const newUserBookingIds = await getNewUserBookingIds(
    prisma,
    cls.bookings,
    cls.isCanceled
  );

  return NextResponse.json({
    ...cls,
    bookings: cls.bookings.map((booking) => {
      const isNewUser = newUserBookingIds.has(booking.id);

      return {
        ...booking,
        isNewUser,
        // Backward-compatible alias for existing class-management clients.
        isFirstBooking: isNewUser,
      };
    }),
  });
}

/**
 * =========================
 * DELETE /api/classes/:id
 * Eliminar clase (ADMIN/COACH)
 * =========================
 */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const auth = await requireClassManager(req);
  if (auth) return auth;

  const { id } = await ctx.params;
  return executeClassDeletion(id);
}
