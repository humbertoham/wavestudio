import { WellhubPlan } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class ConfirmationError extends Error {
    constructor(public code: string) {
      super(code);
    }
  }
  return {
    ConfirmationError,
    requireAuth: vi.fn(),
    getVerifiedSessionCookiePayload: vi.fn(),
    transaction: vi.fn(),
    confirm: vi.fn(),
    issueSessionCookie: vi.fn(),
    getRecoverable: vi.fn(),
    getCompleted: vi.fn(),
  };
});

vi.mock("@/lib/auth", () => ({
  requireAuth: mocks.requireAuth,
  getVerifiedSessionCookiePayload: mocks.getVerifiedSessionCookiePayload,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: mocks.transaction },
}));
vi.mock("@/lib/session-cookie", () => ({
  issueSessionCookie: mocks.issueSessionCookie,
}));
vi.mock("@/lib/wellhub-session-recovery", () => ({
  getRecoverableWellhubSessionState: mocks.getRecoverable,
  getCompletedWellhubSessionState: mocks.getCompleted,
}));
vi.mock("@/lib/wellhub-plan-confirmation", () => ({
  WELLHUB_CONFIRMATION_MAX_RETRIES: 3,
  WellhubPlanConfirmationError: mocks.ConfirmationError,
  confirmWellhubPlanInTransaction: mocks.confirm,
}));

import { POST } from "./route";

