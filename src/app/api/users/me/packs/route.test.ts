import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  getAuth: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getAuth: mocks.getAuth }));
vi.mock("@/lib/prisma", () => ({
  prisma: { packPurchase: { findMany: mocks.findMany } },
}));

import { GET } from "./route";

describe("GET /api/users/me/packs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without querying private package data", async () => {
    mocks.getAuth.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "UNAUTHORIZED" });
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("loads every package by purchase date and id without changing balances", async () => {
    mocks.getAuth.mockResolvedValue({ sub: "user-1", role: "USER" });
    mocks.findMany.mockResolvedValue([
      {
        id: "pack-a",
        createdAt: new Date("2026-01-01T12:00:00.000Z"),
        expiresAt: new Date("2026-02-01T12:00:00.000Z"),
        classesLeft: 2,
        pausedDays: 0,
        pausedUntil: null,
        pack: {
          id: "definition-a",
          name: "Inicial",
          classes: 4,
          price: 500,
          classesLabel: null,
        },
      },
      {
        id: "pack-b",
        createdAt: new Date("2026-02-01T12:00:00.000Z"),
        expiresAt: new Date("2026-03-01T12:00:00.000Z"),
        classesLeft: 7,
        pausedDays: 3,
        pausedUntil: new Date("2026-02-10T12:00:00.000Z"),
        pack: {
          id: "definition-b",
          name: "Corporativo",
          classes: 10,
          price: 0,
          classesLabel: "10 clases",
        },
      },
      {
        id: "pack-c",
        createdAt: new Date("2026-03-01T12:00:00.000Z"),
        expiresAt: new Date("2026-04-01T12:00:00.000Z"),
        classesLeft: 1,
        pausedDays: 0,
        pausedUntil: null,
        pack: {
          id: "definition-c",
          name: "Recarga",
          classes: 2,
          price: 300,
          classesLabel: null,
        },
      },
    ]);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      })
    );
    expect(mocks.findMany.mock.calls[0][0]).not.toHaveProperty("take");
    expect(data.map(({ id }: { id: string }) => id)).toEqual([
      "pack-a",
      "pack-b",
      "pack-c",
    ]);
    expect(data[1]).toMatchObject({
      classesLeft: 7,
      pausedDays: 3,
      pausedUntil: "2026-02-10T12:00:00.000Z",
      expiresAt: "2026-03-01T12:00:00.000Z",
      pack: { name: "Corporativo", price: 0 },
    });
  });
});
