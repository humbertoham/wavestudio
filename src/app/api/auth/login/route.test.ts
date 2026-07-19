import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  compareHash: vi.fn(),
  consumeRateLimit: vi.fn(),
  findUnique: vi.fn(),
  getClientIp: vi.fn(() => "203.0.113.10"),
  issueSessionCookie: vi.fn(),
}));

vi.mock("@/lib/hash", () => ({ compareHash: mocks.compareHash }));
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: mocks.findUnique } },
}));
vi.mock("@/lib/rate-limit", () => ({
  consumeRateLimit: mocks.consumeRateLimit,
  getClientIp: mocks.getClientIp,
}));
vi.mock("@/lib/session-cookie", () => ({
  issueSessionCookie: mocks.issueSessionCookie,
}));

import { POST } from "./route";

function request() {
  return new Request("https://wave.test/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "fixture@example.test",
      password: "fixture-password",
    }),
  });
}

function user({
  affiliation = "WELLHUB",
  required = true,
  pendingCampaigns = ["campaign-1"],
}: {
  affiliation?: "WELLHUB" | "TOTALPASS" | "NONE" | null;
  required?: boolean;
  pendingCampaigns?: string[];
} = {}) {
  return {
    id: "fixture-user",
    role: "USER",
    affiliation,
    affiliationConfirmedAt: null,
    authVersion: 1,
    wellhubPlanConfirmationRequired: required,
    wellhubPlanConfirmationCampaign: required ? "campaign-1" : null,
    wellhubPlanConfirmations: pendingCampaigns.map((campaign) => ({ campaign })),
    passwordHash: "stored-hash",
  };
}

describe("POST /api/auth/login WellHub redirect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.consumeRateLimit.mockResolvedValue({
      limited: false,
      remaining: 4,
      retryAfter: 0,
    });
    mocks.compareHash.mockResolvedValue(true);
  });

  it("returns the canonical confirmation destination for a pending WellHub campaign user", async () => {
    const persistedUser = user();
    mocks.findUnique.mockResolvedValue(persistedUser);

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      wellhubPlanConfirmationRequired: true,
      redirectTo: "/actualizar-plan-wellhub",
    });
    expect(mocks.issueSessionCookie).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Request),
      persistedUser
    );
    expect(mocks.findUnique).toHaveBeenCalledTimes(1);
  });

  it("does not redirect TotalPass, NONE, or unmatched campaign state to WellHub", async () => {
    for (const persistedUser of [
      user({ affiliation: "TOTALPASS" }),
      user({ affiliation: "NONE" }),
      user({ affiliation: null }),
      user({ pendingCampaigns: ["other-campaign"] }),
      user({ required: false, pendingCampaigns: [] }),
    ]) {
      mocks.findUnique.mockResolvedValueOnce(persistedUser);
      const response = await POST(request());
      expect((await response.json()).redirectTo).toBeNull();
    }
  });
});
