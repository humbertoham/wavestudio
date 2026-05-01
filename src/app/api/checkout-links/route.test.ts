import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthFromRequest: vi.fn(),
  prisma: {
    pack: {
      findUnique: vi.fn(),
    },
    packPurchase: {
      findFirst: vi.fn(),
    },
    checkoutLink: {
      create: vi.fn(),
      update: vi.fn(),
    },
    payment: {
      create: vi.fn(),
      update: vi.fn(),
    },
  },
  MercadoPagoConfig: vi.fn(),
  Preference: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getAuthFromRequest: mocks.getAuthFromRequest,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("mercadopago", () => ({
  MercadoPagoConfig: mocks.MercadoPagoConfig,
  Preference: mocks.Preference,
}));

import { POST } from "./route";

function checkoutRequest(packId: string) {
  return new Request("https://example.test/api/checkout-links", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ packId }),
  });
}

describe("POST /api/checkout-links", () => {
  beforeEach(() => {
    process.env.MP_ACCESS_TOKEN = "APP_USR-test-token";
    process.env.APP_BASE_URL = "https://wavestudio.example";
    mocks.getAuthFromRequest.mockResolvedValue({ sub: "user_1" });
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.MP_ACCESS_TOKEN;
    delete process.env.APP_BASE_URL;
  });

  it("rejects hidden/internal packs before creating checkout records", async () => {
    mocks.prisma.pack.findUnique.mockResolvedValue({
      id: "corp_wellhub_monthly",
      name: "Wellhub Mensual (Interno)",
      classes: 15,
      price: 0,
      validityDays: 31,
      classesLabel: "15 clases",
      isActive: false,
      isVisible: false,
      oncePerUser: false,
    });

    const res = await POST(checkoutRequest("corp_wellhub_monthly"));

    await expect(res.json()).resolves.toEqual({ error: "PACK_NOT_AVAILABLE" });
    expect(res.status).toBe(409);
    expect(mocks.prisma.checkoutLink.create).not.toHaveBeenCalled();
    expect(mocks.prisma.payment.create).not.toHaveBeenCalled();
    expect(mocks.Preference).not.toHaveBeenCalled();
  });

  it("rejects inactive packs even if they are visible", async () => {
    mocks.prisma.pack.findUnique.mockResolvedValue({
      id: "inactive_pack",
      name: "Inactive Pack",
      classes: 5,
      price: 500,
      validityDays: 30,
      classesLabel: "5 clases",
      isActive: false,
      isVisible: true,
      oncePerUser: false,
    });

    const res = await POST(checkoutRequest("inactive_pack"));

    await expect(res.json()).resolves.toEqual({ error: "PACK_NOT_AVAILABLE" });
    expect(res.status).toBe(409);
    expect(mocks.prisma.checkoutLink.create).not.toHaveBeenCalled();
  });

  it("rejects hidden packs even if they are active", async () => {
    mocks.prisma.pack.findUnique.mockResolvedValue({
      id: "internal_active_pack",
      name: "Internal Active Pack",
      classes: 5,
      price: 500,
      validityDays: 30,
      classesLabel: "5 clases",
      isActive: true,
      isVisible: false,
      oncePerUser: false,
    });

    const res = await POST(checkoutRequest("internal_active_pack"));

    await expect(res.json()).resolves.toEqual({ error: "PACK_NOT_AVAILABLE" });
    expect(res.status).toBe(409);
    expect(mocks.prisma.checkoutLink.create).not.toHaveBeenCalled();
  });
});
