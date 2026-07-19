import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getUserFromSession: vi.fn(),
  applyAdminAffiliationAndWellhubSync: vi.fn(),
  prisma: {
    $transaction: vi.fn(),
  },
}));

vi.mock("../../../_utils", () => ({
  requireAdmin: mocks.requireAdmin,
  getUserFromSession: mocks.getUserFromSession,
  prisma: mocks.prisma,
}));

vi.mock("@/lib/corporate-credits", async () => {
  const actual = await vi.importActual<typeof import("@/lib/corporate-credits")>(
    "@/lib/corporate-credits"
  );

  return {
    ...actual,
    applyAdminAffiliationAndWellhubSync:
      mocks.applyAdminAffiliationAndWellhubSync,
  };
});

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
    mocks.getUserFromSession.mockResolvedValue({ id: "admin_1" });
    mocks.prisma.$transaction.mockImplementation(async (callback: any) =>
      callback({ tx: true })
    );
    mocks.applyAdminAffiliationAndWellhubSync.mockResolvedValue({
      user: {
        id: "user_1",
        affiliation: "WELLHUB",
        wellhubPlan: "DIAMOND_PLUS",
        affiliationConfirmedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      previousBalance: 2,
      tokenBalance: 30,
      previousAffiliation: "WELLHUB",
      newAffiliation: "WELLHUB",
      previousWellhubPlan: "GOLD_PLUS",
      newWellhubPlan: "DIAMOND_PLUS",
      previousMonthlyEntitlement: 2,
      newMonthlyEntitlement: 30,
      creditDeltaApplied: 28,
      traceabilityCreated: true,
      ledgerEntryId: "ledger_1",
      cycleId: "2026-01",
    });
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
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("synchronizes affiliation, WellHub credits, and traceability in one transaction", async () => {
    const res = await PATCH(
      req({ affiliation: "WELLHUB", wellhubPlan: "DIAMOND_PLUS" }),
      ctx()
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.applyAdminAffiliationAndWellhubSync).toHaveBeenCalledWith(
      { tx: true },
      {
        userId: "user_1",
        nextAffiliation: "WELLHUB",
        nextWellhubPlan: "DIAMOND_PLUS",
        adminActorId: "admin_1",
      }
    );
    expect(body).toMatchObject({
      ok: true,
      tokenBalance: 30,
      wellhubSync: {
        creditDeltaApplied: 28,
        traceabilityCreated: true,
        ledgerEntryId: "ledger_1",
      },
    });
  });

  it("clears WellHub plan input when changing to a non-WellHub affiliation", async () => {
    const res = await PATCH(
      req({ affiliation: "TOTALPASS", wellhubPlan: "PLATINUM" }),
      ctx()
    );

    expect(res.status).toBe(200);
    expect(mocks.applyAdminAffiliationAndWellhubSync).toHaveBeenCalledWith(
      { tx: true },
      expect.objectContaining({
        nextAffiliation: "TOTALPASS",
        nextWellhubPlan: null,
      })
    );
  });

  it("rejects non-admin users before synchronizing credits", async () => {
    mocks.requireAdmin.mockResolvedValue(
      new Response(JSON.stringify({ error: "UNAUTHORIZED" }), { status: 401 })
    );

    const res = await PATCH(
      req({ affiliation: "WELLHUB", wellhubPlan: "PLATINUM" }),
      ctx()
    );

    expect(res.status).toBe(401);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.applyAdminAffiliationAndWellhubSync).not.toHaveBeenCalled();
  });

  it("does not report success when transactional synchronization fails", async () => {
    mocks.prisma.$transaction.mockRejectedValue(new Error("ledger failed"));

    const res = await PATCH(
      req({ affiliation: "WELLHUB", wellhubPlan: "PLATINUM" }),
      ctx()
    );
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toMatchObject({
      ok: false,
      message: "No se pudo actualizar la afiliacion.",
    });
  });
});
