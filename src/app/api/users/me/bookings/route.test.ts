import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  getAuth: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getAuth: mocks.getAuth }));
vi.mock("@/lib/prisma", () => ({
  prisma: { booking: { findMany: mocks.findMany } },
}));

import { GET } from "./route";

describe("GET /api/users/me/bookings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without querying private booking data", async () => {
    mocks.getAuth.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "UNAUTHORIZED" });
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("loads only the authenticated user's bookings", async () => {
    mocks.getAuth.mockResolvedValue({ sub: "user-1", role: "USER" });
    mocks.findMany.mockResolvedValue([]);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([]);
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1" } })
    );
  });
});
