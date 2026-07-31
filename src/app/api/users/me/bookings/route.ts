// app/api/users/me/bookings/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuth } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const me = await getAuth();
  if (!me) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const rows = await prisma.booking.findMany({
    where: { userId: me.sub },
    orderBy: [{ class: { date: "asc" } }, { id: "asc" }],
    select: {
      id: true,
      status: true,
      createdAt: true,
      canceledAt: true,
      quantity: true, // 👈 necesario para spots
      class: {
        select: {
          id: true,
          title: true,
          focus: true,
          date: true,
          durationMin: true,
          location: true,
          creditCost: true, // 👈 necesario para calcular tokens a reembolsar
          instructor: { select: { id: true, name: true } },
        },
      },
    },
  });

  const data = rows.map((b) => ({
    id: b.id,
    status: b.status,
    createdAt: b.createdAt.toISOString(),
    canceledAt: b.canceledAt ? b.canceledAt.toISOString() : null,
    quantity: b.quantity ?? 1, // 👈 default defensivo
    class: {
      id: b.class.id,
      title: b.class.title,
      focus: b.class.focus,
      date: b.class.date.toISOString(),
      durationMin: b.class.durationMin,
      location: b.class.location ?? null,
      creditCost: b.class.creditCost ?? 1, // 👈 default defensivo
      instructor: { id: b.class.instructor.id, name: b.class.instructor.name },
    },
  }));

  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
