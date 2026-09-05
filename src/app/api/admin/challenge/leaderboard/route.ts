import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { CHALLENGE_KEY, ChallengeError } from "@/lib/challenge";
import { prisma } from "@/lib/prisma";
import { requireChallengeAdmin } from "../_auth";

export const runtime = "nodejs";

function parsePositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

type LeaderboardRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  points: number;
  updatedAt: Date | null;
};

type PointsFilter = "all" | "with-points" | "without-points";

function parsePointsFilter(value: string | null): PointsFilter {
  return value === "with-points" || value === "without-points"
    ? value
    : "all";
}

function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

export async function GET(req: NextRequest) {
  const auth = await requireChallengeAdmin(req);
  if (!auth.ok) return auth.response;

  const challenge = await prisma.challenge.findUnique({
    where: { key: CHALLENGE_KEY },
    select: { id: true, isActive: true },
  });

  if (!challenge?.isActive) {
    const error = new ChallengeError(
      "CHALLENGE_NOT_ACTIVE",
      "El Challenge no está activo.",
      409
    );
    return NextResponse.json(
      { error: error.code, code: error.code, message: error.message },
      { status: error.status, headers: { "Cache-Control": "no-store" } }
    );
  }

  const url = new URL(req.url);
  const page = parsePositiveInt(url.searchParams.get("page"), 1, 100_000);
  const pageSize = parsePositiveInt(url.searchParams.get("pageSize"), 25, 100);
  const search = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const pointsFilter = parsePointsFilter(url.searchParams.get("points"));
  const offset = (page - 1) * pageSize;
  const escapedSearch = escapeLikePattern(search);
  const searchPattern = `%${escapedSearch}%`;
  const phoneDigits = search.replace(/\D/g, "");
  const phonePattern = `%${escapeLikePattern(phoneDigits)}%`;
  const searchClause = search
    ? Prisma.sql`
        AND (
          u."name" ILIKE ${searchPattern} ESCAPE '\\'
          OR u."email" ILIKE ${searchPattern} ESCAPE '\\'
          OR COALESCE(u."phone", '') ILIKE ${searchPattern} ESCAPE '\\'
          ${
            phoneDigits
              ? Prisma.sql`OR regexp_replace(COALESCE(u."phone", ''), '[^0-9]', '', 'g') LIKE ${phonePattern} ESCAPE '\\'`
              : Prisma.empty
          }
        )
      `
    : Prisma.empty;
  const pointsClause =
    pointsFilter === "with-points"
      ? Prisma.sql`AND COALESCE(t."points", 0) > 0`
      : pointsFilter === "without-points"
        ? Prisma.sql`AND COALESCE(t."points", 0) = 0`
        : Prisma.empty;
  const countTotalsJoin =
    pointsFilter === "all"
      ? Prisma.empty
      : Prisma.sql`
          LEFT JOIN "ChallengeUserTotal" t
            ON t."userId" = u."id" AND t."challengeId" = ${challenge.id}
        `;

  const [rows, counts] = await Promise.all([
    prisma.$queryRaw<LeaderboardRow[]>(Prisma.sql`
      SELECT
        u."id",
        u."name",
        u."email",
        u."phone",
        COALESCE(t."points", 0)::int AS "points",
        t."updatedAt" AS "updatedAt"
      FROM "User" u
      LEFT JOIN "ChallengeUserTotal" t
        ON t."userId" = u."id" AND t."challengeId" = ${challenge.id}
      WHERE TRUE
      ${searchClause}
      ${pointsClause}
      ORDER BY COALESCE(t."points", 0) DESC, LOWER(u."name") ASC, u."id" ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `),
    prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS "count"
      FROM "User" u
      ${countTotalsJoin}
      WHERE TRUE
      ${searchClause}
      ${pointsClause}
    `),
  ]);

  const total = Number(counts[0]?.count ?? 0);

  return NextResponse.json(
    {
      items: rows.map((row, index) => ({
        rank: offset + index + 1,
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        points: Number(row.points),
        updatedAt: row.updatedAt?.toISOString() ?? null,
      })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
