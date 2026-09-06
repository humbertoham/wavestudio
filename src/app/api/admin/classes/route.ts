import { NextRequest, NextResponse } from "next/server";
import { prisma, requireAdminUser } from "../_utils";
import { zonedTimeToUtc, utcToZonedTime } from "date-fns-tz";
import { addDays } from "date-fns";
import {
  getClassChallengeSnapshot,
  runChallengeTransaction,
} from "@/lib/challenge";
import {
  getInstructorPayrollSnapshot,
  payrollErrorResponse,
} from "@/lib/payroll";

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
  const auth = await requireAdminUser(req);
  if (!auth.ok) return auth.response;

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
      ...item,
      challengePointsLocked: item._count.challengeAwards > 0,
      _count: undefined,
    })),
  });
}


// ==================== POST ====================
export async function POST(req: NextRequest) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return auth.response;

  try {
    const body = (await req.json()) as CreateClassBody;

    if (!body?.title || !isValidLocalDatetime(body?.date) || !body?.instructorId) {
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
    }

    const baseUtc = localStringToUtc(body.date);
    const safeFocus = body.focus ?? "";

    const result = await runChallengeTransaction(async (tx) => {
      const challengeSnapshot = await getClassChallengeSnapshot(tx);
      const payrollSnapshot = await getInstructorPayrollSnapshot(
        tx,
        body.instructorId
      );
      const created = await tx.class.create({
        data: {
          title: body.title,
          focus: safeFocus,
          date: baseUtc,
          durationMin: body.durationMin,
          capacity: body.capacity,
          instructorId: body.instructorId,
          payrollRateSnapshot: payrollSnapshot.payrollRateSnapshot,
          payrollRateEffectiveAt: payrollSnapshot.payrollRateEffectiveAt,
          ...challengeSnapshot,
        },
      });

      let duplicated = 0;
      if (body.repeatNextMonth) {
        const offsets = [7, 14, 21, 28];
        const datesUtc = offsets.map((d) =>
          addDaysKeepingWallTimeUTC(baseUtc, d)
        );

        const data = datesUtc.map((date) => ({
          title: body.title,
          focus: safeFocus,
          date,
          durationMin: body.durationMin,
          capacity: body.capacity,
          instructorId: body.instructorId,
          payrollRateSnapshot: payrollSnapshot.payrollRateSnapshot,
          payrollRateEffectiveAt: payrollSnapshot.payrollRateEffectiveAt,
          ...challengeSnapshot,
        }));

        await tx.class.createMany({ data });
        duplicated = datesUtc.length;
      }

      return { created, duplicated };
    });

    return NextResponse.json(
      { item: result.created, duplicated: result.duplicated },
      { status: 201 }
    );
  } catch (error) {
    const known = payrollErrorResponse(error);
    if (known) return NextResponse.json(known.body, { status: known.status });
    console.error("ADMIN_CLASS_POST_ERROR", error);
    return NextResponse.json(
      { error: "CLASS_CREATE_FAILED", message: "No se pudo crear la clase." },
      { status: 500 }
    );
  }
}
