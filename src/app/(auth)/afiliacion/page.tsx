"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useSession } from "@/lib/useSession";
import { affiliationOnboardingRedirect } from "@/lib/affiliation-gate";
import { completeWellhubConfirmationNavigation } from "@/lib/wellhub-confirmation-ui";
import {
  WELLHUB_PLAN_CREDITS,
  WELLHUB_PLAN_LABELS,
  WELLHUB_PLANS,
  type WellhubPlanValue,
} from "@/lib/wellhub-config";

type Affiliation = "" | "NONE" | "WELLHUB" | "TOTALPASS";
type WellhubPlan = WellhubPlanValue;

function readApiMessage(payload: unknown, fallback: string) {
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

function AffiliationOnboardingInner() {
  const router = useRouter();
  const { user, isLoading, refresh } = useSession();

  const [affiliation, setAffiliation] = useState<Affiliation>("");
  const [wellhubPlan, setWellhubPlan] = useState<WellhubPlan | "">("");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const redirectTo = affiliationOnboardingRedirect(user);

  useEffect(() => {
    if (isLoading) return;

    if (!user) {
      router.replace(`/login?next=${encodeURIComponent("/afiliacion")}`);
      return;
    }

    if (redirectTo) router.replace(redirectTo);
  }, [isLoading, redirectTo, router, user]);

  if (isLoading || !user || redirectTo) {
    return <div className="p-6 text-center">Cargando...</div>;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);

    if (!affiliation) {
      setErrorMsg("Debes seleccionar tu afiliacion para continuar.");
      return;
    }

    if (affiliation === "WELLHUB" && !wellhubPlan) {
      setErrorMsg("Selecciona tu plan de WellHub.");
      return;
    }

    setSaving(true);
    let redirecting = false;

    try {
      const res = await fetch("/api/users/me/affiliation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          affiliation,
          wellhubPlan: affiliation === "WELLHUB" ? wellhubPlan : null,
        }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(
          readApiMessage(payload, "No se pudo guardar tu afiliacion.")
        );
      }

      await completeWellhubConfirmationNavigation({
        refreshSession: refresh,
        replace: router.replace,
        refreshRouter: router.refresh,
        sessionErrorMessage:
          "Tu afiliación se guardó, pero no se pudo actualizar la sesión. Intenta continuar nuevamente.",
      });
      redirecting = true;
    } catch (error) {
      setErrorMsg(
        error instanceof Error
          ? error.message
          : "No se pudo guardar tu afiliacion."
      );
    } finally {
      if (!redirecting) setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-[color:var(--color-background)] px-4 text-[color:var(--color-foreground)] transition-colors">
      <main className="mx-auto max-w-lg py-12">
        <div className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-8 shadow-lg transition-colors">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-[color:var(--color-card-foreground)]">
              Afiliacion
            </h1>
            <p className="mt-1 text-sm text-[color:var(--color-muted-foreground)]">
              Debes seleccionar tu afiliacion para continuar.
            </p>
          </div>

          {errorMsg && (
            <div className="mb-4 rounded-xl border border-red-400 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300">
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium text-[color:var(--color-card-foreground)]">
                Afiliacion
              </legend>

              {[
                ["NONE", "Ninguna"],
                ["WELLHUB", "WellHub"],
                ["TOTALPASS", "TotalPass"],
              ].map(([value, label]) => (
                <label
                  key={value}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-[color:var(--color-input)] px-4 py-3"
                >
                  <span className="font-medium">{label}</span>
                  <input
                    type="radio"
                    name="affiliation"
                    value={value}
                    checked={affiliation === value}
                    onChange={() => {
                      setAffiliation(value as Affiliation);
                      if (value !== "WELLHUB") setWellhubPlan("");
                    }}
                  />
                </label>
              ))}
            </fieldset>

            {affiliation === "WELLHUB" && (
              <div className="space-y-2">
                <label
                  htmlFor="wellhubPlan"
                  className="block text-sm font-medium text-[color:var(--color-card-foreground)]"
                >
                  Plan en WellHub
                </label>
                <select
                  id="wellhubPlan"
                  value={wellhubPlan}
                  onChange={(e) => setWellhubPlan(e.target.value as WellhubPlan)}
                  className="w-full rounded-xl border border-[color:var(--color-input)] bg-[color:var(--color-card)] px-4 py-2.5 text-[color:var(--color-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                  required
                >
                  <option value="">Selecciona tu plan</option>
                  {WELLHUB_PLANS.map((plan) => (
                    <option key={plan} value={plan}>
                      {WELLHUB_PLAN_LABELS[plan]} -{" "}
                      {WELLHUB_PLAN_CREDITS[plan]} creditos mensuales
                    </option>
                  ))}
                </select>
                <p className="text-xs text-[color:var(--color-muted-foreground)]">
                  Este plan determina tus creditos mensuales automaticos.
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={saving || isLoading}
              className="w-full rounded-xl py-2.5 font-medium text-white transition focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              style={{
                backgroundColor: "var(--color-primary)",
                opacity: saving || isLoading ? 0.9 : 1,
              }}
            >
              {saving ? "Guardando..." : "Continuar"}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}

export default function AffiliationOnboardingPage() {
  return (
    <Suspense fallback={<div className="p-6 text-center">Cargando...</div>}>
      <AffiliationOnboardingInner />
    </Suspense>
  );
}
