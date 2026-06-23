import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthFromRequest: vi.fn(),
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  getAuthFromRequest: mocks.getAuthFromRequest,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

import { requireAdmin, requireClassManager } from "./_utils";

function req() {
  return new Request("https://example.test/api/admin") as any;
}

describe("admin route guards", () => {
  beforeEach(() => {
    mocks.getAuthFromRequest.mockResolvedValue({ sub: "coach_1" });
    mocks.prisma.user.findUnique.mockResolvedValue({
      id: "coach_1",
      role: "COACH",
      email: "coach@example.test",
      name: "Coach",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("allows coaches through the class-manager guard", async () => {
    await expect(requireClassManager(req())).resolves.toBeNull();
  });

  it("keeps coaches out of admin-only guards", async () => {
    const res = await requireAdmin(req());

    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
    await expect(res!.json()).resolves.toMatchObject({
      error: "UNAUTHORIZED",
    });
  });
});
