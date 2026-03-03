import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function j(status: number, body: any) {
  return NextResponse.json(body, { status });
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const monthParam = searchParams.get("month"); // formato: 2026-02

    let from: Date;
    let to: Date;

    if (monthParam) {
      const [yearStr, monthStr] = monthParam.split("-");
      const year = Number(yearStr);
      const month = Number(monthStr);

      if (!year || !month || month < 1 || month > 12) {
        return j(400, { error: "INVALID_MONTH_FORMAT" });
      }

      from = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
      to = new Date(Date.UTC(year, month, 1, 0, 0, 0));
    } else {
      const now = new Date();
      from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    }

    // ============================
    // 🟢 INGRESOS PAQUETES
    // ============================

    const packAgg = await prisma.payment.aggregate({
      where: {
        status: "APPROVED",
        createdAt: { gte: from, lt: to },
      },
      _sum: { amount: true },
    });

    const packRevenue = packAgg._sum.amount ?? 0;

    // ============================
    // 🔵 INGRESOS WELLHUB
    // ============================

    const wellhubCount = await prisma.booking.count({
      where: {
        attended: true,
        class: {
          date: { gte: from, lt: to },
        },
        user: {
          affiliation: "WELLHUB",
        },
      },
    });

    const totalpassCount = await prisma.booking.count({
      where: {
        attended: true,
        class: {
          date: { gte: from, lt: to },
        },
        user: {
          affiliation: "TOTALPASS",
        },
      },
    });

    const wellhubRevenue = wellhubCount * 160;
    const totalpassRevenue = totalpassCount * 140;
    const appsRevenue = wellhubRevenue + totalpassRevenue;

    // ============================
    // 🔥 TOTAL GENERAL
    // ============================

    const totalRevenue = packRevenue + appsRevenue;

    return j(200, {
      month: monthParam,
      packRevenue,
      appsRevenue,
      wellhub: {
        count: wellhubCount,
        revenue: wellhubRevenue,
      },
      totalpass: {
        count: totalpassCount,
        revenue: totalpassRevenue,
      },
      totalRevenue,
    });

  } catch (err: any) {
    console.error("revenue error", err);
    return j(500, { error: "INTERNAL_ERROR" });
  }
}