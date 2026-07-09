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

function authUser(role: "USER" | "COACH" | "ADMIN") {
  return {
    id: `${role.toLowerCase()}_1`,
    role,
    email: `${role.toLowerCase()}@example.test`,
    name: role,
  };
}

describe("admin route guards", () => {
  beforeEach(() => {
    mocks.getAuthFromRequest.mockResolvedValue({ sub: "actor_1" });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("allows admins through class-manager and admin-only guards", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(authUser("ADMIN"));

    await expect(requireClassManager(req())).resolves.toBeNull();
    await expect(requireAdmin(req())).resolves.toBeNull();
  });

  it("allows coaches through the class-manager guard", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(authUser("COACH"));

    await expect(requireClassManager(req())).resolves.toBeNull();
  });

  it("keeps coaches out of admin-only guards", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(authUser("COACH"));

    const res = await requireAdmin(req());

    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
    await expect(res!.json()).resolves.toMatchObject({
      error: "UNAUTHORIZED",
    });
  });

  it("blocks regular users from class-manager permissions", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(authUser("USER"));

    const res = await requireClassManager(req());

    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    await expect(res!.json()).resolves.toMatchObject({
      error: "FORBIDDEN",
    });
  });
});
