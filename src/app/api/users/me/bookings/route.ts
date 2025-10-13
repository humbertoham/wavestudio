// app/api/users/me/bookings/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuth } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const me = await getAuth();               // ✅ no lanza
  if (!me) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const rows = await prisma.booking.findMany({
    where: { userId: me.sub },
    orderBy: { createdAt: "desc" },
    include: { class: { include: { instructor: true } } },
  });

  const data = rows.map((b) => ({
    id: b.id,
    status: b.status,
    createdAt: b.createdAt.toISOString(),
    canceledAt: b.canceledAt ? b.canceledAt.toISOString() : null,
    class: {
      id: b.class.id,
      title: b.class.title,
      focus: b.class.focus,
      date: b.class.date.toISOString(),
      durationMin: b.class.durationMin,
      location: b.class.location ?? null,
      instructor: { id: b.class.instructor.id, name: b.class.instructor.name },
    },
  }));

  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
