import { NextRequest, NextResponse } from "next/server";
import { prisma, requireAdmin } from "../_utils";
import type { Prisma } from "@prisma/client";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const pageParam = Number(searchParams.get("page") ?? 1);
  const page = Number.isFinite(pageParam) ? Math.max(Math.floor(pageParam), 1) : 1;
  const pageSizeParam = Number(
    searchParams.get("pageSize") ?? searchParams.get("take") ?? 25
  );
  const pageSize = Number.isFinite(pageSizeParam)
    ? Math.min(Math.max(Math.floor(pageSizeParam), 1), 100)
    : 25;
  const skip = (page - 1) * pageSize;

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

  const [total, items] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({
    where,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      phone: true,
      dateOfBirth: true,
      bookingBlocked: true,
    }, // ✅ conservado
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    }),
  ]);

  return NextResponse.json({
    items,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
}
