"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  completeWellhubConfirmationNavigation,
  WELLHUB_CONFIRMATION_COPY,
  WELLHUB_CONFIRMATION_DESTINATION,
  validateWellhubConfirmationSelection,
} from "@/lib/wellhub-confirmation-ui";
import { useSession } from "@/lib/useSession";
import type { WellhubPlanValue } from "@/lib/wellhub-config";

type PlanOption = {
  value: WellhubPlanValue;
  label: string;
  credits: number;
};

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
  const { user, isLoading: sessionLoading } = useSession();
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<WellhubPlanValue | "">("");
  const [plansLoading, setPlansLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (sessionLoading) return;
    if (!user) {
      router.replace(
        `/login?next=${encodeURIComponent("/actualizar-plan-wellhub")}`
      );
      return;
    }
    if (!user.wellhubPlanConfirmationRequired) {
      router.replace(WELLHUB_CONFIRMATION_DESTINATION);
      return;
    }

    let cancelled = false;
    setPlansLoading(true);
    fetch("/api/wellhub/plans", { credentials: "include" })
      .then(async (res) => {
        const payload = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(
            readMessage(payload, "No se pudieron cargar los planes.")
          );
        }
        return payload as { plans?: PlanOption[] };
      })
      .then((payload) => {
        if (!cancelled) setPlans(payload.plans ?? []);
      })
      .catch((fetchError) => {
        if (!cancelled) {
          setError(
            fetchError instanceof Error
              ? fetchError.message
              : "No se pudieron cargar los planes."
          );
        }
      })
      .finally(() => {
        if (!cancelled) setPlansLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [router, sessionLoading, user]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;

    const validationError = validateWellhubConfirmationSelection(
      selectedPlan
    );
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);
    let redirecting = false;
    try {
      const res = await fetch(
        "/api/users/me/wellhub-plan-confirmation",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wellhubPlan: selectedPlan }),
        }
      );
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          readMessage(
            payload,
            "No se pudo guardar tu plan ni sincronizar tus créditos. Intenta de nuevo."
          )
        );
      }

      await completeWellhubConfirmationNavigation({
        replace: router.replace,
        refreshRouter: router.refresh,
      });
      redirecting = true;
    } catch (submitError) {
      setError(
        submitError instanceof TypeError
          ? "No recibimos la respuesta de confirmación. Presiona Guardar y continuar para recuperar tu sesión sin repetir tus créditos."
          : submitError instanceof Error
          ? submitError.message
          : "No se pudo guardar tu plan. Intenta de nuevo."
      );
    } finally {
      if (!redirecting) setSaving(false);
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

  const loading = sessionLoading || plansLoading;

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

          {loading ? (
            <div className="rounded-xl border border-[color:var(--color-border)] px-4 py-8 text-center text-sm text-[color:var(--color-muted-foreground)]">
              Cargando planes de WellHub...
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-5">
              <fieldset className="grid gap-3 sm:grid-cols-2">
                <legend className="sr-only">Plan actual de WellHub</legend>
                {plans.map((plan) => (
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
                disabled={saving || plans.length === 0}
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
          )}
        </div>
      </main>
    </div>
  );
}
