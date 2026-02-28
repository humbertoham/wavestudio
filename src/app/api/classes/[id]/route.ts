import { NextRequest, NextResponse } from "next/server";
import { prisma, requireAdmin } from "../../admin/_utils";

type Ctx = {
  params: Promise<{ id: string }>;
};

/**
 * =========================
 * GET /api/classes/:id
 * Detalle de clase (ADMIN)
 * =========================
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  const { id } = await ctx.params;

  const cls = await prisma.class.findUnique({
    where: { id },
    include: {
      instructor: true,
      bookings: {
        where: { status: "ACTIVE" },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              affiliation: true,
            },
          },
        },
      },
      waitlist: {
        orderBy: { position: "asc" },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
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

  return NextResponse.json(cls);
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

    return NextResponse.json(
      { error: "ERROR" },
      { status: 500 }
    );
  }
}
