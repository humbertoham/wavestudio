import { Prisma } from "@prisma/client";
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

function txForUser(user: {
  affiliation: "NONE" | "WELLHUB" | "TOTALPASS";
  wellhubPlan: "GOLD_PLUS" | "PLATINUM" | "DIAMOND" | "DIAMOND_PLUS" | null;
}) {
  return {
    user: {
      findUnique: vi.fn().mockResolvedValue(user),
    },
    tokenLedger: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "ledger_1" }),
    },
    packPurchase: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockResolvedValue({ id: "purchase_1" }),
      aggregate: vi.fn().mockResolvedValue({ _sum: { classesLeft: 8 } }),
    },
  };
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

  it("rejects cron requests without valid authentication", async () => {
    const res = await GET(cronReq("wrong-secret"));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toMatchObject({
      ok: false,
      message: "UNAUTHORIZED",
    });
    expect(mocks.prisma.user.findMany).not.toHaveBeenCalled();
  });

  it("uses the latest persisted WellHub plan and writes a cycle idempotency key", async () => {
    const tx = txForUser({
      affiliation: "WELLHUB",
      wellhubPlan: "PLATINUM",
    });
    mocks.prisma.user.findMany.mockResolvedValue([{ id: "wellhub_1" }]);
    mocks.prisma.$transaction.mockImplementation(async (callback: any) =>
      callback(tx)
    );

    const res = await GET(cronReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      cycleId: "2026-04",
      granted: 1,
      renewedUsers: 1,
    });
    expect(tx.packPurchase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "wellhub_1",
        packId: "corp_wellhub_platinum_monthly",
        classesLeft: 8,
      }),
      select: { id: true },
    });
    expect(tx.tokenLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "wellhub_1",
        packPurchaseId: "purchase_1",
        delta: 8,
        reason: "CORPORATE_MONTHLY",
        idempotencyKey: "corporate-renewal:2026-04:wellhub_1",
        metadata: expect.objectContaining({
          source: "MONTHLY_CORPORATE_RENEWAL",
          cycleId: "2026-04",
          monthlyEntitlement: 8,
        }),
      }),
    });
  });

  it("keeps TotalPass renewal behavior unchanged", async () => {
    const tx = txForUser({
      affiliation: "TOTALPASS",
      wellhubPlan: null,
    });
    tx.packPurchase.aggregate.mockResolvedValue({ _sum: { classesLeft: 10 } });
    mocks.prisma.user.findMany.mockResolvedValue([{ id: "totalpass_1" }]);
    mocks.prisma.$transaction.mockImplementation(async (callback: any) =>
      callback(tx)
    );

    const res = await GET(cronReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.granted).toBe(1);
    expect(tx.packPurchase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "totalpass_1",
        packId: "corp_totalpass_monthly",
        classesLeft: 10,
      }),
      select: { id: true },
    });
  });

  it("does not duplicate monthly credits when the cycle key already exists", async () => {
    const tx = txForUser({
      affiliation: "WELLHUB",
      wellhubPlan: "GOLD_PLUS",
    });
    tx.tokenLedger.findUnique.mockResolvedValue({ id: "existing_ledger" });
    mocks.prisma.user.findMany.mockResolvedValue([{ id: "wellhub_1" }]);
    mocks.prisma.$transaction.mockImplementation(async (callback: any) =>
      callback(tx)
    );

    const res = await GET(cronReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      granted: 0,
      alreadyRenewed: 1,
      skippedAlreadyRenewed: 1,
    });
    expect(tx.packPurchase.create).not.toHaveBeenCalled();
    expect(tx.tokenLedger.create).not.toHaveBeenCalled();
  });

  it("treats a concurrent unique-key conflict as already renewed", async () => {
    mocks.prisma.user.findMany.mockResolvedValue([{ id: "wellhub_1" }]);
    mocks.prisma.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique", {
        code: "P2002",
        clientVersion: "6.16.2",
        meta: { target: ["idempotencyKey"] },
      })
    );

    const res = await GET(cronReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      granted: 0,
      alreadyRenewed: 1,
    });
  });

  it("skips users with NONE affiliation", async () => {
    const tx = txForUser({
      affiliation: "NONE",
      wellhubPlan: null,
    });
    mocks.prisma.user.findMany.mockResolvedValue([{ id: "none_1" }]);
    mocks.prisma.$transaction.mockImplementation(async (callback: any) =>
      callback(tx)
    );

    const res = await GET(cronReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      granted: 0,
      skipped: 1,
      skippedNoneAffiliation: 1,
    });
    expect(tx.packPurchase.create).not.toHaveBeenCalled();
  });

  it("continues processing other users when one user fails", async () => {
    const successTx = txForUser({
      affiliation: "WELLHUB",
      wellhubPlan: "PLATINUM",
    });
    mocks.prisma.user.findMany.mockResolvedValue([
      { id: "fail_1" },
      { id: "wellhub_1" },
    ]);
    mocks.prisma.$transaction
      .mockRejectedValueOnce(new Error("row failed"))
      .mockImplementationOnce(async (callback: any) => callback(successTx));

    const res = await GET(cronReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: false,
      processed: 2,
      granted: 1,
      failed: 1,
    });
    expect(successTx.packPurchase.create).toHaveBeenCalled();
  });
});
