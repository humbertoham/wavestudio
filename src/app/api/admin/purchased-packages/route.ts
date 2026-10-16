import { NextRequest, NextResponse } from "next/server";
import { Affiliation, PaymentStatus, Prisma } from "@prisma/client";

import { prisma, requireAdmin } from "../_utils";

export const runtime = "nodejs";

type PaymentStatusFilter = PaymentStatus | "NO_PAYMENT";
type RemainingFilter = "ACTIVE" | "ZERO";

function parsePositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), 1), max);
}

function parsePaymentStatus(value: string | null): PaymentStatusFilter | null {
  if (value === "NO_PAYMENT") return "NO_PAYMENT";
  if (value === PaymentStatus.PENDING) return PaymentStatus.PENDING;
  if (value === PaymentStatus.APPROVED) return PaymentStatus.APPROVED;
  if (value === PaymentStatus.REJECTED) return PaymentStatus.REJECTED;
  if (value === PaymentStatus.REFUNDED) return PaymentStatus.REFUNDED;
  if (value === PaymentStatus.CANCELED) return PaymentStatus.CANCELED;
  return null;
}

function parseAffiliation(value: string | null): Affiliation | null {
  if (value === Affiliation.NONE) return Affiliation.NONE;
  if (value === Affiliation.WELLHUB) return Affiliation.WELLHUB;
  if (value === Affiliation.TOTALPASS) return Affiliation.TOTALPASS;
  return null;
}

function parseRemaining(value: string | null): RemainingFilter | null {
  if (value === "ACTIVE") return "ACTIVE";
  if (value === "ZERO") return "ZERO";
  return null;
}

function parseDateStart(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseDateEndExclusive(value: string | null) {
  const start = parseDateStart(value);
  if (!start) return null;
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  const { searchParams } = new URL(req.url);
  const page = parsePositiveInt(searchParams.get("page"), 1, 100000);
  const pageSize = parsePositiveInt(searchParams.get("pageSize"), 20, 100);
  const skip = (page - 1) * pageSize;
  const q = (searchParams.get("q") ?? "").trim();
  const packQuery = (searchParams.get("pack") ?? "").trim();
  const paymentStatus = parsePaymentStatus(searchParams.get("paymentStatus"));
  const affiliation = parseAffiliation(searchParams.get("affiliation"));
  const remaining = parseRemaining(searchParams.get("remaining"));
  const from = parseDateStart(searchParams.get("from"));
  const to = parseDateEndExclusive(searchParams.get("to"));
  const sort = searchParams.get("sort") === "oldest" ? "asc" : "desc";

  const filters: Prisma.PackPurchaseWhereInput[] = [];

  if (q) {
    filters.push({
      OR: [
        {
          user: {
            is: {
              name: { contains: q, mode: "insensitive" },
            },
          },
        },
        {
          user: {
            is: {
              email: { contains: q, mode: "insensitive" },
            },
          },
        },
      ],
    });
  }

  if (packQuery) {
    filters.push({
      pack: {
        is: {
          name: { contains: packQuery, mode: "insensitive" },
        },
      },
    });
  }

  if (paymentStatus === "NO_PAYMENT") {
    filters.push({ payment: { is: null } });
  } else if (paymentStatus) {
    filters.push({
      payment: {
        is: {
          status: paymentStatus,
        },
      },
    });
  }

  if (affiliation) {
    filters.push({
      user: {
        is: {
          affiliation,
        },
      },
    });
  }

  if (remaining === "ACTIVE") {
    filters.push({ classesLeft: { gt: 0 } });
  } else if (remaining === "ZERO") {
    filters.push({ classesLeft: { lte: 0 } });
  }

  if (from || to) {
    filters.push({
      createdAt: {
        ...(from ? { gte: from } : {}),
        ...(to ? { lt: to } : {}),
      },
    });
  }

  const where: Prisma.PackPurchaseWhereInput =
    filters.length > 0 ? { AND: filters } : {};

  const [total, rows] = await prisma.$transaction([
    prisma.packPurchase.count({ where }),
    prisma.packPurchase.findMany({
      where,
      orderBy: { createdAt: sort },
      skip,
      take: pageSize,
      select: {
        id: true,
        createdAt: true,
        classesLeft: true, type: true, unlimitedMonth: true, unlimitedYear: true, nameSnapshot: true, priceSnapshot: true, revokedAt: true,
        expiresAt: true,
        user: {
          select: {
            name: true,
            email: true,
            affiliation: true,
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
            mpPaymentId: true,
            mpPreferenceId: true,
            checkoutLink: {
              select: {
                status: true,
              },
            },
          },
        },
        ledgerEntries: {
          where: { OR: [
            { delta: { gt: 0 } },
            { reason: "ADMIN_ADJUST", delta: 0, metadata: { path: ["action"], equals: "PACKAGE_ASSIGNMENT" } },
          ] },
          orderBy: { createdAt: "asc" },
          take: 2,
          select: {
            delta: true,
            reason: true,
            metadata: true,
            createdAt: true,
          },
        },
      },
    }),
  ]);

  return NextResponse.json({
    items: rows.map((row) => {
      const credit = row.ledgerEntries.find(entry => entry.delta > 0);
      const audit = row.ledgerEntries.find(entry => entry.delta === 0 && entry.reason === "ADMIN_ADJUST");
      const metadata = audit?.metadata as Prisma.JsonObject | undefined;
      return ({
      id: row.id, type: row.type, unlimitedMonth: row.unlimitedMonth, unlimitedYear: row.unlimitedYear, revokedAt: row.revokedAt,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      classesLeft: row.classesLeft,
      classesPurchased: row.type === "MONTHLY_UNLIMITED" ? 0 : credit?.delta ?? row.pack.classes,
      creditReason: credit?.reason ?? null,
      user: row.user,
      pack: { ...row.pack, name: row.nameSnapshot ?? row.pack.name, price: row.priceSnapshot ?? row.pack.price },
      amountPaid: row.payment?.amount ?? (audit ? 0 : row.priceSnapshot ?? row.pack.price),
      assignmentSource: audit ? "ADMIN" : null,
      assignedBy: metadata?.actorUserId ?? null,
      assignedAt: audit?.createdAt ?? null,
      paymentStatus: row.payment?.status ?? null,
      paymentProvider: row.payment?.provider ?? null,
      paymentReference:
        row.payment?.mpPaymentId ?? row.payment?.mpPreferenceId ?? null,
      checkoutStatus: row.payment?.checkoutLink?.status ?? null,
    }); }),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
}