function req(body: unknown, cookie = "session=signed-session") {
  return new Request("http://localhost/api/users/me/wellhub-plan-confirmation", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

const sessionUser = {
  id: "user_self",
  role: "COACH" as const,
  affiliationConfirmedAt: new Date("2026-01-01T00:00:00.000Z"),
  authVersion: 6,
  wellhubPlanConfirmationRequired: false,
  wellhubPlanConfirmationCampaign: "campaign-1",
};
const result = {
  campaign: "campaign-1",
  previousPlan: WellhubPlan.GOLD_PLUS,
  selectedPlan: WellhubPlan.PLATINUM,
  previousMonthlyEntitlement: 2,
  newMonthlyEntitlement: 8,
  creditDeltaApplied: 6,
  resultingBalance: 11,
  ledgerEntryId: "ledger_1",
  confirmedAt: new Date(),
  accessRestored: true,
  authVersionBefore: 5,
  authVersionAfter: 6,
  sessionUser,
};

describe("POST /api/users/me/wellhub-plan-confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({
      sub: "user_self",
      role: "COACH",
      affiliationConfirmed: true,
      sessionVersion: 5,
      wellhubPlanConfirmationRequired: true,
      wellhubPlanConfirmationCampaign: "campaign-1",
    });
    mocks.getVerifiedSessionCookiePayload.mockResolvedValue(null);
    mocks.confirm.mockResolvedValue(result);
    mocks.transaction.mockImplementation(async (callback: any) => callback({}));
    mocks.getRecoverable.mockResolvedValue(null);
    mocks.getCompleted.mockResolvedValue(null);
    mocks.issueSessionCookie.mockImplementation((response: any) => {
      response.cookies.set({
        name: "session",
        value: "new-token",
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      });
    });
  });

  it("rejects unauthenticated and unsupported/malformed plan submissions", async () => {
    mocks.requireAuth.mockRejectedValueOnce(new Error("UNAUTHORIZED"));
    expect((await POST(req({ wellhubPlan: "PLATINUM" }, ""))).status).toBe(401);

    for (const plan of ["gold+", "PLATINUM ", "LEGACY", null, 8]) {
      const response = await POST(req({ wellhubPlan: plan }));
      expect(response.status, String(plan)).toBe(400);
    }
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("accepts every canonical plan and ignores a mismatched body user ID", async () => {
    for (const plan of Object.values(WellhubPlan)) {
      const response = await POST(
        req({ wellhubPlan: plan, userId: "another-user" })
      );
      expect(response.status, plan).toBe(200);
      expect(mocks.confirm).toHaveBeenLastCalledWith(
        {},
        expect.objectContaining({
          userId: "user_self",
          selectedPlan: plan,
          expectedAuthVersion: 5,
        })
      );
    }
  });

  it("returns committed credit state and writes the N+1 session cookie", async () => {
    const response = await POST(req({ wellhubPlan: "PLATINUM" }));
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      redirectTo: "/clases",
      sessionCookieWritten: true,
      alreadyConfirmed: false,
      confirmation: {
        campaign: "campaign-1",
        creditDeltaApplied: 6,
        resultingBalance: 11,
        authVersionBefore: 5,
        authVersionAfter: 6,
      },
    });
    expect(response.headers.get("set-cookie")).toContain("session=new-token");
    expect(mocks.issueSessionCookie).toHaveBeenCalledWith(
      response,
      expect.any(Request),
      expect.objectContaining({
        id: "user_self",
        role: "COACH",
        authVersion: 6,
        wellhubPlanConfirmationRequired: false,
      })
    );
  });

  it("repairs a lost cookie response from only a verified recoverable transition", async () => {
    const stalePayload = {
      sub: "user_self",
      role: "COACH",
      sessionVersion: 5,
      wellhubPlanConfirmationRequired: true,
      wellhubPlanConfirmationCampaign: "campaign-1",
    };
    mocks.requireAuth.mockRejectedValueOnce(new Error("UNAUTHORIZED"));
    mocks.getVerifiedSessionCookiePayload.mockResolvedValueOnce(stalePayload);
    mocks.getRecoverable.mockResolvedValueOnce(sessionUser);

    const response = await POST(req({ wellhubPlan: "PLATINUM" }));
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      alreadyConfirmed: true,
      sessionRecovered: true,
      redirectTo: "/clases",
    });
    expect(mocks.getRecoverable).toHaveBeenCalledWith(stalePayload);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain("session=new-token");
  });

  it("rejects a signed stale cookie when it is not the exact recoverable transition", async () => {
    mocks.requireAuth.mockRejectedValueOnce(new Error("UNAUTHORIZED"));
    mocks.getVerifiedSessionCookiePayload.mockResolvedValueOnce({
      sub: "user_self",
      role: "USER",
      sessionVersion: 2,
    });
    const response = await POST(req({ wellhubPlan: "PLATINUM" }));
    await expect(response.json()).resolves.toMatchObject({
      error: "SESSION_RECOVERY_NOT_AVAILABLE",
    });
    expect(response.status).toBe(401);
    expect(mocks.issueSessionCookie).not.toHaveBeenCalled();
  });

  it("turns an already-confirmed retry into a side-effect-free session repair", async () => {
    mocks.confirm.mockRejectedValueOnce(
      new mocks.ConfirmationError("CONFIRMATION_NOT_REQUIRED")
    );
    mocks.getCompleted.mockResolvedValueOnce(sessionUser);
    const response = await POST(req({ wellhubPlan: "PLATINUM" }));
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      alreadyConfirmed: true,
      sessionRecovered: false,
      redirectTo: "/clases",
    });
    expect(mocks.issueSessionCookie).toHaveBeenCalledTimes(1);
  });

  it("does not recover a non-WellHub or incomplete confirmation", async () => {
    mocks.confirm.mockRejectedValueOnce(
      new mocks.ConfirmationError("NOT_WELLHUB")
    );
    const response = await POST(req({ wellhubPlan: "PLATINUM" }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "NOT_WELLHUB",
    });
    expect(mocks.getCompleted).not.toHaveBeenCalled();
    expect(mocks.issueSessionCookie).not.toHaveBeenCalled();
  });

  it("reports database and post-commit cookie/signing failures without a false success", async () => {
    mocks.transaction.mockRejectedValueOnce(new Error("database unavailable"));
    const databaseFailure = await POST(req({ wellhubPlan: "PLATINUM" }));
    expect(databaseFailure.status).toBe(500);
    await expect(databaseFailure.json()).resolves.toMatchObject({
      error: "CONFIRMATION_FAILED",
    });

    mocks.issueSessionCookie.mockImplementationOnce(() => {
      throw new Error("signing failed");
    });
    const cookieFailure = await POST(req({ wellhubPlan: "PLATINUM" }));
    expect(cookieFailure.status).toBe(500);
    await expect(cookieFailure.json()).resolves.toMatchObject({
      error: "SESSION_RENEWAL_FAILED",
    });
  });
});
