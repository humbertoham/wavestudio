import { NextRequest, NextResponse } from "next/server";
import { prisma, requireAdmin } from "../_utils";
// import type { Prisma } from "@prisma/client"; // opcional, si quieres tipar createMany

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req); if (auth) return auth;
  const items = await prisma.class.findMany({
    include: { instructor: true },
    orderBy: { date: "desc" },
  });
  return NextResponse.json({ items });
}

type CreateClassBody = {
  title: string;
  focus?: string;             // puede venir undefined
  date: string;               // "YYYY-MM-DDTHH:mm"
  durationMin: number;
  capacity: number;
  instructorId: string;
  repeatNextMonth?: boolean;
};

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req); if (auth) return auth;

  const body = (await req.json()) as CreateClassBody;

  // Parse fecha local del runtime
  const [ymd, hm] = String(body.date).split("T");
  if (!ymd || !hm) {
    return NextResponse.json({ error: "Fecha inválida" }, { status: 400 });
  }
  const [y, m, d] = ymd.split("-").map(Number);
  const [hh, mm] = hm.split(":").map(Number);
  const base = new Date(y, m - 1, d, hh, mm, 0, 0);

  const safeFocus = body.focus ?? ""; // <= 🔒 asegura string

  const result = await prisma.$transaction(async (tx) => {
    const created = await tx.class.create({
      data: {
        title: body.title,
        focus: safeFocus,               // <= aquí ya es string
        date: base,
        durationMin: body.durationMin,
        capacity: body.capacity,
        instructorId: body.instructorId,
      },
    });

    let duplicated = 0;

    if (body.repeatNextMonth) {
      const dow = base.getDay();
      const hour = base.getHours();
      const minu = base.getMinutes();

      const firstNext = new Date(base.getFullYear(), base.getMonth() + 1, 1, hour, minu, 0, 0);
      const targetMonth = firstNext.getMonth();
      while (firstNext.getDay() !== dow) firstNext.setDate(firstNext.getDate() + 1);

      const dates: Date[] = [];
      for (let dt = new Date(firstNext); dt.getMonth() === targetMonth; dt.setDate(dt.getDate() + 7)) {
        dates.push(new Date(dt));
      }

      if (dates.length) {
        // construye la data con focus ya tipado como string
        const data = dates.map((date) => ({
          title: body.title,
          focus: safeFocus,             // <= nunca undefined
          date,
          durationMin: body.durationMin,
          capacity: body.capacity,
          instructorId: body.instructorId,
        }));

        await tx.class.createMany({ data });
        duplicated = dates.length;
      }
    }

    return { created, duplicated };
  });

  return NextResponse.json({ item: result.created, duplicated: result.duplicated }, { status: 201 });
}
