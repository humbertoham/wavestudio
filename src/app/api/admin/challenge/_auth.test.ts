import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getUserFromSession: vi.fn() }));

vi.mock("@/app/api/admin/_utils", () => ({
  getUserFromSession: mocks.getUserFromSession,
}));

import { requireChallengeAdmin } from "./_auth";

const req = () => new Request("https://example.test/api/admin/challenge") as any;

describe("Challenge admin authorization", () => {
  it("returns 401 to unauthenticated requests", async () => {
    mocks.getUserFromSession.mockResolvedValue(null);
    const result = await requireChallengeAdmin(req());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it.each(["USER", "COACH"])("returns 403 to %s", async (role) => {
    mocks.getUserFromSession.mockResolvedValue({
      id: "user_1",
      name: "User",
      email: "user@example.test",
      role,
    });
    const result = await requireChallengeAdmin(req());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
      await expect(result.response.json()).resolves.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("allows administrators", async () => {
    mocks.getUserFromSession.mockResolvedValue({
      id: "admin_1",
      name: "Admin",
      email: "admin@example.test",
      role: "ADMIN",
    });
    const result = await requireChallengeAdmin(req());
    expect(result).toMatchObject({ ok: true, user: { id: "admin_1" } });
  });
});
