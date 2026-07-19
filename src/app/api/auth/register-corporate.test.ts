import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

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

function registerRequest(
  affiliation: "WELLHUB" | "TOTALPASS",
  wellhubPlan?: string
) {
  const body: Record<string, unknown> = {
    name: "Corporate User",
    email: "corp@example.test",
    password: "password123",
    dateOfBirth: "1990-01-01",
    phone: "5555555555",
    emergencyPhone: "5555555556",
    affiliation,
  };

  if (wellhubPlan !== undefined) {
    body.wellhubPlan = wellhubPlan;
  }

  return registerRequestBody(body);
}

function registerRequestBody(body: Record<string, unknown>) {
  return new Request("https://example.test/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("registration validation", () => {
  beforeEach(() => {
    mocks.consumeRateLimit.mockResolvedValue({
      limited: false,
      remaining: 4,
      retryAfter: 0,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns field-specific Spanish messages for invalid signup fields", async () => {
    const res = await POST(
      registerRequestBody({
        name: "",
        email: "correo-invalido",
        password: "short",
        dateOfBirth: "2030-02-31",
        phone: "123",
        emergencyPhone: "",
        affiliation: "none",
      })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toMatchObject({
      error: "INVALID_BODY",
      message: "Ingresa tu nombre.",
    });
    expect(body.fields).toMatchObject({
      name: expect.arrayContaining(["Ingresa tu nombre."]),
      email: expect.arrayContaining(["Ingresa un correo electrónico válido."]),
      password: expect.arrayContaining([
        "La contraseña debe tener al menos 8 caracteres.",
      ]),
      dateOfBirth: expect.arrayContaining([
        "Ingresa una fecha de nacimiento válida.",
      ]),
      phone: expect.arrayContaining(["Ingresa un número de celular válido."]),
      emergencyPhone: expect.arrayContaining([
        "Ingresa un número de emergencias.",
      ]),
    });
    expect(mocks.prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("returns a safe duplicate-email message", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ id: "existing_user" });

    const res = await POST(registerRequest("TOTALPASS"));

    await expect(res.json()).resolves.toMatchObject({
      error: "EMAIL_IN_USE",
      message: "Ya existe una cuenta con este correo.",
    });
    expect(res.status).toBe(409);
  });

  it("requires WellHub plan when signing up with WellHub", async () => {
    const res = await POST(registerRequest("WELLHUB"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toMatchObject({
      error: "INVALID_BODY",
      fields: {
        wellhubPlan: expect.arrayContaining(["Selecciona tu plan de WellHub."]),
      },
    });
    expect(mocks.prisma.user.findUnique).not.toHaveBeenCalled();
  });
});

describe("corporate registration grants", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-01T06:00:00.000Z"));
    mocks.consumeRateLimit.mockResolvedValue({
      limited: false,
      remaining: 4,
      retryAfter: 0,
    });
    mocks.hash.mockResolvedValue("hashed_password");
    mocks.prisma.user.findUnique.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("grants WellHub signup credits from the selected plan", async () => {
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

    const res = await POST(registerRequest("WELLHUB", "PLATINUM"));

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({
      id: "user_1",
      email: "corp@example.test",
    });
    expect(tx.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        affiliation: "WELLHUB",
        wellhubPlan: "PLATINUM",
        affiliationConfirmedAt: expect.any(Date),
      }),
      select: { id: true, email: true },
    });
    expect(tx.pack.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "corp_wellhub_platinum_monthly" },
        update: expect.objectContaining({
          isActive: false,
          isVisible: false,
          classes: 8,
        }),
        create: expect.objectContaining({
          isActive: false,
          isVisible: false,
          classes: 8,
        }),
      })
    );
    expect(tx.packPurchase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user_1",
        packId: "corp_wellhub_platinum_monthly",
        classesLeft: 8,
        expiresAt: new Date("2026-05-01T05:00:00.000Z"),
      }),
      select: { id: true },
    });
    expect(tx.tokenLedger.create).toHaveBeenCalledWith({
      data: {
        userId: "user_1",
        packPurchaseId: "purchase_1",
        delta: 8,
        reason: "CORPORATE_MONTHLY",
      },
    });
  });

  it("clears WellHub plan input for non-WellHub signup", async () => {
    const tx = {
      user: {
        create: vi.fn().mockResolvedValue({
          id: "user_1",
          email: "corp@example.test",
        }),
      },
      pack: {
        upsert: vi.fn(),
      },
      packPurchase: {
        create: vi.fn(),
      },
      tokenLedger: {
        create: vi.fn(),
      },
    };
    mocks.prisma.$transaction.mockImplementation(async (callback: any) =>
      callback(tx)
    );

    const res = await POST(
      registerRequestBody({
        name: "No Plan User",
        email: "none@example.test",
        password: "password123",
        dateOfBirth: "1990-01-01",
        phone: "5555555555",
        emergencyPhone: "5555555556",
        affiliation: "none",
        wellhubPlan: "DIAMOND",
      })
    );

    expect(res.status).toBe(201);
    expect(tx.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        affiliation: "NONE",
        wellhubPlan: null,
        affiliationConfirmedAt: expect.any(Date),
      }),
      select: { id: true, email: true },
    });
    expect(tx.packPurchase.create).not.toHaveBeenCalled();
    expect(tx.tokenLedger.create).not.toHaveBeenCalled();
  });

  it("creates a normal signup with NONE affiliation", async () => {
    const tx = {
      user: {
        create: vi.fn().mockResolvedValue({
          id: "user_none",
          email: "none@example.test",
        }),
      },
      pack: {
        upsert: vi.fn(),
      },
      packPurchase: {
        create: vi.fn(),
      },
      tokenLedger: {
        create: vi.fn(),
      },
    };
    mocks.prisma.$transaction.mockImplementation(async (callback: any) =>
      callback(tx)
    );

    const res = await POST(
      registerRequestBody({
        name: "Normal User",
        email: "none@example.test",
        password: "password123",
        dateOfBirth: "1990-01-01",
        phone: "5555555555",
        emergencyPhone: "5555555556",
        affiliation: "NONE",
      })
    );

    expect(res.status).toBe(201);
    expect(tx.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        affiliation: "NONE",
        wellhubPlan: null,
        affiliationConfirmedAt: expect.any(Date),
      }),
      select: { id: true, email: true },
    });
    expect(tx.packPurchase.create).not.toHaveBeenCalled();
    expect(tx.tokenLedger.create).not.toHaveBeenCalled();
  });

  it("creates TotalPass signup credits without requiring a WellHub plan", async () => {
    const tx = {
      user: {
        create: vi.fn().mockResolvedValue({
          id: "user_totalpass",
          email: "totalpass@example.test",
        }),
      },
      pack: {
        upsert: vi.fn().mockResolvedValue({}),
      },
      packPurchase: {
        create: vi.fn().mockResolvedValue({ id: "purchase_totalpass" }),
      },
      tokenLedger: {
        create: vi.fn().mockResolvedValue({ id: "ledger_totalpass" }),
      },
    };
    mocks.prisma.$transaction.mockImplementation(async (callback: any) =>
      callback(tx)
    );

    const res = await POST(registerRequest("TOTALPASS"));

    expect(res.status).toBe(201);
    expect(tx.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        affiliation: "TOTALPASS",
        wellhubPlan: null,
        affiliationConfirmedAt: expect.any(Date),
      }),
      select: { id: true, email: true },
    });
    expect(tx.packPurchase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user_totalpass",
        packId: "corp_totalpass_monthly",
        classesLeft: 10,
      }),
      select: { id: true },
    });
    expect(tx.tokenLedger.create).toHaveBeenCalledWith({
      data: {
        userId: "user_totalpass",
        packPurchaseId: "purchase_totalpass",
        delta: 10,
        reason: "CORPORATE_MONTHLY",
      },
    });
  });

  it("returns a clear migration-required error when the database schema is missing columns", async () => {
    mocks.prisma.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Column missing", {
        code: "P2022",
        clientVersion: "6.16.2",
        meta: { column: "User.wellhubPlan" },
      })
    );

    const res = await POST(
      registerRequestBody({
        name: "Schema Drift User",
        email: "schema@example.test",
        password: "password123",
        dateOfBirth: "1990-01-01",
        phone: "5555555555",
        emergencyPhone: "5555555556",
        affiliation: "NONE",
      })
    );
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body).toMatchObject({
      error: "SCHEMA_MIGRATION_REQUIRED",
      message:
        "La base de datos de este ambiente no tiene las migraciones requeridas. Ejecuta las migraciones antes de registrar usuarios.",
    });
  });
});
