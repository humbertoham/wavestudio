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
  points: number;
  updatedAt: Date | null;
};

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
  const offset = (page - 1) * pageSize;

  const [rows, counts] = await Promise.all([
    prisma.$queryRaw<LeaderboardRow[]>(Prisma.sql`
      SELECT
        u."id",
        u."name",
        u."email",
        COALESCE(t."points", 0)::int AS "points",
        t."updatedAt" AS "updatedAt"
      FROM "User" u
      LEFT JOIN "ChallengeUserTotal" t
        ON t."userId" = u."id" AND t."challengeId" = ${challenge.id}
      ORDER BY COALESCE(t."points", 0) DESC, LOWER(u."name") ASC, u."id" ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `),
    prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS "count" FROM "User"
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
