import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  findFirst: vi.fn(),
  count: vi.fn(),
  findMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/app/api/admin/_utils", () => ({
  requireAdmin: mocks.requireAdmin,
  prisma: {
    wellhubPlanConfirmation: {
      findFirst: mocks.findFirst,
      count: mocks.count,
      findMany: mocks.findMany,
    },
    $transaction: mocks.transaction,
  },
}));

import { GET } from "./route";

function req(query = "") {
  return new NextRequest(
    `https://wave.test/api/admin/wellhub-plan-confirmations${query}`
  );
}

describe("GET /api/admin/wellhub-plan-confirmations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue(null);
    mocks.transaction.mockImplementation(async (promises: Promise<unknown>[]) =>
      Promise.all(promises)
    );
  });

  it("is admin-only", async () => {
    mocks.requireAdmin.mockResolvedValue(
      NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
    );
    const response = await GET(req());
    expect(response.status).toBe(401);
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("returns an empty aggregate when no campaign exists", async () => {
    mocks.findFirst.mockResolvedValue(null);
    const response = await GET(req());
    await expect(response.json()).resolves.toMatchObject({
      campaign: null,
      totals: {
        included: 0,
        pending: 0,
        completed: 0,
        failedOrInconsistent: 0,
      },
      items: [],
    });
  });

  it("uses server-side pagination and exposes campaign progress", async () => {
    mocks.count
      .mockResolvedValueOnce(52)
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(40)
      .mockResolvedValueOnce(1);
    mocks.findMany.mockResolvedValue([
      {
        id: "confirmation_1",
        status: "COMPLETED",
        requestedAt: new Date(),
        confirmedAt: new Date(),
        previousPlan: "GOLD_PLUS",
        selectedPlan: "PLATINUM",
        creditDeltaApplied: 6,
        resultingBalance: 13,
        user: {
          id: "user_1",
          name: "User",
          email: "user@example.test",
          affiliation: "WELLHUB",
          wellhubPlan: "PLATINUM",
          wellhubPlanConfirmationRequired: false,
          wellhubPlanConfirmedAt: new Date(),
          wellhubPlanConfirmationCampaign: "campaign-1",
        },
      },
    ]);

    const response = await GET(
      req("?campaign=campaign-1&page=2&pageSize=25")
    );
    await expect(response.json()).resolves.toMatchObject({
      campaign: "campaign-1",
      totals: {
        included: 52,
        pending: 12,
        completed: 40,
        failedOrInconsistent: 1,
      },
      page: 2,
      pageSize: 25,
      totalPages: 3,
    });
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 25, take: 25 })
    );
  });
});
