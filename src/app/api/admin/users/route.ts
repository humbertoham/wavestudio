import { NextRequest, NextResponse } from "next/server";
import { prisma, requireAdmin } from "../_utils";
import { Affiliation, type Prisma, WellhubPlan } from "@prisma/client";

function parseAffiliation(value: string | null): Affiliation | null {
  if (value === Affiliation.NONE) return Affiliation.NONE;
  if (value === Affiliation.WELLHUB) return Affiliation.WELLHUB;
  if (value === Affiliation.TOTALPASS) return Affiliation.TOTALPASS;
  return null;
}

function parseWellhubPlan(value: string | null): WellhubPlan | null {
  if (value === WellhubPlan.GOLD_PLUS) return WellhubPlan.GOLD_PLUS;
  if (value === WellhubPlan.PLATINUM) return WellhubPlan.PLATINUM;
  if (value === WellhubPlan.DIAMOND) return WellhubPlan.DIAMOND;
  if (value === WellhubPlan.DIAMOND_PLUS) return WellhubPlan.DIAMOND_PLUS;
  return null;
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const affiliation = parseAffiliation(searchParams.get("affiliation"));
  const wellhubPlan = parseWellhubPlan(searchParams.get("wellhubPlan"));
  const pageParam = Number(searchParams.get("page") ?? 1);
  const page = Number.isFinite(pageParam) ? Math.max(Math.floor(pageParam), 1) : 1;
  const pageSizeParam = Number(
    searchParams.get("pageSize") ?? searchParams.get("take") ?? 25
  );
  const pageSize = Number.isFinite(pageSizeParam)
    ? Math.min(Math.max(Math.floor(pageSizeParam), 1), 100)
    : 25;
  const skip = (page - 1) * pageSize;

  const and: Prisma.UserWhereInput[] = [];

  if (q) {
    and.push({
      OR: [
        { name: { contains: q, mode: "insensitive" } as Prisma.StringFilter },
        { email: { contains: q, mode: "insensitive" } as Prisma.StringFilter },
        { phone: { contains: q, mode: "insensitive" } as Prisma.StringFilter },
      ],
    });
  }

  if (affiliation) {
    and.push({ affiliation });
  }

  if (wellhubPlan) {
    and.push({ wellhubPlan });
  }

  const where: Prisma.UserWhereInput | undefined =
    and.length > 0 ? { AND: and } : undefined;

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
      affiliation: true,
      wellhubPlan: true,
      affiliationConfirmedAt: true,
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
