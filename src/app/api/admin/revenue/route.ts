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
    const monthParam = searchParams.get("month"); 
    // formato esperado: 2026-02

    let from: Date;
    let to: Date;

    if (monthParam) {
      const [year, month] = monthParam.split("-").map(Number);
      from = new Date(Date.UTC(year, month - 1, 1));
      to = new Date(Date.UTC(year, month, 1));
    } else {
      const now = new Date();
      from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    }

    // ============================
    // 🟢 INGRESOS PAQUETES
    // ============================

    const payments = await prisma.payment.findMany({
      where: {
        status: "APPROVED",
        createdAt: { gte: from, lt: to },
      },
      select: { amount: true },
    });

    const packRevenue = payments.reduce(
      (sum, p) => sum + (p.amount ?? 0),
      0
    );

    // ============================
    // 🔵 INGRESOS APPS
    // ============================

    const attendedBookings = await prisma.booking.findMany({
      where: {
        attended: true,
        status: "ACTIVE",
        class: {
          date: { gte: from, lt: to },
        },
        user: {
          affiliation: { in: ["WELLHUB", "TOTALPASS"] },
        },
      },
      select: {
        user: {
          select: { affiliation: true },
        },
      },
    });

    let wellhubCount = 0;
    let totalpassCount = 0;

    for (const b of attendedBookings) {
      if (b.user?.affiliation === "WELLHUB") {
        wellhubCount++;
      } else if (b.user?.affiliation === "TOTALPASS") {
        totalpassCount++;
      }
    }

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