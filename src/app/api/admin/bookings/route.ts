// src/app/api/admin/bookings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma, requireAdmin } from "../_utils";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  const { searchParams } = new URL(req.url);
  const classId = searchParams.get("classId") ?? undefined;
  const rawTake = Number(searchParams.get("take") ?? 500);
  const take = Number.isFinite(rawTake)
    ? Math.min(Math.max(Math.floor(rawTake), 1), 500)
    : 500;

  const items = await prisma.booking.findMany({
    where: classId ? { classId } : undefined,
    orderBy: { createdAt: "desc" },
    take,
    include: {
      user: { select: { id: true, name: true, email: true } },
      class: {
        select: {
          id: true,
          title: true,
          date: true,
          instructor: { select: { id: true, name: true } },
        },
      },
    },
  });

  return NextResponse.json({ items });
}
