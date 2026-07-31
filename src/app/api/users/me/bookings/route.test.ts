import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuth: vi.fn(),
  queryRaw: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getAuth: mocks.getAuth }));
vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: mocks.transaction },
}));

import { GET } from "./route";

function request(query: string) {
  return new NextRequest(`https://wave.test/api/users/me/bookings${query}`);
}

function bookingRow(id: string, classDate: string) {
  return {
    id,
    status: "ACTIVE",
    createdAt: new Date("2026-01-01T12:00:00.000Z"),
    canceledAt: null,
    quantity: 1,
    classId: `class-${id}`,
    classTitle: "Pilates",
    classFocus: "Core",
    classDate: new Date(classDate),
    durationMin: 60,
    location: "Studio",
    creditCost: 1,
    instructorId: "instructor-1",
    instructorName: "Coach",
  };
}

function sqlText(callIndex: number) {
  const query = mocks.queryRaw.mock.calls[callIndex][0] as Prisma.Sql;
  return query.strings.join("?");
}

function sqlValues(callIndex: number) {
  const query = mocks.queryRaw.mock.calls[callIndex][0] as Prisma.Sql;
  return query.values;
}

describe("GET /api/users/me/bookings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(
      async (callback: (tx: { $queryRaw: typeof mocks.queryRaw }) => unknown) =>
        callback({ $queryRaw: mocks.queryRaw })
    );
  });

  it("returns 401 without querying private booking data or counts", async () => {
    mocks.getAuth.mockResolvedValue(null);

    const response = await GET(request("?section=upcoming&page=1"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "UNAUTHORIZED" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects an unknown section before querying booking data", async () => {
    mocks.getAuth.mockResolvedValue({ sub: "user-1", role: "USER" });

    const response = await GET(request("?section=other&page=1"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "INVALID_SECTION",
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("paginates upcoming classes by class date and booking id", async () => {
    mocks.getAuth.mockResolvedValue({ sub: "user-1", role: "USER" });
    mocks.queryRaw
      .mockResolvedValueOnce([{ total: 6 }])
      .mockResolvedValueOnce([
        bookingRow("booking-6", "2026-08-06T12:00:00.000Z"),
      ]);

    const response = await GET(
      request("?section=upcoming&page=2&userId=another-user")
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      page: 2,
      pageSize: 5,
      totalItems: 6,
      totalPages: 2,
    });
    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({
      id: "booking-6",
      quantity: 1,
      class: {
        id: "class-booking-6",
        date: "2026-08-06T12:00:00.000Z",
        instructor: { id: "instructor-1", name: "Coach" },
      },
    });

    const itemQuery = sqlText(1);
    expect(itemQuery).toContain('ORDER BY c."date" ASC, b."id" ASC');
    expect(itemQuery.indexOf("ORDER BY")).toBeLessThan(
      itemQuery.indexOf("LIMIT")
    );
    expect(itemQuery).toContain('b."status" <> \'CANCELED\'');
    expect(sqlValues(1)).toContain(5);
    expect(sqlValues(1)).toContain("user-1");
    expect(sqlValues(1)).not.toContain("another-user");
  });

  it("uses the unchanged canceled-or-ended rule for history", async () => {
    mocks.getAuth.mockResolvedValue({ sub: "user-1", role: "USER" });
    mocks.queryRaw.mockResolvedValueOnce([{ total: 0 }]).mockResolvedValueOnce([]);

    const response = await GET(request("?section=history&page=1"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [],
      page: 1,
      totalItems: 0,
      totalPages: 0,
    });
    expect(sqlText(0)).toContain('b."status" = \'CANCELED\' OR');
    expect(sqlText(0)).toContain("INTERVAL '1 minute'");
  });

  it("defaults an invalid page to one and normalizes a high page to the last page", async () => {
    mocks.getAuth.mockResolvedValue({ sub: "user-1", role: "USER" });
    mocks.queryRaw
      .mockResolvedValueOnce([{ total: 12 }])
      .mockResolvedValueOnce(Array.from({ length: 5 }, (_, index) => bookingRow(
        `booking-${index + 1}`,
        `2026-08-0${index + 1}T12:00:00.000Z`
      )))
      .mockResolvedValueOnce([{ total: 12 }])
      .mockResolvedValueOnce([
        bookingRow("booking-11", "2026-08-11T12:00:00.000Z"),
        bookingRow("booking-12", "2026-08-12T12:00:00.000Z"),
      ]);

    const invalid = await GET(request("?section=upcoming&page=1.5"));
    const high = await GET(request("?section=upcoming&page=999999"));

    await expect(invalid.json()).resolves.toMatchObject({ page: 1 });
    await expect(high.json()).resolves.toMatchObject({
      page: 3,
      totalPages: 3,
    });
    expect(sqlValues(1)).toContain(0);
    expect(sqlValues(3)).toContain(10);
  });
});
