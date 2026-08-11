import { describe, expect, it, vi } from "vitest";

import { validateCheckin } from "@/lib/wellhub/client";

const config = {
  enabled: true as const,
  apiBaseUrl: "https://apitesting.partners.gympass.com/access/v1",
  apiToken: "fake-token",
  gymId: "129",
  webhookSecret: "fake-secret",
  timeoutMs: 100,
};

function errorResponse(status: number, key = `HTTP_${status}`) {
  return new Response(
    JSON.stringify({
      metadata: { total: 0, errors: 1 },
      errors: [{ key, message: `Wellhub error ${status}` }],
    }),
    { status }
  );
}

describe("Wellhub Access Control client", () => {
  it("authorizes a valid ticket and sends the documented contract", async () => {
    const fetchImpl = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        Response.json({
          metadata: { total: 1, errors: 0 },
          results: {
            user: { gympass_id: "1000000000003" },
            gym: { id: 129, product: { id: 2, description: "Test" } },
            validated_at: "2026-08-11T12:00:00Z",
          },
        })
    );

    const result = await validateCheckin(
      { externalUserId: "1000000000003", config },
      { fetchImpl: fetchImpl as typeof fetch }
    );

    expect(result).toEqual({
      kind: "authorized",
      validatedAt: new Date("2026-08-11T12:00:00Z"),
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      "https://apitesting.partners.gympass.com/access/v1/validate"
    );
    expect(options).toMatchObject({
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: "Bearer fake-token",
        "X-Gym-Id": "129",
      },
      body: JSON.stringify({ gympass_id: "1000000000003" }),
    });
  });

  it("treats a documented 404 missing ticket as rejection", async () => {
    const result = await validateCheckin(
      { externalUserId: "1000000000003", config },
      {
        fetchImpl: vi.fn(async () =>
          errorResponse(404, "checkin.validation.notfound")
        ) as typeof fetch,
      }
    );

    expect(result).toMatchObject({
      kind: "rejected",
      httpStatus: 404,
      code: "checkin.validation.notfound",
    });
  });

  it("treats a documented 400 invalid ticket as rejection", async () => {
    const result = await validateCheckin(
      { externalUserId: "1000000000003", config },
      {
        fetchImpl: vi.fn(async () =>
          errorResponse(400, "checkin.validation.expired")
        ) as typeof fetch,
      }
    );

    expect(result).toMatchObject({
      kind: "rejected",
      httpStatus: 400,
      code: "checkin.validation.expired",
    });
  });

  it.each([401, 403])("classifies %s as a non-retryable auth error", async (status) => {
    const result = await validateCheckin(
      { externalUserId: "1000000000003", config },
      {
        fetchImpl: vi.fn(async () => errorResponse(status)) as typeof fetch,
      }
    );

    expect(result).toMatchObject({
      kind: "error",
      category: "AUTH",
      httpStatus: status,
      retryable: false,
    });
  });

  it("classifies 429 as a retryable rate-limit error", async () => {
    const result = await validateCheckin(
      { externalUserId: "1000000000003", config },
      { fetchImpl: vi.fn(async () => errorResponse(429)) as typeof fetch }
    );

    expect(result).toMatchObject({
      kind: "error",
      category: "RATE_LIMIT",
      retryable: true,
    });
  });

  it("classifies 500 as a retryable server error", async () => {
    const result = await validateCheckin(
      { externalUserId: "1000000000003", config },
      { fetchImpl: vi.fn(async () => errorResponse(500)) as typeof fetch }
    );

    expect(result).toMatchObject({
      kind: "error",
      category: "SERVER",
      retryable: true,
    });
  });

  it("rejects malformed success JSON", async () => {
    const result = await validateCheckin(
      { externalUserId: "1000000000003", config },
      {
        fetchImpl: vi.fn(async () => new Response("{", { status: 200 })) as typeof fetch,
      }
    );

    expect(result).toMatchObject({
      kind: "error",
      category: "MALFORMED_RESPONSE",
      code: "MALFORMED_SUCCESS_JSON",
    });
  });

  it("classifies network failures without leaking the cause", async () => {
    const result = await validateCheckin(
      { externalUserId: "1000000000003", config },
      {
        fetchImpl: vi.fn(async () => {
          throw new Error("connect ECONNREFUSED bearer=fake-token");
        }) as typeof fetch,
      }
    );

    expect(result).toEqual({
      kind: "error",
      category: "NETWORK",
      code: "WELLHUB_NETWORK_ERROR",
      message: "Wellhub validation request failed.",
      retryable: true,
    });
  });

  it("aborts requests at the configured timeout", async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, options?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        })
    );

    const result = await validateCheckin(
      { externalUserId: "1000000000003", config },
      { fetchImpl: fetchImpl as typeof fetch }
    );

    expect(result).toMatchObject({
      kind: "error",
      category: "TIMEOUT",
      retryable: true,
    });
  });
});
