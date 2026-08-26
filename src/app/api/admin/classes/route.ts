import { NextRequest, NextResponse } from "next/server";
import { prisma, requireAdmin } from "../_utils";
import { zonedTimeToUtc, utcToZonedTime } from "date-fns-tz";
import { addDays } from "date-fns";
import {
  getClassChallengeSnapshot,
  runChallengeTransaction,
} from "@/lib/challenge";
import { syncWellhubClassSafely } from "@/lib/wellhub/booking/sync";
import { withoutWellhubClassIdentifiers } from "@/lib/wellhub/booking/serialize";

export const runtime = "nodejs";

const USER_TZ = "America/Monterrey";

type CreateClassBody = {
  title: string;
  focus?: string;
  date: string;              // "YYYY-MM-DDTHH:mm"
  durationMin: number;
  capacity: number;
  instructorId: string;
  repeatNextMonth?: boolean;
};

function isValidLocalDatetime(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s);
}

// Convierte fecha local (sin zona) → UTC según USER_TZ
function localStringToUtc(local: string): Date {
  return zonedTimeToUtc(local.replace("T", " "), USER_TZ);
}

// Suma días manteniendo la hora local (pared)
function addDaysKeepingWallTimeUTC(baseUtc: Date, days: number): Date {
  const baseZoned = utcToZonedTime(baseUtc, USER_TZ);
  const plus = addDays(baseZoned, days);
  const yyyy = plus.getFullYear();
  const MM = String(plus.getMonth() + 1).padStart(2, "0");
  const dd = String(plus.getDate()).padStart(2, "0");
  const HH = String(plus.getHours()).padStart(2, "0");
  const mm = String(plus.getMinutes()).padStart(2, "0");
  const localLike = `${yyyy}-${MM}-${dd} ${HH}:${mm}`;
  return zonedTimeToUtc(localLike, USER_TZ);
}

// ==================== GET ====================
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  const now = new Date(); // UTC actual

  const items = await prisma.class.findMany({
    where: {
      date: {
        gte: now, // 🔥 Solo clases que no han pasado
      },
      isCanceled: false, // opcional pero recomendable
      deletedAt: null,
    },
    include: {
      instructor: true,
      _count: { select: { challengeAwards: true } },
    },
    orderBy: { date: "asc" }, // 🔥 ahora ascendente tiene más sentido
  });

  return NextResponse.json({
    items: items.map((item) => ({
      ...withoutWellhubClassIdentifiers(item),
      challengePointsLocked: item._count.challengeAwards > 0,
      _count: undefined,
    })),
  });
}


// ==================== POST ====================
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req); if (auth) return auth;

  const body = (await req.json()) as CreateClassBody;

  if (!body?.title || !isValidLocalDatetime(body?.date) || !body?.instructorId) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  const baseUtc = localStringToUtc(body.date);
  const safeFocus = body.focus ?? "";

  const result = await runChallengeTransaction(async (tx) => {
    const challengeSnapshot = await getClassChallengeSnapshot(tx);
    const created = await tx.class.create({
      data: {
        title: body.title,
        focus: safeFocus,
        date: baseUtc,
        durationMin: body.durationMin,
        capacity: body.capacity,
        instructorId: body.instructorId,
        ...challengeSnapshot,
      },
    });

    const duplicatedIds: string[] = [];
    if (body.repeatNextMonth) {
      const offsets = [7, 14, 21, 28];
      const datesUtc = offsets.map((d) => addDaysKeepingWallTimeUTC(baseUtc, d));

      for (const date of datesUtc) {
        const duplicate = await tx.class.create({
          data: {
            title: body.title,
            focus: safeFocus,
            date,
            durationMin: body.durationMin,
            capacity: body.capacity,
            instructorId: body.instructorId,
            ...challengeSnapshot,
          },
          select: { id: true },
        });
        duplicatedIds.push(duplicate.id);
      }
    }

    return { created, duplicatedIds };
  });

  await Promise.all(
    [result.created.id, ...result.duplicatedIds].map((classId) =>
      syncWellhubClassSafely(classId)
    )
  );

  return NextResponse.json(
    {
      item: withoutWellhubClassIdentifiers(result.created),
      duplicated: result.duplicatedIds.length,
    },
    { status: 201 }
  );
}
