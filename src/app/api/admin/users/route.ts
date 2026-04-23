import { NextRequest, NextResponse } from "next/server";
import { prisma, requireAdmin } from "../_utils";
import type { Prisma } from "@prisma/client";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const takeParam = Number(searchParams.get("take") ?? 25);
  const take = Number.isFinite(takeParam) ? Math.min(Math.max(takeParam, 1), 100) : 25;

  // 👇 Tipado explícito para evitar el error de unión en OR
  const where: Prisma.UserWhereInput | undefined = q
    ? {
        OR: [
          { name:  { contains: q, mode: "insensitive" } as Prisma.StringFilter },
          { email: { contains: q, mode: "insensitive" } as Prisma.StringFilter },
          { phone: { contains: q, mode: "insensitive" } as Prisma.StringFilter },
        ],
      }
    : undefined;

  const items = await prisma.user.findMany({
    where,
    select: {
      id: true,
      name: true,
      email: true,
      dateOfBirth: true,
      bookingBlocked: true,
    }, // ✅ conservado
    orderBy: { createdAt: "desc" },
    take,
  });

  return NextResponse.json({ items });
}
