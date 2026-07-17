import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuth: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getAuth: mocks.getAuth,
  requireAdmin: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    class: { findMany: mocks.findMany },
  },
}));

import { GET } from "./route";

describe("GET /api/classes calendar visibility", () => {
  beforeEach(() => {
    mocks.getAuth.mockResolvedValue(null);
    mocks.findMany.mockResolvedValue([]);
  });

  it("always excludes deleted rows without conflating cancellation", async () => {
    const response = await GET(
      new Request(
        "https://example.test/api/classes?from=2026-07-01T00:00:00.000Z&to=2026-08-01T00:00:00.000Z"
      )
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          date: {
            gte: new Date("2026-07-01T00:00:00.000Z"),
            lt: new Date("2026-08-01T00:00:00.000Z"),
          },
        }),
      })
    );
    expect(mocks.findMany.mock.calls[0][0].where).not.toHaveProperty(
      "isCanceled"
    );
  });
});
