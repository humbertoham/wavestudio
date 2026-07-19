import { afterEach, describe, expect, it, vi } from "vitest";

import {
  acquireWellhubSubmissionLock,
  completeWellhubConfirmationNavigation,
  releaseWellhubSubmissionLock,
  submitWellhubConfirmationRequest,
  WELLHUB_CONFIRMATION_COPY,
  WELLHUB_CONFIRMATION_DESTINATION,
  validateWellhubConfirmationSelection,
} from "./wellhub-confirmation-ui";
import {
  WELLHUB_PLAN_CREDITS,
  WELLHUB_PLAN_LABELS,
  WELLHUB_PLANS,
} from "./wellhub-config";

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

  it("allows only one active submission until the lock is released", () => {
    const lock = { current: false };
    expect(acquireWellhubSubmissionLock(lock)).toBe(true);
    expect(acquireWellhubSubmissionLock(lock)).toBe(false);
    releaseWellhubSubmissionLock(lock);
    expect(acquireWellhubSubmissionLock(lock)).toBe(true);
  });

  it("sends exactly one POST with the selected plan and no auth refresh", async () => {
    const response = new Response(JSON.stringify({ ok: true }), {
      status: 200,
    });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);

    await expect(
      submitWellhubConfirmationRequest({
        selectedPlan: "GOLD_PLUS",
        fetchImpl,
      })
    ).resolves.toBe(response);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/users/me/wellhub-plan-confirmation",
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wellhubPlan: "GOLD_PLUS" }),
      }
    );
    expect(fetchImpl.mock.calls[0]?.[0]).not.toBe("/api/auth/me");
  });

  it("does not automatically retry an HTTP error", async () => {
    const response = new Response(
      JSON.stringify({ error: "CONFIRMATION_FAILED" }),
      { status: 500 }
    );
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);

    await expect(
      submitWellhubConfirmationRequest({
        selectedPlan: "DIAMOND",
        fetchImpl,
      })
    ).resolves.toBe(response);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not automatically retry a real fetch rejection", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("offline"));

    await expect(
      submitWellhubConfirmationRequest({
        selectedPlan: "DIAMOND_PLUS",
        fetchImpl,
      })
    ).rejects.toThrow("offline");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not abort a pending request with an artificial timer", async () => {
    vi.useFakeTimers();
    let resolveRequest!: (response: Response) => void;
    const response = new Response(JSON.stringify({ ok: true }), {
      status: 200,
    });
    const fetchImpl = vi.fn<typeof fetch>(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        })
    );

    const request = submitWellhubConfirmationRequest({
      selectedPlan: "PLATINUM",
      fetchImpl,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[1]).not.toHaveProperty("signal");

    resolveRequest(response);
    await expect(request).resolves.toBe(response);
  });

  it("replaces history without an unnecessary second session request", async () => {
    const calls: string[] = [];

    await expect(
      completeWellhubConfirmationNavigation({
        replace: (destination) => calls.push(`replace:${destination}`),
      })
    ).resolves.toBe(WELLHUB_CONFIRMATION_DESTINATION);

    expect(calls).toEqual(["replace:/clases"]);
  });

  it("does not navigate when refreshed affiliation auth state is still pending", async () => {
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
