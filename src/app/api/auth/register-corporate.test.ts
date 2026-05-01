import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeRateLimit: vi.fn(),
  getClientIp: vi.fn(() => "203.0.113.55"),
  hash: vi.fn(),
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  consumeRateLimit: mocks.consumeRateLimit,
  getClientIp: mocks.getClientIp,
}));

vi.mock("@/lib/hash", () => ({
  hash: mocks.hash,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

import { POST } from "./register/route";

function registerRequest(affiliation: "WELLHUB" | "TOTALPASS") {
  return new Request("https://example.test/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Corporate User",
      email: "corp@example.test",
      password: "password123",
      dateOfBirth: "1990-01-01",
      phone: "5555555555",
      emergencyPhone: "5555555556",
      affiliation,
    }),
  });
}

describe("corporate registration grants", () => {
  beforeEach(() => {
    mocks.consumeRateLimit.mockResolvedValue({
      limited: false,
      remaining: 4,
      retryAfter: 0,
    });
    mocks.hash.mockResolvedValue("hashed_password");
    mocks.prisma.user.findUnique.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates internal inactive/hidden corporate packs but still grants PackPurchase credits", async () => {
    const tx = {
      user: {
        create: vi.fn().mockResolvedValue({
          id: "user_1",
          email: "corp@example.test",
        }),
      },
      pack: {
        upsert: vi.fn().mockResolvedValue({ id: "corp_wellhub_monthly" }),
      },
      packPurchase: {
        create: vi.fn().mockResolvedValue({ id: "purchase_1" }),
      },
      tokenLedger: {
        create: vi.fn().mockResolvedValue({ id: "ledger_1" }),
      },
    };
    mocks.prisma.$transaction.mockImplementation(async (callback: any) =>
      callback(tx)
    );

    const res = await POST(registerRequest("WELLHUB"));

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({
      id: "user_1",
      email: "corp@example.test",
    });
    expect(tx.pack.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "corp_wellhub_monthly" },
        update: expect.objectContaining({
          isActive: false,
          isVisible: false,
          classes: 15,
        }),
        create: expect.objectContaining({
          isActive: false,
          isVisible: false,
          classes: 15,
        }),
      })
    );
    expect(tx.packPurchase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user_1",
        packId: "corp_wellhub_monthly",
        classesLeft: 15,
      }),
      select: { id: true },
    });
    expect(tx.tokenLedger.create).toHaveBeenCalledWith({
      data: {
        userId: "user_1",
        packPurchaseId: "purchase_1",
        delta: 15,
        reason: "CORPORATE_MONTHLY",
      },
    });
  });
});
