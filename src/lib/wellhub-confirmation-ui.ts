export const WELLHUB_CONFIRMATION_COPY = {
  title: "Actualiza tu plan de WellHub",
  body:
    "Para continuar usando WAVE Studio, necesitamos que confirmes cuál es tu plan actual de WellHub. Esta actualización nos permite asignarte correctamente los créditos correspondientes a tu plan.",
  note: "Selecciona tu plan actual para continuar.",
  submit: "Guardar y continuar",
} as const;

export const WELLHUB_CONFIRMATION_DESTINATION = "/clases";
export const WELLHUB_CONFIRMATION_REQUEST_TIMEOUT_MS = 12_000;

export function acquireWellhubSubmissionLock(lock: { current: boolean }) {
  if (lock.current) return false;
  lock.current = true;
  return true;
}

export function releaseWellhubSubmissionLock(lock: { current: boolean }) {
  lock.current = false;
}

export async function submitWellhubConfirmationRequest(params: {
  selectedPlan: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}) {
  const fetchImpl = params.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    params.timeoutMs ?? WELLHUB_CONFIRMATION_REQUEST_TIMEOUT_MS
  );
  const send = () =>
    fetchImpl("/api/users/me/wellhub-plan-confirmation", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wellhubPlan: params.selectedPlan }),
      signal: controller.signal,
    });
  const sendWithTimeoutError = async () => {
    try {
      return await send();
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(
          "La confirmación tardó demasiado y fue cancelada. Intenta nuevamente."
        );
      }
      throw error;
    }
  };

  try {
    try {
      return await sendWithTimeoutError();
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      // Retry immediately within the same total timeout. There is no backoff.
      return await sendWithTimeoutError();
    }
  } finally {
    clearTimeout(timeout);
  }
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
