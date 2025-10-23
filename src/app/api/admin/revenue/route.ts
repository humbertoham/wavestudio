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
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");

    const to = toParam ? new Date(toParam) : new Date();
    const from = fromParam ? new Date(fromParam) : new Date(to.getTime() - 30*24*60*60*1000); // últimos 30 días por defecto

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return j(400, { error: "Parámetros 'from' o 'to' inválidos" });
    }

    // Trae sólo APPROVED en el rango
    const rows = await prisma.payment.findMany({
      where: {
        status: "APPROVED",
        createdAt: { gte: from, lt: to },
      },
      select: { amount: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    const total = rows.reduce((s, r) => s + (r.amount ?? 0), 0);
    const count = rows.length;
    const average = count ? Math.round(total / count) : 0;

    // Agregación por día (JS) para evitar groupBy por timestamp
    const dayKey = (d: Date) => {
      const z = new Date(d);
      z.setHours(0,0,0,0);
      return z.toISOString();
    };
    const byDay = new Map<string, number>();
    for (const r of rows) {
      const k = dayKey(r.createdAt);
      byDay.set(k, (byDay.get(k) ?? 0) + (r.amount ?? 0));
    }
    const daily = Array.from(byDay.entries())
      .sort((a,b)=> new Date(a[0]).getTime() - new Date(b[0]).getTime())
      .map(([date, total]) => ({ date, total }));

    return j(200, { total, count, average, daily });
  } catch (err: any) {
    console.error("revenue error", err);
    return j(500, { error: "INTERNAL_ERROR" });
  }
}
