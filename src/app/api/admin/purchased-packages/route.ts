import { NextRequest, NextResponse } from "next/server";

import { prisma, requireAdmin } from "../_utils";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  const { searchParams } = new URL(req.url);
  const pageParam = Number(searchParams.get("page") ?? 1);
  const page = Number.isFinite(pageParam) ? Math.max(Math.floor(pageParam), 1) : 1;
  const pageSizeParam = Number(searchParams.get("pageSize") ?? 20);
  const pageSize = Number.isFinite(pageSizeParam)
    ? Math.min(Math.max(Math.floor(pageSizeParam), 1), 100)
    : 20;
  const skip = (page - 1) * pageSize;

  const [total, rows] = await prisma.$transaction([
    prisma.packPurchase.count(),
    prisma.packPurchase.findMany({
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      select: {
        id: true,
        createdAt: true,
        classesLeft: true,
        expiresAt: true,
        user: {
          select: {
            name: true,
            email: true,
          },
        },
        pack: {
          select: {
            name: true,
            classes: true,
            price: true,
          },
        },
        payment: {
          select: {
            provider: true,
            status: true,
            amount: true,
            currency: true,
          },
        },
        ledgerEntries: {
          where: { delta: { gt: 0 } },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: {
            delta: true,
            reason: true,
          },
        },
      },
    }),
  ]);

  return NextResponse.json({
    items: rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      classesLeft: row.classesLeft,
      classesPurchased: row.ledgerEntries[0]?.delta ?? row.pack.classes,
      creditReason: row.ledgerEntries[0]?.reason ?? null,
      user: row.user,
      pack: row.pack,
      payment: row.payment
        ? {
            provider: row.payment.provider,
            status: row.payment.status,
            amount: row.payment.amount,
            currency: row.payment.currency,
          }
        : null,
    })),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
}
