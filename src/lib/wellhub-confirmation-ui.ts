export const WELLHUB_CONFIRMATION_COPY = {
  title: "Actualiza tu plan de WellHub",
  body:
    "Para continuar usando WAVE Studio, necesitamos que confirmes cuál es tu plan actual de WellHub. Esta actualización nos permite asignarte correctamente los créditos correspondientes a tu plan.",
  note: "Selecciona tu plan actual para continuar.",
  submit: "Guardar y continuar",
} as const;

export const WELLHUB_CONFIRMATION_DESTINATION = "/clases";
export const WELLHUB_CONFIRMATION_REQUEST_TIMEOUT_MS = 12_000;

export const WELLHUB_CONFIRMATION_MESSAGES = {
  network: "No pudimos conectar con el servidor. Intenta nuevamente.",
  session: "Tu sesión expiró. Vuelve a iniciar sesión.",
  server: "No pudimos guardar tu plan. Intenta nuevamente.",
  unexpected: "Recibimos una respuesta inesperada. Intenta nuevamente.",
  save: "No pudimos guardar tu plan. Intenta nuevamente.",
} as const;

type WellhubConfirmationResponseType =
  | "json"
  | "empty"
  | "invalid-json"
  | "non-json"
  | "none";

type WellhubConfirmationResultBase = {
  status: number | null;
  code: string | null;
  responseType: WellhubConfirmationResponseType;
  requestAborted: boolean;
  recoveryAttempted: boolean;
  elapsedMs: number;
};

export type WellhubConfirmationRequestResult =
  | (WellhubConfirmationResultBase & {
      kind: "success";
      status: number;
      code: null;
      responseType: "json";
      redirectTo: typeof WELLHUB_CONFIRMATION_DESTINATION;
    })
  | (WellhubConfirmationResultBase & {
      kind: "api-error";
      status: number;
      responseType: "json";
      message: string;
    })
  | (WellhubConfirmationResultBase & {
      kind: "timeout" | "network-error" | "unexpected-response";
      message: string;
    });

type RequestAttempt =
  | { kind: "response"; response: Response }
  | { kind: "timeout" }
  | { kind: "network-error"; retryable: boolean };

export function acquireWellhubSubmissionLock(lock: { current: boolean }) {
  if (lock.current) return false;
  lock.current = true;
  return true;
}

export function releaseWellhubSubmissionLock(lock: { current: boolean }) {
  lock.current = false;
}

export function finishWellhubSubmission(params: {
  lock: { current: boolean };
  redirecting: boolean;
  setSaving: (saving: boolean) => void;
}) {
  if (params.redirecting) return;
  releaseWellhubSubmissionLock(params.lock);
  params.setSaving(false);
}

function elapsedSince(startedAt: number) {
  return Math.max(0, Date.now() - startedAt);
}

function isJsonContentType(contentType: string) {
  const mimeType = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return mimeType === "application/json" || mimeType.endsWith("+json");
}

function readSafeCode(payload: Record<string, unknown>) {
  const candidate =
    typeof payload.code === "string"
      ? payload.code
      : typeof payload.error === "string"
        ? payload.error
        : null;
  return candidate && /^[A-Z0-9_:-]{1,80}$/.test(candidate) ? candidate : null;
}

function readSafeMessage(payload: Record<string, unknown>) {
  const candidate =
    typeof payload.message === "string" ? payload.message.trim() : "";
  return candidate && candidate.length <= 300 && !/[<>]/.test(candidate)
    ? candidate
    : null;
}

function apiErrorMessage(status: number, payload: Record<string, unknown>) {
  if (status === 401 || status === 403) {
    return WELLHUB_CONFIRMATION_MESSAGES.session;
  }
  if (status >= 500) return WELLHUB_CONFIRMATION_MESSAGES.server;
  return readSafeMessage(payload) ?? WELLHUB_CONFIRMATION_MESSAGES.save;
}

async function parseWellhubConfirmationResponse(
  response: Response,
  base: Omit<WellhubConfirmationResultBase, "status" | "code" | "responseType">
): Promise<WellhubConfirmationRequestResult> {
  const unexpected = (
    responseType: Exclude<WellhubConfirmationResponseType, "none">
  ): WellhubConfirmationRequestResult => ({
    ...base,
    kind: "unexpected-response",
    status: response.status,
    code: null,
    responseType,
    message: WELLHUB_CONFIRMATION_MESSAGES.unexpected,
  });

  if (!isJsonContentType(response.headers.get("content-type") ?? "")) {
    return unexpected("non-json");
  }

  const body = await response.text();
  if (!body.trim()) return unexpected("empty");

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return unexpected("invalid-json");
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return unexpected("invalid-json");
  }

  const record = payload as Record<string, unknown>;
  if (!response.ok) {
    return {
      ...base,
      kind: "api-error",
      status: response.status,
      code: readSafeCode(record),
      responseType: "json",
      message: apiErrorMessage(response.status, record),
    };
  }

  if (
    record.ok === true &&
    record.redirectTo === WELLHUB_CONFIRMATION_DESTINATION
  ) {
    return {
      ...base,
      kind: "success",
      status: response.status,
      code: null,
      responseType: "json",
      redirectTo: WELLHUB_CONFIRMATION_DESTINATION,
    };
  }

  return unexpected("json");
}

async function sendWellhubConfirmationAttempt(params: {
  selectedPlan: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}): Promise<RequestAttempt> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, params.timeoutMs);

  try {
    const response = await params.fetchImpl(
      "/api/users/me/wellhub-plan-confirmation",
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wellhubPlan: params.selectedPlan }),
        signal: controller.signal,
      }
    );
    return { kind: "response", response };
  } catch (error) {
    if (timedOut || controller.signal.aborted) return { kind: "timeout" };
    return { kind: "network-error", retryable: error instanceof TypeError };
  } finally {
    clearTimeout(timeout);
  }
}

export async function submitWellhubConfirmationRequest(params: {
  selectedPlan: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<WellhubConfirmationRequestResult> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const timeoutMs =
    params.timeoutMs ?? WELLHUB_CONFIRMATION_REQUEST_TIMEOUT_MS;
  const startedAt = Date.now();
  let recoveryAttempted = false;

  let attempt = await sendWellhubConfirmationAttempt({
    selectedPlan: params.selectedPlan,
    fetchImpl,
    timeoutMs,
  });

  if (attempt.kind === "network-error" && attempt.retryable) {
    recoveryAttempted = true;
    attempt = await sendWellhubConfirmationAttempt({
      selectedPlan: params.selectedPlan,
      fetchImpl,
      timeoutMs,
    });
  }

  const base = {
    requestAborted: attempt.kind === "timeout",
    recoveryAttempted,
    elapsedMs: elapsedSince(startedAt),
  };

  if (attempt.kind === "response") {
    return parseWellhubConfirmationResponse(attempt.response, base);
  }

  return {
    ...base,
    kind: attempt.kind,
    status: null,
    code: null,
    responseType: "none",
    message: WELLHUB_CONFIRMATION_MESSAGES.network,
  };
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
