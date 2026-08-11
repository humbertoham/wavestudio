import type { WellhubConfig } from "@/lib/wellhub/config";
import {
  validateCheckin,
  type WellhubValidationResult,
} from "@/lib/wellhub/client";
import type { WellhubCheckinEvent } from "@/lib/wellhub/parser";
import {
  createPrismaWellhubCheckinStore,
  type StoredWellhubCheckinStatus,
  type WellhubCheckinStore,
} from "@/lib/wellhub/store";

type EnabledWellhubConfig = Extract<WellhubConfig, { enabled: true }>;

export type WellhubCheckinProcessingResult =
  | {
      kind: "authorized";
      checkinId: string;
      matchedUserId: string | null;
      retried: boolean;
    }
  | {
      kind: "rejected";
      checkinId: string;
      matchedUserId: string | null;
      code: string;
      retried: boolean;
    }
  | {
      kind: "error";
      checkinId: string;
      matchedUserId: string | null;
      code: string;
      retryable: boolean;
      retried: boolean;
    }
  | {
      kind: "duplicate";
      checkinId: string;
      matchedUserId: string | null;
      status: StoredWellhubCheckinStatus;
    };

export async function processWellhubCheckin(
  event: WellhubCheckinEvent,
  config: EnabledWellhubConfig,
  dependencies: {
    store?: WellhubCheckinStore;
    validate?: (
      externalUserId: string,
      config: EnabledWellhubConfig
    ) => Promise<WellhubValidationResult>;
  } = {}
): Promise<WellhubCheckinProcessingResult> {
  const store = dependencies.store ?? createPrismaWellhubCheckinStore();
  const validator =
    dependencies.validate ??
    ((externalUserId, activeConfig) =>
      validateCheckin({ externalUserId, config: activeConfig }));

  const matchedUserId = await store.findMatchedUserId(event.email);
  const created = await store.createReceived(event, matchedUserId);
  let record = created.record;
  let retried = false;

  if (created.kind === "duplicate") {
    if (record.status !== "ERROR") {
      return {
        kind: "duplicate",
        checkinId: record.id,
        matchedUserId: record.matchedUserId,
        status: record.status,
      };
    }

    const claimed = await store.claimErrored(record.id);
    if (!claimed) {
      return {
        kind: "duplicate",
        checkinId: record.id,
        matchedUserId: record.matchedUserId,
        status: record.status,
      };
    }
    record = claimed;
    retried = true;
  }

  let validation: WellhubValidationResult;
  try {
    validation = await validator(event.externalUserId, config);
  } catch {
    validation = {
      kind: "error",
      category: "NETWORK",
      code: "WELLHUB_VALIDATION_FAILED",
      message: "Wellhub validation request failed.",
      retryable: true,
    };
  }

  if (validation.kind === "authorized") {
    await store.markAuthorized(record.id, validation.validatedAt);
    return {
      kind: "authorized",
      checkinId: record.id,
      matchedUserId: record.matchedUserId,
      retried,
    };
  }

  if (validation.kind === "rejected") {
    await store.markRejected(record.id, validation.code, validation.message);
    return {
      kind: "rejected",
      checkinId: record.id,
      matchedUserId: record.matchedUserId,
      code: validation.code,
      retried,
    };
  }

  await store.markError(record.id, validation.code, validation.message);
  return {
    kind: "error",
    checkinId: record.id,
    matchedUserId: record.matchedUserId,
    code: validation.code,
    retryable: validation.retryable,
    retried,
  };
}
