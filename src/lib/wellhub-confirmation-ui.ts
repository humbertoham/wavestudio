import {
  WELLHUB_PLAN_CREDITS,
  WELLHUB_PLAN_LABELS,
  WELLHUB_PLANS,
} from "@/lib/wellhub-config";

export const WELLHUB_CONFIRMATION_COPY = {
  title: "Actualiza tu plan de WellHub",
  body:
    "Para continuar usando WAVE Studio, necesitamos que confirmes cuál es tu plan actual de WellHub. Esta actualización nos permite asignarte correctamente los créditos correspondientes a tu plan.",
  note: "Selecciona tu plan actual para continuar.",
  submit: "Guardar y continuar",
} as const;

export const WELLHUB_CONFIRMATION_DESTINATION = "/clases";

export const WELLHUB_CONFIRMATION_PLAN_OPTIONS = WELLHUB_PLANS.map(
  (value) => ({
    value,
    label: WELLHUB_PLAN_LABELS[value],
    credits: WELLHUB_PLAN_CREDITS[value],
  })
);

export function acquireWellhubSubmissionLock(lock: { current: boolean }) {
  if (lock.current) return false;
  lock.current = true;
  return true;
}

export function releaseWellhubSubmissionLock(lock: { current: boolean }) {
  lock.current = false;
}

export function submitWellhubConfirmationRequest(params: {
  selectedPlan: string;
  fetchImpl?: typeof fetch;
}) {
  const fetchImpl = params.fetchImpl ?? fetch;
  return fetchImpl("/api/users/me/wellhub-plan-confirmation", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wellhubPlan: params.selectedPlan }),
  });
}

export async function completeWellhubConfirmationNavigation(params: {
  refreshSession?: () => Promise<
    { wellhubPlanConfirmationRequired: boolean } | null | undefined
  >;
  replace: (destination: string) => void;
  refreshRouter?: () => void;
  sessionErrorMessage?: string;
}) {
  if (params.refreshSession) {
    const session = await params.refreshSession();
    if (!session || session.wellhubPlanConfirmationRequired) {
      throw new Error(
        params.sessionErrorMessage ??
          "No se pudo actualizar la sesión. Intenta continuar nuevamente."
      );
    }
  }

  params.replace(WELLHUB_CONFIRMATION_DESTINATION);
  params.refreshRouter?.();
  return WELLHUB_CONFIRMATION_DESTINATION;
}

export function validateWellhubConfirmationSelection(value: string) {
  return value ? null : "Selecciona tu plan actual de WellHub.";
}

export function isWellhubConfirmationSubmitDisabled(
  selectedPlan: string,
  saving: boolean
) {
  return saving || validateWellhubConfirmationSelection(selectedPlan) != null;
}
