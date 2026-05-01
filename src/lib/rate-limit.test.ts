import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function loadRateLimitModule() {
  vi.resetModules();
  delete (globalThis as any).__waveRateLimitStore;
  return import("./rate-limit");
}

describe("rate-limit storage", () => {
  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses the in-memory fallback when Upstash env vars are missing", async () => {
    const { consumeRateLimit } = await loadRateLimitModule();

    await expect(
      consumeRateLimit("login:127.0.0.1:user@example.com", {
        limit: 2,
        windowMs: 60_000,
      })
    ).resolves.toMatchObject({ limited: false, remaining: 1 });

    await expect(
      consumeRateLimit("login:127.0.0.1:user@example.com", {
        limit: 2,
        windowMs: 60_000,
      })
    ).resolves.toMatchObject({ limited: false, remaining: 0 });

    await expect(
      consumeRateLimit("login:127.0.0.1:user@example.com", {
        limit: 2,
        windowMs: 60_000,
      })
    ).resolves.toMatchObject({ limited: true, remaining: 0 });
  });

  it("uses Upstash Redis REST when configured", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://upstash.example.test";
    process.env.UPSTASH_REDIS_REST_TOKEN = "token";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: 1 }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: 1 }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: 15_000 }), { status: 200 })
      );
    vi.stubGlobal("fetch", fetchMock);

    const { consumeRateLimit } = await loadRateLimitModule();

    await expect(
      consumeRateLimit("register:203.0.113.10", {
        limit: 5,
        windowMs: 60_000,
      })
    ).resolves.toEqual({
      limited: false,
      remaining: 4,
      retryAfter: 15,
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://upstash.example.test",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(["INCR", "rate-limit:register:203.0.113.10"]),
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://upstash.example.test",
      expect.objectContaining({
        body: JSON.stringify([
          "PEXPIRE",
          "rate-limit:register:203.0.113.10",
          60_000,
        ]),
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://upstash.example.test",
      expect.objectContaining({
        body: JSON.stringify(["PTTL", "rate-limit:register:203.0.113.10"]),
      })
    );
  });

  it("falls back to memory if Redis fails", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://upstash.example.test";
    process.env.UPSTASH_REDIS_REST_TOKEN = "token";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const { consumeRateLimit } = await loadRateLimitModule();

    await expect(
      consumeRateLimit("forgot-password:198.51.100.4", {
        limit: 1,
        windowMs: 60_000,
      })
    ).resolves.toMatchObject({ limited: false, remaining: 0 });

    await expect(
      consumeRateLimit("forgot-password:198.51.100.4", {
        limit: 1,
        windowMs: 60_000,
      })
    ).resolves.toMatchObject({ limited: true, remaining: 0 });
  });
});
