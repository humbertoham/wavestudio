import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  signToken: vi.fn(() => "signed-session"),
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  requireAuth: mocks.requireAuth,
}));

vi.mock("@/lib/jwt", () => ({
  signToken: mocks.signToken,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

import { POST } from "./route";

function req(body: Record<string, unknown>) {
  return new Request("https://example.test/api/users/me/affiliation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/users/me/affiliation", () => {
  beforeEach(() => {
    mocks.requireAuth.mockResolvedValue({ sub: "user_1", role: "USER" });
    mocks.prisma.user.findUnique.mockResolvedValue({
      id: "user_1",
      role: "USER",
      affiliationConfirmedAt: null,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("requires a WellHub plan during onboarding", async () => {
    const res = await POST(req({ affiliation: "WELLHUB" }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toMatchObject({
      error: "WELLHUB_PLAN_REQUIRED",
    });
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });

  it("completes onboarding and refreshes the session claim", async () => {
    mocks.prisma.user.update.mockResolvedValue({
      id: "user_1",
      name: "User",
      email: "user@example.test",
      role: "USER",
      affiliation: "WELLHUB",
      wellhubPlan: "GOLD_PLUS",
      affiliationConfirmedAt: new Date("2026-01-01T00:00:00.000Z"),
      authVersion: 0,
      wellhubPlanConfirmationRequired: false,
      wellhubPlanConfirmationCampaign: null,
    });

    const res = await POST(
      req({ affiliation: "WELLHUB", wellhubPlan: "GOLD_PLUS" })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      redirectTo: "/clases",
      user: {
        affiliation: "WELLHUB",
        wellhubPlan: "GOLD_PLUS",
        affiliationConfirmed: true,
      },
    });
    expect(mocks.prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: {
        affiliation: "WELLHUB",
        wellhubPlan: "GOLD_PLUS",
        affiliationConfirmedAt: expect.any(Date),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        affiliation: true,
        wellhubPlan: true,
        affiliationConfirmedAt: true,
        authVersion: true,
        wellhubPlanConfirmationRequired: true,
        wellhubPlanConfirmationCampaign: true,
      },
    });
    expect(mocks.signToken).toHaveBeenCalledWith({
      sub: "user_1",
      role: "USER",
      affiliationConfirmed: true,
      sessionVersion: 0,
      wellhubPlanConfirmationRequired: false,
      wellhubPlanConfirmationCampaign: null,
    });
  });

  it("does not allow users to change affiliation after confirmation", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({
      id: "user_1",
      role: "USER",
      affiliationConfirmedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const res = await POST(req({ affiliation: "NONE" }));

    expect(res.status).toBe(409);
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });
});
