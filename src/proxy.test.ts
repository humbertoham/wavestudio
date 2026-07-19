import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  jwtVerify: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("jose", () => ({
  jwtVerify: mocks.jwtVerify,
  errors: { JOSEError: class JOSEError extends Error {} },
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: mocks.findUnique } },
}));

import { middleware } from "../middleware";

function request(path: string) {
  return new NextRequest(`https://wave.test${path}`, {
    headers: { cookie: "session=signed-jwt" },
  });
}

function user(
  required: boolean,
  authVersion = 3,
  role = "USER",
  affiliation = "WELLHUB",
  affiliationConfirmedAt: Date | null = new Date()
) {
  return {
    role,
    affiliation,
    affiliationConfirmedAt,
    authVersion,
    wellhubPlanConfirmationRequired: required,
    wellhubPlanConfirmationCampaign: required ? "campaign-1" : null,
    wellhubPlanConfirmations: required ? [{ campaign: "campaign-1" }] : [],
  };
}

describe("WellHub confirmation proxy enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.jwtVerify.mockResolvedValue({
      payload: { sub: "user_1", role: "USER", sessionVersion: 3 },
    });
  });

  it("redirects direct page navigation for a flagged user", async () => {
    mocks.findUnique.mockResolvedValue(user(true));
    const response = await middleware(request("/perfil"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://wave.test/actualizar-plan-wellhub"
    );
  });

  it("blocks direct protected API calls server-side", async () => {
    mocks.findUnique.mockResolvedValue(user(true));
    const response = await middleware(request("/api/bookings"));
    expect(response.status).toBe(428);
    await expect(response.json()).resolves.toMatchObject({
      error: "WELLHUB_PLAN_CONFIRMATION_REQUIRED",
    });
  });

  it("keeps confirmation, plan, session, and logout endpoints accessible", async () => {
    mocks.findUnique.mockResolvedValue(user(true));
    for (const path of [
      "/actualizar-plan-wellhub",
      "/api/wellhub/plans",
      "/api/users/me/wellhub-plan-confirmation",
      "/api/auth/me",
      "/api/auth/logout",
    ]) {
      const response = await middleware(request(path));
      expect(response.status, path).toBe(200);
    }
  });

  it("makes the old version unusable and sends it through login", async () => {
    mocks.findUnique.mockResolvedValue(user(true, 4));
    const pageResponse = await middleware(request("/clases"));
    expect(pageResponse.status).toBe(307);
    expect(pageResponse.headers.get("location")).toContain(
      "next=%2Factualizar-plan-wellhub"
    );

    const apiResponse = await middleware(request("/api/bookings"));
    expect(apiResponse.status).toBe(401);
    await expect(apiResponse.json()).resolves.toMatchObject({
      error: "SESSION_INVALIDATED",
    });
  });

  it("accepts the new N+1 cookie immediately after confirmation", async () => {
    mocks.jwtVerify.mockResolvedValueOnce({
      payload: {
        sub: "user_1",
        role: "COACH",
        sessionVersion: 4,
        wellhubPlanConfirmationRequired: false,
        wellhubPlanConfirmationCampaign: "campaign-1",
      },
    });
    mocks.findUnique.mockResolvedValue(user(false, 4, "COACH"));
    const response = await middleware(request("/clases"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("does not exempt flagged admins or coaches and leaves unaffected users alone", async () => {
    mocks.findUnique.mockResolvedValue(user(true, 3, "ADMIN"));
    expect((await middleware(request("/admin"))).headers.get("location")).toBe(
      "https://wave.test/actualizar-plan-wellhub"
    );

    mocks.findUnique.mockResolvedValue(user(false));
    const response = await middleware(request("/clases"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("gives a pending WellHub campaign precedence over generic affiliation onboarding", async () => {
    mocks.findUnique.mockResolvedValue(
      user(true, 3, "USER", "WELLHUB", null)
    );

    const protectedResponse = await middleware(request("/clases"));
    expect(protectedResponse.headers.get("location")).toBe(
      "https://wave.test/actualizar-plan-wellhub"
    );

    const genericResponse = await middleware(request("/afiliacion"));
    expect(genericResponse.headers.get("location")).toBe(
      "https://wave.test/actualizar-plan-wellhub"
    );
  });

  it("leaves confirmed WellHub, TotalPass, and NONE users out of the campaign gate", async () => {
    for (const affiliation of ["WELLHUB", "TOTALPASS", "NONE"]) {
      mocks.findUnique.mockResolvedValue(
        user(false, 3, "USER", affiliation, new Date())
      );
      const response = await middleware(request("/clases"));
      expect(response.status, affiliation).toBe(200);
      expect(response.headers.get("x-middleware-next"), affiliation).toBe("1");
    }
  });

  it("keeps generic onboarding only for a genuinely incomplete user", async () => {
    mocks.findUnique.mockResolvedValue(user(false, 3, "USER", "NONE", null));

    const protectedResponse = await middleware(request("/clases"));
    expect(protectedResponse.headers.get("location")).toContain("/afiliacion");

    const onboardingResponse = await middleware(request("/afiliacion"));
    expect(onboardingResponse.status).toBe(200);
    expect(onboardingResponse.headers.get("x-middleware-next")).toBe("1");
  });

  it("does not trust a flag without canonical WellHub affiliation and a matching pending record", async () => {
    mocks.findUnique.mockResolvedValue({
      ...user(true, 3, "USER", "TOTALPASS", new Date()),
      wellhubPlanConfirmations: [{ campaign: "campaign-1" }],
    });
    expect((await middleware(request("/clases"))).status).toBe(200);

    mocks.findUnique.mockResolvedValue({
      ...user(true),
      wellhubPlanConfirmations: [],
    });
    expect((await middleware(request("/clases"))).status).toBe(200);
  });
});
