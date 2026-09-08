import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireChallengeAdmin: vi.fn(),
  findChallenge: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock("../_auth", () => ({
  requireChallengeAdmin: mocks.requireChallengeAdmin,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    challenge: { findUnique: mocks.findChallenge },
    $queryRaw: mocks.queryRaw,
  },
}));

import { GET } from "./route";

type SqlQuery = { strings: string[]; values: unknown[] };

function request(query = "") {
  return new Request(
    `https://example.test/api/admin/challenge/leaderboard${query}`
  ) as any;
}

function sqlQuery(call: number) {
  return mocks.queryRaw.mock.calls[call][0] as SqlQuery;
}

describe("GET /api/admin/challenge/leaderboard", () => {
  beforeEach(() => {
    mocks.requireChallengeAdmin.mockResolvedValue({
      ok: true,
      user: { id: "admin_1", role: "ADMIN" },
    });
    mocks.findChallenge.mockResolvedValue({
      id: "challenge_1",
      isActive: true,
    });
  });

  it("keeps the default paginated leaderboard behavior", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([
        {
          id: "user_1",
          name: "Ana",
          email: "ana@example.test",
          phone: null,
          points: 12,
          updatedAt: new Date("2026-09-01T12:00:00.000Z"),
        },
      ])
      .mockResolvedValueOnce([{ count: 26 }]);

    const response = await GET(request("?page=2&pageSize=5"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [
        {
          rank: 6,
          name: "Ana",
          phone: null,
          points: 12,
          updatedAt: "2026-09-01T12:00:00.000Z",
        },
      ],
      page: 2,
      pageSize: 5,
      total: 26,
      totalPages: 6,
    });

    expect(sqlQuery(0).strings.join(" ")).not.toContain("ILIKE");
    expect(sqlQuery(0).values).toEqual(["challenge_1", 5, 5]);
    expect(sqlQuery(1).values).toEqual([]);
  });

  it("trims and applies partial name, email, and phone search before pagination", async () => {
    mocks.queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: 0 }]);

    const response = await GET(request("?q=%20Ana%20&page=3&pageSize=10"));

    expect(response.status).toBe(200);
    const rowsQuery = sqlQuery(0);
    const countQuery = sqlQuery(1);
    expect(rowsQuery.strings.join(" ")).toContain('u."name" ILIKE');
    expect(rowsQuery.strings.join(" ")).toContain('u."email" ILIKE');
    expect(rowsQuery.strings.join(" ")).toContain('u."phone"');
    expect(rowsQuery.values).toEqual([
      "challenge_1",
      "%Ana%",
      "%Ana%",
      "%Ana%",
      10,
      20,
    ]);
    expect(countQuery.values).toEqual([
      "%Ana%",
      "%Ana%",
      "%Ana%",
    ]);
  });

  it("normalizes phone digits and combines search with the points filter", async () => {
    mocks.queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: 0 }]);

    await GET(request("?q=(55)%20123-45&points=with-points"));

    for (const call of [0, 1]) {
      const query = sqlQuery(call);
      expect(query.strings.join(" ")).toContain("regexp_replace");
      expect(query.strings.join(" ")).toContain('COALESCE(t."points", 0) > 0');
      expect(query.values).toContain("%5512345%");
    }
  });

  it("supports filtering users without points", async () => {
    mocks.queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: 0 }]);

    await GET(request("?points=without-points"));

    expect(sqlQuery(0).strings.join(" ")).toContain(
      'COALESCE(t."points", 0) = 0'
    );
    expect(sqlQuery(1).strings.join(" ")).toContain(
      'COALESCE(t."points", 0) = 0'
    );
  });
});
