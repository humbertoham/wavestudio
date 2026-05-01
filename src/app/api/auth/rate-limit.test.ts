import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeRateLimit: vi.fn(),
  getClientIp: vi.fn(() => "203.0.113.25"),
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(),
    passwordResetToken: {
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
  },
  compareHash: vi.fn(),
  hash: vi.fn(),
  signToken: vi.fn(),
  resend: {
    emails: {
      send: vi.fn(),
    },
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  consumeRateLimit: mocks.consumeRateLimit,
  getClientIp: mocks.getClientIp,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/lib/hash", () => ({
  compareHash: mocks.compareHash,
  hash: mocks.hash,
}));

vi.mock("@/lib/jwt", () => ({
  signToken: mocks.signToken,
}));

vi.mock("@/lib/resend", () => ({
  resend: mocks.resend,
}));

import { POST as loginPost } from "./login/route";
import { POST as registerPost } from "./register/route";
import { POST as forgotPasswordPost } from "./forgot-password/route";

describe("auth route rate limiting", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("blocks login after the configured limiter is exhausted", async () => {
    mocks.consumeRateLimit.mockResolvedValue({
      limited: true,
      remaining: 0,
      retryAfter: 900,
    });

    const res = await loginPost(
      new Request("https://example.test/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "user@example.com",
          password: "password123",
        }),
      })
    );

    await expect(res.json()).resolves.toEqual({ error: "RATE_LIMITED" });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("900");
    expect(mocks.consumeRateLimit).toHaveBeenCalledWith(
      "login:203.0.113.25:user@example.com",
      { limit: 5, windowMs: 15 * 60 * 1000 }
    );
    expect(mocks.prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("blocks register attempts after the configured limiter is exhausted", async () => {
    mocks.consumeRateLimit.mockResolvedValue({
      limited: true,
      remaining: 0,
      retryAfter: 3600,
    });

    const res = await registerPost(
      new Request("https://example.test/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Test User",
          email: "new@example.com",
          password: "password123",
          dateOfBirth: "1990-01-01",
          phone: "5555555555",
          emergencyPhone: "5555555556",
          affiliation: "NONE",
        }),
      })
    );

    const body = await res.json();
    expect(res.status).toBe(429);
    expect(body.error).toBe("RATE_LIMITED");
    expect(mocks.consumeRateLimit).toHaveBeenCalledWith(
      "register:203.0.113.25",
      { limit: 5, windowMs: 60 * 60 * 1000 }
    );
    expect(mocks.prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("blocks forgot-password attempts after the configured limiter is exhausted", async () => {
    mocks.consumeRateLimit.mockResolvedValue({
      limited: true,
      remaining: 0,
      retryAfter: 900,
    });

    const res = await forgotPasswordPost(
      new Request("https://example.test/api/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "user@example.com" }),
      })
    );

    await expect(res.json()).resolves.toEqual({ error: "RATE_LIMITED" });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("900");
    expect(mocks.consumeRateLimit).toHaveBeenCalledWith(
      "forgot-password:203.0.113.25",
      { limit: 5, windowMs: 15 * 60 * 1000 }
    );
    expect(mocks.prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
