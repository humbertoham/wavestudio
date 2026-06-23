import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthFromRequest: vi.fn(),
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  getAuthFromRequest: mocks.getAuthFromRequest,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

import { PATCH } from "./route";

function req(role = "COACH") {
  return new Request("https://example.test/api/admin/users/user_1/role", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role }),
  }) as any;
}

function ctx(id = "user_1") {
  return { params: Promise.resolve({ id }) };
}

describe("PATCH /api/admin/users/[id]/role", () => {
  beforeEach(() => {
    mocks.getAuthFromRequest.mockResolvedValue({ sub: "admin_1" });
    mocks.prisma.user.findUnique.mockResolvedValue({
      id: "admin_1",
      role: "ADMIN",
      email: "admin@example.test",
      name: "Admin",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("lets admins assign supported roles", async () => {
    mocks.prisma.user.update.mockResolvedValue({
      id: "user_1",
      role: "COACH",
    });

    const res = await PATCH(req("COACH"), ctx());

    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      user: {
        id: "user_1",
        role: "COACH",
      },
    });
    expect(res.status).toBe(200);
    expect(mocks.prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: { role: "COACH" },
      select: {
        id: true,
        role: true,
      },
    });
  });

  it("blocks non-admin role updates", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({
      id: "coach_1",
      role: "COACH",
      email: "coach@example.test",
      name: "Coach",
    });

    const res = await PATCH(req("ADMIN"), ctx());

    await expect(res.json()).resolves.toMatchObject({
      error: "FORBIDDEN",
    });
    expect(res.status).toBe(403);
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });

  it("prevents admins from changing their own role", async () => {
    const res = await PATCH(req("USER"), ctx("admin_1"));

    await expect(res.json()).resolves.toMatchObject({
      error: "CANNOT_CHANGE_OWN_ROLE",
    });
    expect(res.status).toBe(400);
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });

  it("rejects unsupported roles", async () => {
    const res = await PATCH(req("OWNER"), ctx());

    await expect(res.json()).resolves.toMatchObject({
      error: "INVALID_ROLE",
    });
    expect(res.status).toBe(400);
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });
});
