import { NextRequest, NextResponse } from "next/server";
import { prisma, requireAdmin } from "../_utils";

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
  repeatNextMonth?: boolean;  // ahora: repetir 4 semanas seguidas desde la próxima semana
};

// Suma 'days' días conservando hora/minuto local (evita drift por DST)
function addDaysKeepingTime(base: Date, days: number) {
  return new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate() + days,
    base.getHours(),
    base.getMinutes(),
    base.getSeconds(),
    base.getMilliseconds()
  );
}

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

  const safeFocus = body.focus ?? ""; // 🔒 asegura string

  const result = await prisma.$transaction(async (tx) => {
    const created = await tx.class.create({
      data: {
        title: body.title,
        focus: safeFocus,
        date: base,
        durationMin: body.durationMin,
        capacity: body.capacity,
        instructorId: body.instructorId,
      },
    });

    let duplicated = 0;

    if (body.repeatNextMonth) {
      // ✅ Nueva regla:
      // crear 4 repeticiones semanales a partir de la semana siguiente
      const dates = [
        addDaysKeepingTime(base, 7),
        addDaysKeepingTime(base, 14),
        addDaysKeepingTime(base, 21),
        addDaysKeepingTime(base, 28),
      ];

      const data = dates.map((date) => ({
        title: body.title,
        focus: safeFocus,
        date,
        durationMin: body.durationMin,
        capacity: body.capacity,
        instructorId: body.instructorId,
      }));

      await tx.class.createMany({ data });
      duplicated = dates.length; // 4
    }

    return { created, duplicated };
  });

  return NextResponse.json(
    { item: result.created, duplicated: result.duplicated },
    { status: 201 }
  );
}
