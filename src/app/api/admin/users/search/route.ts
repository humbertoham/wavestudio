import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

import { prisma, requireAdmin } from "../../_utils";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const rawLimit = Number(searchParams.get("limit") ?? "20");
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), 20)
    : 20;

  const digits = q.replace(/\D/g, "");

  const filters: Prisma.UserWhereInput[] = [];

  if (q) {
    filters.push(
      { name: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } }
    );
  }

  if (digits) {
    filters.push({ phone: { contains: digits, mode: "insensitive" } });
  } else if (q) {
    filters.push({ phone: { contains: q, mode: "insensitive" } });
  }

  const items = await prisma.user.findMany({
    where: filters.length > 0 ? { OR: filters } : undefined,
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      affiliation: true,
      bookingBlocked: true,
    },
    orderBy: q
      ? [{ name: "asc" }, { createdAt: "desc" }]
      : [{ createdAt: "desc" }],
    take: limit,
  });

  return NextResponse.json({ items });
}
