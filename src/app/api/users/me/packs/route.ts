// src/app/api/users/me/packs/route.ts
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuth } from "@/lib/auth";
import {
  getPaginationWindow,
  parseMyClassesPage,
  type PaginatedResponse,
} from "@/lib/my-classes-pagination";

export const runtime = "nodejs";

type PackPurchaseResponse = {
  id: string;
  createdAt: string;
  expiresAt: string;
  classesLeft: number;
  pausedDays: number;
  pausedUntil: string | null;
  pack: {
    id: string;
    name: string;
    classes: number;
    price: number;
    classesLabel: string | null;
  };
};

export async function GET(req: NextRequest) {
  // 1️⃣ Auth
  const me = await getAuth();
  if (!me) {
    return NextResponse.json(
      { error: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  const requestedPage = parseMyClassesPage(
    new URL(req.url).searchParams.get("page")
  );
  const where = { userId: me.sub };

  const result = await prisma.$transaction(
    async (tx): Promise<PaginatedResponse<PackPurchaseResponse>> => {
      const totalItems = await tx.packPurchase.count({ where });
      const pagination = getPaginationWindow(totalItems, requestedPage);
      const rows = await tx.packPurchase.findMany({
        where,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        skip: pagination.skip,
        take: pagination.take,
        select: {
          id: true,
          createdAt: true,
          expiresAt: true,
          classesLeft: true,
          pausedDays: true,
          pausedUntil: true,
          pack: {
            select: {
              id: true,
              name: true,
              classes: true,
              price: true,
              classesLabel: true,
            },
          },
        },
      });

      return {
        items: rows.map((purchase) => ({
          id: purchase.id,
          createdAt: purchase.createdAt.toISOString(),
          expiresAt: purchase.expiresAt.toISOString(),
          classesLeft: purchase.classesLeft,
          pausedDays: purchase.pausedDays,
          pausedUntil: purchase.pausedUntil?.toISOString() ?? null,
          pack: {
            id: purchase.pack.id,
            name: purchase.pack.name,
            classes: purchase.pack.classes,
            price: purchase.pack.price,
            classesLabel: purchase.pack.classesLabel ?? null,
          },
        })),
        page: pagination.page,
        pageSize: pagination.pageSize,
        totalItems: pagination.totalItems,
        totalPages: pagination.totalPages,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
  );

  return NextResponse.json(result, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
