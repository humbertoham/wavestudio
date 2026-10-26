import type { WellhubConfig } from "@/lib/wellhub/config";

type EnabledWellhubConfig = Extract<WellhubConfig, { enabled: true }>;

export type WellhubValidationResult =
  | {
      kind: "authorized";
      validatedAt: Date;
    }
  | {
      kind: "rejected";
      httpStatus: 400 | 404;
      code: string;
      message: string;
    }
  | {
      kind: "error";
      category:
        | "AUTH"
        | "RATE_LIMIT"
        | "SERVER"
        | "HTTP"
        | "NETWORK"
        | "TIMEOUT"
        | "MALFORMED_RESPONSE";
      code: string;
      message: string;
      httpStatus?: number;
      retryable: boolean;
    };

type ErrorEnvelope = {
  errors?: Array<{ key?: unknown; message?: unknown; Message?: unknown }>;
};

function parseObject(raw: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function safeErrorDetails(raw: string, fallbackCode: string) {
  const parsed = parseObject(raw) as ErrorEnvelope | null;
  const first = Array.isArray(parsed?.errors) ? parsed?.errors[0] : undefined;
  const code =
    typeof first?.key === "string" && first.key.trim()
      ? first.key.trim().slice(0, 120)
      : fallbackCode;
  const rawMessage =
    typeof first?.message === "string"
      ? first.message
      : typeof first?.Message === "string"
        ? first.Message
        : fallbackCode;

  return { code, message: rawMessage.trim().slice(0, 300) || fallbackCode };
}

function authorizedFromBody(
  raw: string,
  expectedUserId: string,
  now: () => Date
): WellhubValidationResult {
  if (!raw.trim()) {
    // The endpoint page states that a successful 200 may contain no content.
    return { kind: "authorized", validatedAt: now() };
  }

  const parsed = parseObject(raw);
  if (!parsed) {
    return {
      kind: "error",
      category: "MALFORMED_RESPONSE",
      code: "MALFORMED_SUCCESS_JSON",
      message: "Wellhub returned malformed JSON for a successful validation.",
      retryable: true,
    };
  }

  const results = parsed.results;
  if (!results || typeof results !== "object" || Array.isArray(results)) {
    return {
      kind: "error",
      category: "MALFORMED_RESPONSE",
      code: "MISSING_VALIDATION_RESULTS",
      message: "Wellhub validation response did not include results.",
      retryable: true,
    };
  }

  const resultObject = results as Record<string, unknown>;
  const user = resultObject.user;
  const responseUserId =
    user && typeof user === "object" && !Array.isArray(user)
      ? (user as Record<string, unknown>).gympass_id
      : undefined;

  if (responseUserId == null) {
    return {
      kind: "error",
      category: "MALFORMED_RESPONSE",
      code: "MISSING_VALIDATION_USER",
      message: "Wellhub validation response did not identify the user.",
      retryable: true,
    };
  }

  if (String(responseUserId) !== expectedUserId) {
    return {
      kind: "error",
      category: "MALFORMED_RESPONSE",
      code: "VALIDATION_USER_MISMATCH",
      message: "Wellhub validation response identified a different user.",
      retryable: false,
    };
  }

  const rawValidatedAt = resultObject.validated_at;
  const parsedDate =
    typeof rawValidatedAt === "string" ? new Date(rawValidatedAt) : null;
  const validatedAt =
    parsedDate && Number.isFinite(parsedDate.getTime()) ? parsedDate : now();

  return { kind: "authorized", validatedAt };
}

export async function validateCheckin(
  params: {
    externalUserId: string;
    config: EnabledWellhubConfig;
  },
  dependencies: {
    fetchImpl?: typeof fetch;
    now?: () => Date;
  } = {}
): Promise<WellhubValidationResult> {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const now = dependencies.now ?? (() => new Date());
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.config.timeoutMs);

  try {
    const response = await fetchImpl(`${params.config.apiBaseUrl}/validate`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.config.apiToken}`,
        "X-Gym-Id": params.config.gymId,
      },
      body: JSON.stringify({ gympass_id: params.externalUserId }),
      cache: "no-store",
      signal: controller.signal,
    });
    const raw = await response.text();

    if (response.ok) {
      return authorizedFromBody(raw, params.externalUserId, now);
    }

    const details = safeErrorDetails(raw, `HTTP_${response.status}`);
    if (response.status === 400 || response.status === 404) {
      return {
        kind: "rejected",
        httpStatus: response.status,
        ...details,
      };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        kind: "error",
        category: "AUTH",
        httpStatus: response.status,
        ...details,
        retryable: false,
      };
    }

    if (response.status === 429) {
      return {
        kind: "error",
        category: "RATE_LIMIT",
        httpStatus: response.status,
        ...details,
        retryable: true,
      };
    }

    if (response.status >= 500) {
      return {
        kind: "error",
        category: "SERVER",
        httpStatus: response.status,
        ...details,
        retryable: true,
      };
    }

    return {
      kind: "error",
      category: "HTTP",
      httpStatus: response.status,
      ...details,
      retryable: false,
    };
  } catch (error) {
    const timedOut =
      controller.signal.aborted ||
      (error instanceof Error && error.name === "AbortError");

    return timedOut
      ? {
          kind: "error",
          category: "TIMEOUT",
          code: "WELLHUB_TIMEOUT",
          message: "Wellhub validation request timed out.",
          retryable: true,
        }
      : {
          kind: "error",
          category: "NETWORK",
          code: "WELLHUB_NETWORK_ERROR",
          message: "Wellhub validation request failed.",
          retryable: true,
        };
  } finally {
    clearTimeout(timeout);
  }
}
