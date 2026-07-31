import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { getAuth } from "@/lib/auth";
import {
  getPaginationWindow,
  parseMyClassesPage,
  type PaginatedResponse,
} from "@/lib/my-classes-pagination";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type BookingSection = "upcoming" | "history";

type BookingRow = {
  id: string;
  status: string;
  createdAt: Date;
  canceledAt: Date | null;
  quantity: number;
  classId: string;
  classTitle: string;
  classFocus: string;
  classDate: Date;
  durationMin: number;
  location: string | null;
  creditCost: number;
  instructorId: string;
  instructorName: string;
};

type BookingResponse = {
  id: string;
  status: string;
  createdAt: string;
  canceledAt: string | null;
  quantity: number;
  class: {
    id: string;
    title: string;
    focus: string;
    date: string;
    durationMin: number;
    location: string | null;
    creditCost: number;
    instructor: {
      id: string;
      name: string;
    };
  };
};

function parseSection(value: string | null): BookingSection | null {
  return value === "upcoming" || value === "history" ? value : null;
}

function sectionCondition(section: BookingSection, now: Date) {
  const classEndsAt = Prisma.sql`
    c."date" + c."durationMin" * INTERVAL '1 minute'
  `;

  return section === "upcoming"
    ? Prisma.sql`
        b."status" <> 'CANCELED'
        AND ${classEndsAt} >= ${now}
      `
    : Prisma.sql`
        (b."status" = 'CANCELED' OR ${classEndsAt} < ${now})
      `;
}

function serializeBooking(row: BookingRow): BookingResponse {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    canceledAt: row.canceledAt?.toISOString() ?? null,
    quantity: row.quantity ?? 1,
    class: {
      id: row.classId,
      title: row.classTitle,
      focus: row.classFocus,
      date: row.classDate.toISOString(),
      durationMin: row.durationMin,
      location: row.location ?? null,
      creditCost: row.creditCost ?? 1,
      instructor: {
        id: row.instructorId,
        name: row.instructorName,
      },
    },
  };
}

export async function GET(req: NextRequest) {
  const me = await getAuth();
  if (!me) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const section = parseSection(searchParams.get("section"));
  if (!section) {
    return NextResponse.json(
      { error: "INVALID_SECTION" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const requestedPage = parseMyClassesPage(searchParams.get("page"));
  const now = new Date();
  const condition = sectionCondition(section, now);

  const result = await prisma.$transaction(
    async (tx): Promise<PaginatedResponse<BookingResponse>> => {
      const counts = await tx.$queryRaw<Array<{ total: number }>>(Prisma.sql`
        SELECT COUNT(*)::int AS "total"
        FROM "Booking" b
        INNER JOIN "Class" c ON c."id" = b."classId"
        WHERE b."userId" = ${me.sub}
          AND ${condition}
      `);
      const pagination = getPaginationWindow(
        Number(counts[0]?.total ?? 0),
        requestedPage
      );
      const rows = await tx.$queryRaw<BookingRow[]>(Prisma.sql`
        SELECT
          b."id",
          b."status"::text AS "status",
          b."createdAt",
          b."canceledAt",
          b."quantity",
          c."id" AS "classId",
          c."title" AS "classTitle",
          c."focus" AS "classFocus",
          c."date" AS "classDate",
          c."durationMin",
          c."location",
          c."creditCost",
          i."id" AS "instructorId",
          i."name" AS "instructorName"
        FROM "Booking" b
        INNER JOIN "Class" c ON c."id" = b."classId"
        INNER JOIN "Instructor" i ON i."id" = c."instructorId"
        WHERE b."userId" = ${me.sub}
          AND ${condition}
        ORDER BY c."date" ASC, b."id" ASC
        LIMIT ${pagination.take}
        OFFSET ${pagination.skip}
      `);

      return {
        items: rows.map(serializeBooking),
        page: pagination.page,
        pageSize: pagination.pageSize,
        totalItems: pagination.totalItems,
        totalPages: pagination.totalPages,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
  );

  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
}
