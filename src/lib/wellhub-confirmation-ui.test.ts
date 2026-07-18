import { afterEach, describe, expect, it, vi } from "vitest";

import {
  acquireWellhubSubmissionLock,
  completeWellhubConfirmationNavigation,
  finishWellhubSubmission,
  releaseWellhubSubmissionLock,
  submitWellhubConfirmationRequest,
  WELLHUB_CONFIRMATION_COPY,
  WELLHUB_CONFIRMATION_DESTINATION,
  WELLHUB_CONFIRMATION_MESSAGES,
  validateWellhubConfirmationSelection,
} from "./wellhub-confirmation-ui";
import {
  WELLHUB_PLAN_CREDITS,
  WELLHUB_PLAN_LABELS,
  WELLHUB_PLANS,
} from "./wellhub-config";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("WellHub confirmation UI contract", () => {
  it("provides the required Spanish blocking copy", () => {
    expect(WELLHUB_CONFIRMATION_COPY).toMatchObject({
      title: "Actualiza tu plan de WellHub",
      note: "Selecciona tu plan actual para continuar.",
      submit: "Guardar y continuar",
    });
    expect(WELLHUB_CONFIRMATION_COPY.body).toContain(
      "confirmes cuál es tu plan actual de WellHub"
    );
  });

  it("derives every display option and credit value from the canonical config", () => {
    expect(WELLHUB_PLANS).toEqual([
      "GOLD_PLUS",
      "PLATINUM",
      "DIAMOND",
      "DIAMOND_PLUS",
    ]);
    for (const plan of WELLHUB_PLANS) {
      expect(WELLHUB_PLAN_LABELS[plan]).toBeTruthy();
      expect(WELLHUB_PLAN_CREDITS[plan]).toBeGreaterThan(0);
    }
  });

  it("shows a useful validation error before an empty submission", () => {
    expect(validateWellhubConfirmationSelection("")).toContain("Selecciona");
    expect(validateWellhubConfirmationSelection("PLATINUM")).toBeNull();
  });

  it("allows only one active submission until a failure releases the lock", () => {
    const lock = { current: false };
    expect(acquireWellhubSubmissionLock(lock)).toBe(true);
    expect(acquireWellhubSubmissionLock(lock)).toBe(false);
    releaseWellhubSubmissionLock(lock);
    expect(acquireWellhubSubmissionLock(lock)).toBe(true);
  });

  it("keeps the button and lock active while successful navigation starts", () => {
    const lock = { current: true };
    const setSaving = vi.fn();

    finishWellhubSubmission({ lock, redirecting: true, setSaving });

    expect(lock.current).toBe(true);
    expect(setSaving).not.toHaveBeenCalled();
  });

  it("restores the button and releases the lock after a visible failure", () => {
    const lock = { current: true };
    const setSaving = vi.fn();

    finishWellhubSubmission({ lock, redirecting: false, setSaving });

    expect(lock.current).toBe(false);
    expect(setSaving).toHaveBeenCalledOnce();
    expect(setSaving).toHaveBeenCalledWith(false);
  });

  it("accepts only the current successful API contract", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      json({ ok: true, redirectTo: "/clases", sessionCookieWritten: true })
    );

    const result = await submitWellhubConfirmationRequest({
      selectedPlan: "GOLD_PLUS",
      fetchImpl,
    });

    expect(result).toMatchObject({
      kind: "success",
      status: 200,
      responseType: "json",
      redirectTo: "/clases",
      recoveryAttempted: false,
      requestAborted: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/users/me/wellhub-plan-confirmation",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ wellhubPlan: "GOLD_PLUS" }),
        signal: expect.any(AbortSignal),
      })
    );
    expect(fetchImpl.mock.calls[0]?.[0]).not.toBe("/api/auth/me");
  });

  it("accepts the same success contract for an already-confirmed recovery", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        ok: true,
        redirectTo: "/clases",
        alreadyConfirmed: true,
        sessionRecovered: true,
      })
    );

    await expect(
      submitWellhubConfirmationRequest({
        selectedPlan: "PLATINUM",
        fetchImpl,
      })
    ).resolves.toMatchObject({ kind: "success", redirectTo: "/clases" });
  });

  it("returns visible API errors for every relevant HTTP status", async () => {
    for (const status of [400, 401, 403, 409, 428, 500]) {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
        json(
          {
            ok: false,
            error: `SAFE_ERROR_${status}`,
            message: `Mensaje seguro ${status}`,
          },
          status
        )
      );

      const result = await submitWellhubConfirmationRequest({
        selectedPlan: "DIAMOND",
        fetchImpl,
      });

      expect(result).toMatchObject({
        kind: "api-error",
        status,
        code: `SAFE_ERROR_${status}`,
        responseType: "json",
      });
      if (result.kind !== "api-error") throw new Error("Expected API error");
      expect(result.message).toBeTruthy();
      if (status === 401 || status === 403) {
        expect(result.message).toBe(WELLHUB_CONFIRMATION_MESSAGES.session);
      } else if (status === 500) {
        expect(result.message).toBe(WELLHUB_CONFIRMATION_MESSAGES.server);
      } else {
        expect(result.message).toBe(`Mensaje seguro ${status}`);
      }
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it("rejects a 200 response when its body does not match the success contract", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ success: true, destination: "/clases" }));

    await expect(
      submitWellhubConfirmationRequest({
        selectedPlan: "DIAMOND_PLUS",
        fetchImpl,
      })
    ).resolves.toMatchObject({
      kind: "unexpected-response",
      status: 200,
      message: WELLHUB_CONFIRMATION_MESSAGES.unexpected,
    });
  });

  it("handles HTML, empty, and invalid JSON responses without exposing their body", async () => {
    const responses = [
      new Response("<html>Vercel authentication</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
      new Response(null, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
      new Response("not-json", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ];

    for (const response of responses) {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
      const result = await submitWellhubConfirmationRequest({
        selectedPlan: "PLATINUM",
        fetchImpl,
      });
      expect(result).toMatchObject({
        kind: "unexpected-response",
        message: WELLHUB_CONFIRMATION_MESSAGES.unexpected,
      });
      if (result.kind === "unexpected-response") {
        expect(result.message).not.toContain("<html>");
      }
    }
  });

  it("does not retry an explicit HTTP response", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ error: "CONFIRMATION_FAILED" }, 500));

    await expect(
      submitWellhubConfirmationRequest({
        selectedPlan: "DIAMOND",
        fetchImpl,
      })
    ).resolves.toMatchObject({ kind: "api-error", status: 500 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("recovers one lost network response using a fresh AbortController", async () => {
    const signals: AbortSignal[] = [];
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
      signals.push(init?.signal as AbortSignal);
      return signals.length === 1
        ? Promise.reject(new TypeError("lost response"))
        : Promise.resolve(
            json({
              ok: true,
              redirectTo: "/clases",
              alreadyConfirmed: true,
            })
          );
    });

    await expect(
      submitWellhubConfirmationRequest({
        selectedPlan: "PLATINUM",
        fetchImpl,
      })
    ).resolves.toMatchObject({
      kind: "success",
      recoveryAttempted: true,
      requestAborted: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(signals[0]).not.toBe(signals[1]);
    expect(signals[0]?.aborted).toBe(false);
    expect(signals[1]?.aborted).toBe(false);
  });

  it("returns a visible error after the single recovery attempt also fails", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("offline"));

    await expect(
      submitWellhubConfirmationRequest({
        selectedPlan: "DIAMOND_PLUS",
        fetchImpl,
      })
    ).resolves.toMatchObject({
      kind: "network-error",
      recoveryAttempted: true,
      message: WELLHUB_CONFIRMATION_MESSAGES.network,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("gives the recovery request a fresh per-request timeout", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
      const signal = init?.signal as AbortSignal;
      signals.push(signal);
      if (signals.length === 1) {
        return Promise.reject(new TypeError("lost response"));
      }
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    });

    const request = submitWellhubConfirmationRequest({
      selectedPlan: "PLATINUM",
      fetchImpl,
      timeoutMs: 100,
    });
    await vi.advanceTimersByTimeAsync(100);

    await expect(request).resolves.toMatchObject({
      kind: "timeout",
      recoveryAttempted: true,
      requestAborted: true,
      message: WELLHUB_CONFIRMATION_MESSAGES.network,
    });
    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
    expect(signals[1]?.aborted).toBe(true);
  });

  it("aborts a hanging first request and restores an actionable timeout error", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>((_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      })
    );
    const request = submitWellhubConfirmationRequest({
      selectedPlan: "PLATINUM",
      fetchImpl,
      timeoutMs: 100,
    });
    await vi.advanceTimersByTimeAsync(100);

    await expect(request).resolves.toMatchObject({
      kind: "timeout",
      recoveryAttempted: false,
      requestAborted: true,
      message: WELLHUB_CONFIRMATION_MESSAGES.network,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not retry a non-network exception", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("client failure"));

    await expect(
      submitWellhubConfirmationRequest({
        selectedPlan: "PLATINUM",
        fetchImpl,
      })
    ).resolves.toMatchObject({
      kind: "network-error",
      recoveryAttempted: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("calls router.replace exactly once without session refresh", async () => {
    const replace = vi.fn();

    await expect(
      completeWellhubConfirmationNavigation({ replace })
    ).resolves.toBe(WELLHUB_CONFIRMATION_DESTINATION);

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/clases");
  });

  it("does not navigate when the affiliation flow still has pending auth state", async () => {
    const replace = vi.fn();

    await expect(
      completeWellhubConfirmationNavigation({
        refreshSession: async () => ({
          wellhubPlanConfirmationRequired: true,
        }),
        replace,
        refreshRouter: vi.fn(),
      })
    ).rejects.toThrow("sesión");
    expect(replace).not.toHaveBeenCalled();
  });
});
