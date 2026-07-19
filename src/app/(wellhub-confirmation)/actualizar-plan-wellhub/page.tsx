"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  acquireWellhubSubmissionLock,
  isWellhubConfirmationSubmitDisabled,
  releaseWellhubSubmissionLock,
  submitWellhubConfirmationRequest,
  WELLHUB_CONFIRMATION_COPY,
  WELLHUB_CONFIRMATION_DESTINATION,
  WELLHUB_CONFIRMATION_PLAN_OPTIONS,
  validateWellhubConfirmationSelection,
} from "@/lib/wellhub-confirmation-ui";
import type { WellhubPlanValue } from "@/lib/wellhub-config";

function readMessage(payload: unknown, fallback: string) {
  if (
    payload &&
    typeof payload === "object" &&
    "message" in payload &&
    typeof (payload as { message?: unknown }).message === "string"
  ) {
    return (payload as { message: string }).message;
  }
  return fallback;
}

export default function UpdateWellhubPlanPage() {
  const router = useRouter();
  const [selectedPlan, setSelectedPlan] = useState<WellhubPlanValue | "">("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submissionLock = useRef(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const validationError = validateWellhubConfirmationSelection(
      selectedPlan
    );
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!acquireWellhubSubmissionLock(submissionLock)) return;

    setSaving(true);
    setError(null);
    let redirecting = false;
    try {
      let res: Response;
      try {
        res = await submitWellhubConfirmationRequest({ selectedPlan });
      } catch {
        setError("No pudimos conectar con el servidor. Intenta nuevamente.");
        return;
      }

      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        setError(
          res.status === 401 || res.status === 403
            ? "Tu sesión expiró. Inicia sesión nuevamente."
            : readMessage(
                payload,
                "No pudimos guardar tu plan. Intenta nuevamente."
              )
        );
        return;
      }

      window.location.replace(WELLHUB_CONFIRMATION_DESTINATION);
      redirecting = true;
    } finally {
      if (!redirecting) {
        releaseWellhubSubmissionLock(submissionLock);
        setSaving(false);
      }
    }
  }

  async function logout() {
    if (saving) return;
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    }).catch(() => null);
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-[color:var(--color-background)] px-4 py-8 text-[color:var(--color-foreground)] sm:py-12">
      <main className="mx-auto w-full max-w-2xl">
        <div className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-5 shadow-lg sm:p-8">
          <header className="mb-6 space-y-3">
            <p className="text-sm font-semibold uppercase tracking-wide text-[var(--color-primary)]">
              WAVE Studio
            </p>
            <h1 className="text-2xl font-semibold text-[color:var(--color-card-foreground)] sm:text-3xl">
              {WELLHUB_CONFIRMATION_COPY.title}
            </h1>
            <p className="text-sm leading-6 text-[color:var(--color-muted-foreground)] sm:text-base">
              {WELLHUB_CONFIRMATION_COPY.body}
            </p>
            <p className="font-medium text-[color:var(--color-card-foreground)]">
              {WELLHUB_CONFIRMATION_COPY.note}
            </p>
          </header>

          {error && (
            <div
              role="alert"
              className="mb-5 rounded-xl border border-red-400 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300"
            >
              {error}
            </div>
          )}

          <form onSubmit={submit} className="space-y-5">
              <fieldset className="grid gap-3 sm:grid-cols-2">
                <legend className="sr-only">Plan actual de WellHub</legend>
                {WELLHUB_CONFIRMATION_PLAN_OPTIONS.map((plan) => (
                  <label
                    key={plan.value}
                    className={`cursor-pointer rounded-xl border p-4 transition ${
                      selectedPlan === plan.value
                        ? "border-[var(--color-primary)] bg-[color:var(--color-muted)]"
                        : "border-[color:var(--color-input)]"
                    }`}
                  >
                    <span className="flex items-start justify-between gap-3">
                      <span>
                        <span className="block font-semibold">{plan.label}</span>
                        <span className="mt-1 block text-sm text-[color:var(--color-muted-foreground)]">
                          {plan.credits} créditos mensuales
                        </span>
                      </span>
                      <input
                        type="radio"
                        name="wellhubPlan"
                        value={plan.value}
                        checked={selectedPlan === plan.value}
                        onChange={() => {
                          setSelectedPlan(plan.value);
                          setError(null);
                        }}
                        disabled={saving}
                      />
                    </span>
                  </label>
                ))}
              </fieldset>

              <button
                type="submit"
                disabled={isWellhubConfirmationSubmitDisabled(
                  selectedPlan,
                  saving
                )}
                className="w-full rounded-xl bg-[var(--color-primary)] px-4 py-3 font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving
                  ? "Guardando y sincronizando créditos..."
                  : WELLHUB_CONFIRMATION_COPY.submit}
              </button>
              <button
                type="button"
                onClick={logout}
                disabled={saving}
                className="w-full rounded-xl border border-[color:var(--color-input)] px-4 py-3 text-sm font-medium disabled:opacity-60"
              >
                Cerrar sesión
              </button>
          </form>
        </div>
      </main>
    </div>
  );
}
