import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  prisma: {
    user: {
      update: vi.fn(),
    },
  },
}));

vi.mock("../../../_utils", () => ({
  requireAdmin: mocks.requireAdmin,
  prisma: mocks.prisma,
}));

import { PATCH } from "./route";

function req(body: Record<string, unknown>) {
  return new Request("https://example.test/api/admin/users/user_1/details", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

function ctx(id = "user_1") {
  return { params: Promise.resolve({ id }) };
}

describe("PATCH /api/admin/users/[id]/details", () => {
  beforeEach(() => {
    mocks.requireAdmin.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("requires a WellHub plan when changing affiliation to WellHub", async () => {
    const res = await PATCH(req({ affiliation: "WELLHUB" }), ctx());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toMatchObject({
      ok: false,
      error: "WELLHUB_PLAN_REQUIRED",
    });
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });

  it("updates WellHub affiliation with a valid plan", async () => {
    mocks.prisma.user.update.mockResolvedValue({
      id: "user_1",
      affiliation: "WELLHUB",
      wellhubPlan: "DIAMOND_PLUS",
      affiliationConfirmedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const res = await PATCH(
      req({ affiliation: "WELLHUB", wellhubPlan: "DIAMOND_PLUS" }),
      ctx()
    );

    expect(res.status).toBe(200);
    expect(mocks.prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: {
        affiliation: "WELLHUB",
        wellhubPlan: "DIAMOND_PLUS",
        affiliationConfirmedAt: expect.any(Date),
      },
      select: {
        id: true,
        affiliation: true,
        wellhubPlan: true,
        affiliationConfirmedAt: true,
      },
    });
  });

  it("clears WellHub plan when changing to a non-WellHub affiliation", async () => {
    mocks.prisma.user.update.mockResolvedValue({
      id: "user_1",
      affiliation: "TOTALPASS",
      wellhubPlan: null,
      affiliationConfirmedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const res = await PATCH(
      req({ affiliation: "TOTALPASS", wellhubPlan: "PLATINUM" }),
      ctx()
    );

    expect(res.status).toBe(200);
    expect(mocks.prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          affiliation: "TOTALPASS",
          wellhubPlan: null,
        }),
      })
    );
  });
});
