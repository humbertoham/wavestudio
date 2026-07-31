import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  findMany: vi.fn(),
  getAuth: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getAuth: mocks.getAuth }));
vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: mocks.transaction },
}));

import { GET } from "./route";

function request(query = "") {
  return new NextRequest(`https://wave.test/api/users/me/packs${query}`);
}

function packRow(id: string, createdAt: string, classesLeft: number) {
  return {
    id,
    createdAt: new Date(createdAt),
    expiresAt: new Date("2027-01-01T12:00:00.000Z"),
    classesLeft,
    pausedDays: 3,
    pausedUntil: new Date("2026-09-10T12:00:00.000Z"),
    pack: {
      id: `definition-${id}`,
      name: "Corporativo",
      classes: 10,
      price: 0,
      classesLabel: "10 clases",
    },
  };
}

describe("GET /api/users/me/packs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(
      async (
        callback: (tx: {
          packPurchase: {
            count: typeof mocks.count;
            findMany: typeof mocks.findMany;
          };
        }) => unknown
      ) =>
        callback({
          packPurchase: {
            count: mocks.count,
            findMany: mocks.findMany,
          },
        })
    );
  });

  it("returns 401 without querying private package data or counts", async () => {
    mocks.getAuth.mockResolvedValue(null);

    const response = await GET(request("?page=1"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "UNAUTHORIZED" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("returns zero metadata without exposing another user's records", async () => {
    mocks.getAuth.mockResolvedValue({ sub: "user-1", role: "USER" });
    mocks.count.mockResolvedValue(0);
    mocks.findMany.mockResolvedValue([]);

    const response = await GET(request("?page=1&userId=another-user"));
    const data = await response.json();

    expect(data).toEqual({
      items: [],
      page: 1,
      pageSize: 5,
      totalItems: 0,
      totalPages: 0,
    });
    expect(mocks.count).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1" } })
    );
  });

  it("loads only the requested package page in chronological order", async () => {
    mocks.getAuth.mockResolvedValue({ sub: "user-1", role: "USER" });
    mocks.count.mockResolvedValue(6);
    mocks.findMany.mockResolvedValue([
      packRow("pack-6", "2026-06-01T12:00:00.000Z", 7),
    ]);

    const response = await GET(request("?page=2"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        skip: 5,
        take: 5,
      })
    );
    expect(data).toMatchObject({
      page: 2,
      pageSize: 5,
      totalItems: 6,
      totalPages: 2,
    });
    expect(data.items).toEqual([
      expect.objectContaining({
        id: "pack-6",
        classesLeft: 7,
        pausedDays: 3,
        pausedUntil: "2026-09-10T12:00:00.000Z",
        expiresAt: "2027-01-01T12:00:00.000Z",
        pack: expect.objectContaining({ name: "Corporativo", price: 0 }),
      }),
    ]);
  });

  it("defaults invalid input and normalizes an excessive page", async () => {
    mocks.getAuth.mockResolvedValue({ sub: "user-1", role: "USER" });
    mocks.count.mockResolvedValue(12);
    mocks.findMany.mockResolvedValue([]);

    const invalid = await GET(request("?page=abc"));
    const high = await GET(request("?page=999999"));

    await expect(invalid.json()).resolves.toMatchObject({ page: 1 });
    await expect(high.json()).resolves.toMatchObject({
      page: 3,
      totalPages: 3,
    });
    expect(mocks.findMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 5 });
    expect(mocks.findMany.mock.calls[1][0]).toMatchObject({ skip: 10, take: 5 });
  });
});
