import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOptionalServerEnv: vi.fn(),
  prisma: {
    pack: {
      upsert: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/env", () => ({
  getOptionalServerEnv: mocks.getOptionalServerEnv,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

import { GET } from "./route";

function cronReq() {
  return new Request("https://example.test/api/internal/monthly-renewal", {
    headers: { authorization: "Bearer cron-secret" },
  });
}

describe("GET /api/internal/monthly-renewal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-01T12:00:00.000Z"));
    mocks.getOptionalServerEnv.mockReturnValue("cron-secret");
    mocks.prisma.pack.upsert.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("grants monthly WellHub credits according to selected plan and keeps TotalPass behavior", async () => {
    const currentUsers: Record<string, unknown> = {
      wellhub_1: {
        affiliation: "WELLHUB",
        wellhubPlan: "DIAMOND",
      },
      totalpass_1: {
        affiliation: "TOTALPASS",
        wellhubPlan: null,
      },
    };
    const tx = {
      user: {
        findUnique: vi.fn(({ where }: any) =>
          Promise.resolve(currentUsers[where.id] ?? null)
        ),
      },
      tokenLedger: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "ledger_1" }),
      },
      packPurchase: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi
          .fn()
          .mockResolvedValueOnce({ id: "purchase_wellhub" })
          .mockResolvedValueOnce({ id: "purchase_totalpass" }),
      },
    };

    mocks.prisma.user.findMany.mockResolvedValue([
      { id: "wellhub_1", affiliation: "WELLHUB", wellhubPlan: "DIAMOND" },
      { id: "totalpass_1", affiliation: "TOTALPASS", wellhubPlan: null },
      { id: "none_1", affiliation: "NONE", wellhubPlan: null },
    ]);
    mocks.prisma.$transaction.mockImplementation(async (callback: any) =>
      callback(tx)
    );

    const res = await GET(cronReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      renewedUsers: 2,
      skippedNoneAffiliation: 1,
    });
    expect(tx.packPurchase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "wellhub_1",
        packId: "corp_wellhub_diamond_monthly",
        classesLeft: 30,
      }),
      select: { id: true },
    });
    expect(tx.packPurchase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "totalpass_1",
        packId: "corp_totalpass_monthly",
        classesLeft: 10,
      }),
      select: { id: true },
    });
    expect(tx.tokenLedger.create).toHaveBeenCalledWith({
      data: {
        userId: "wellhub_1",
        packPurchaseId: "purchase_wellhub",
        delta: 30,
        reason: "CORPORATE_MONTHLY",
      },
    });
    expect(tx.tokenLedger.create).toHaveBeenCalledWith({
      data: {
        userId: "totalpass_1",
        packPurchaseId: "purchase_totalpass",
        delta: 10,
        reason: "CORPORATE_MONTHLY",
      },
    });
  });

  it("does not duplicate monthly credits when a ledger row already exists for the month", async () => {
    const tx = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          affiliation: "WELLHUB",
          wellhubPlan: "GOLD_PLUS",
        }),
      },
      tokenLedger: {
        findFirst: vi.fn().mockResolvedValue({ id: "existing_ledger" }),
        create: vi.fn(),
      },
      packPurchase: {
        updateMany: vi.fn(),
        create: vi.fn(),
      },
    };

    mocks.prisma.user.findMany.mockResolvedValue([
      { id: "wellhub_1", affiliation: "WELLHUB", wellhubPlan: "GOLD_PLUS" },
    ]);
    mocks.prisma.$transaction.mockImplementation(async (callback: any) =>
      callback(tx)
    );

    const res = await GET(cronReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      renewedUsers: 0,
      skippedAlreadyRenewed: 1,
    });
    expect(tx.packPurchase.create).not.toHaveBeenCalled();
    expect(tx.tokenLedger.create).not.toHaveBeenCalled();
  });
});
