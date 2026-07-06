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

function cronReq(secret = "cron-secret") {
  return new Request("https://example.test/api/internal/monthly-renewal", {
    headers: { authorization: `Bearer ${secret}` },
  });
}

describe("GET /api/internal/monthly-renewal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T05:00:00.000Z"));
    mocks.getOptionalServerEnv.mockReturnValue("cron-secret");
    mocks.prisma.pack.upsert.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("rejects missing and invalid CRON_SECRET safely", async () => {
    mocks.getOptionalServerEnv.mockReturnValueOnce("");
    const missing = await GET(cronReq());

    expect(missing.status).toBe(500);
    await expect(missing.json()).resolves.toMatchObject({
      ok: false,
      message: "CRON_SECRET_MISSING",
    });

    mocks.getOptionalServerEnv.mockReturnValueOnce("cron-secret");
    const invalid = await GET(cronReq("wrong-secret"));

    expect(invalid.status).toBe(401);
    await expect(invalid.json()).resolves.toMatchObject({
      ok: false,
      message: "UNAUTHORIZED",
    });
  });

  it("grants production corporate credits and skips NONE", async () => {
    const currentUsers: Record<string, unknown> = {
      wellhub_1: { affiliation: "WELLHUB" },
      totalpass_1: { affiliation: "TOTALPASS" },
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
      { id: "wellhub_1", affiliation: "WELLHUB" },
      { id: "totalpass_1", affiliation: "TOTALPASS" },
      { id: "none_1", affiliation: "NONE" },
    ]);
    mocks.prisma.$transaction.mockImplementation(async (callback: any) =>
      callback(tx)
    );

    const res = await GET(cronReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      periodKey: "2026-05",
      renewedUsers: 2,
      skippedNoneAffiliation: 1,
      expiresAt: "2026-06-01T05:00:00.000Z",
    });

    expect(tx.packPurchase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "wellhub_1",
        packId: "corp_wellhub_monthly",
        classesLeft: 15,
        expiresAt: new Date("2026-06-01T05:00:00.000Z"),
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
    expect(tx.tokenLedger.findFirst).toHaveBeenCalledWith({
      where: {
        userId: "wellhub_1",
        reason: "CORPORATE_MONTHLY",
        createdAt: {
          gte: new Date("2026-05-01T05:00:00.000Z"),
          lt: new Date("2026-06-01T06:00:00.000Z"),
        },
      },
      select: { id: true },
    });
  });

  it("does not duplicate credits when a ledger row already exists for the target month", async () => {
    const tx = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ affiliation: "WELLHUB" }),
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
      { id: "wellhub_1", affiliation: "WELLHUB" },
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
