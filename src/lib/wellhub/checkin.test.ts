import { describe, expect, it, vi } from "vitest";

import { processWellhubCheckin } from "@/lib/wellhub/checkin";
import type { WellhubCheckinEvent } from "@/lib/wellhub/parser";
import type {
  StoredWellhubCheckin,
  WellhubCheckinStore,
} from "@/lib/wellhub/store";

const config = {
  enabled: true as const,
  apiBaseUrl: "https://apitesting.partners.gympass.com/access/v1",
  apiToken: "fake-token",
  gymId: "129",
  webhookSecret: "fake-secret",
  timeoutMs: 800,
};

const event: WellhubCheckinEvent = {
  eventType: "checkin",
  externalEventId: "event-hash",
  externalUserId: "1000000000003",
  externalGymId: "129",
  externalProductId: "2",
  eventTimestamp: "1786453200",
  email: "member@example.com",
};

function storeFixture(options: {
  matchedUserId?: string | null;
  existing?: StoredWellhubCheckin;
}) {
  const record: StoredWellhubCheckin =
    options.existing ?? {
      id: "checkin_1",
      externalEventId: event.externalEventId,
      matchedUserId: options.matchedUserId ?? null,
      status: "RECEIVED",
    };

  return {
    findMatchedUserId: vi.fn(async () => options.matchedUserId ?? null),
    createReceived: vi.fn(async () =>
      options.existing
        ? { kind: "duplicate" as const, record }
        : { kind: "created" as const, record }
    ),
    claimErrored: vi.fn(async () => ({ ...record, status: "RECEIVED" as const })),
    markAuthorized: vi.fn(async () => undefined),
    markRejected: vi.fn(async () => undefined),
    markError: vi.fn(async () => undefined),
  } satisfies WellhubCheckinStore;
}

describe("Wellhub check-in service", () => {
  it("persists an authorized check-in", async () => {
    const store = storeFixture({ matchedUserId: "user_1" });
    const validate = vi.fn(async () => ({
      kind: "authorized" as const,
      validatedAt: new Date("2026-08-11T12:00:00Z"),
    }));

    const result = await processWellhubCheckin(event, config, {
      store,
      validate,
    });

    expect(result).toMatchObject({
      kind: "authorized",
      matchedUserId: "user_1",
    });
    expect(store.markAuthorized).toHaveBeenCalledWith(
      "checkin_1",
      new Date("2026-08-11T12:00:00Z")
    );
  });

  it("persists a business rejection", async () => {
    const store = storeFixture({});
    const result = await processWellhubCheckin(event, config, {
      store,
      validate: vi.fn(async () => ({
        kind: "rejected" as const,
        httpStatus: 400 as const,
        code: "checkin.validation.expired",
        message: "Check-in expired",
      })),
    });

    expect(result).toMatchObject({ kind: "rejected" });
    expect(store.markRejected).toHaveBeenCalledWith(
      "checkin_1",
      "checkin.validation.expired",
      "Check-in expired"
    );
  });

  it("persists a recoverable integration error", async () => {
    const store = storeFixture({});
    const result = await processWellhubCheckin(event, config, {
      store,
      validate: vi.fn(async () => ({
        kind: "error" as const,
        category: "TIMEOUT" as const,
        code: "WELLHUB_TIMEOUT",
        message: "Wellhub validation request timed out.",
        retryable: true,
      })),
    });

    expect(result).toMatchObject({ kind: "error", retryable: true });
    expect(store.markError).toHaveBeenCalledOnce();
  });

  it("does not validate an already processed duplicate", async () => {
    const store = storeFixture({
      existing: {
        id: "checkin_1",
        externalEventId: event.externalEventId,
        matchedUserId: null,
        status: "AUTHORIZED",
      },
    });
    const validate = vi.fn();

    const result = await processWellhubCheckin(event, config, {
      store,
      validate,
    });

    expect(result).toEqual({
      kind: "duplicate",
      checkinId: "checkin_1",
      matchedUserId: null,
      status: "AUTHORIZED",
    });
    expect(validate).not.toHaveBeenCalled();
  });

  it("allows one atomic retry of a previously errored event", async () => {
    const store = storeFixture({
      existing: {
        id: "checkin_1",
        externalEventId: event.externalEventId,
        matchedUserId: null,
        status: "ERROR",
      },
    });
    const validate = vi.fn(async () => ({
      kind: "authorized" as const,
      validatedAt: new Date("2026-08-11T12:00:00Z"),
    }));

    const result = await processWellhubCheckin(event, config, {
      store,
      validate,
    });

    expect(result).toMatchObject({ kind: "authorized", retried: true });
    expect(store.claimErrored).toHaveBeenCalledWith("checkin_1");
    expect(validate).toHaveBeenCalledOnce();
  });

  it("authorizes an unmatched Wellhub user without creating a WAVE user", async () => {
    const store = storeFixture({ matchedUserId: null });

    const result = await processWellhubCheckin(event, config, {
      store,
      validate: vi.fn(async () => ({
        kind: "authorized" as const,
        validatedAt: new Date(),
      })),
    });

    expect(result).toMatchObject({
      kind: "authorized",
      matchedUserId: null,
    });
    expect(store.findMatchedUserId).toHaveBeenCalledWith("member@example.com");
  });

  it("associates a safely matched Wellhub-affiliated WAVE user", async () => {
    const store = storeFixture({ matchedUserId: "wellhub_user_1" });

    const result = await processWellhubCheckin(event, config, {
      store,
      validate: vi.fn(async () => ({
        kind: "authorized" as const,
        validatedAt: new Date(),
      })),
    });

    expect(result).toMatchObject({ matchedUserId: "wellhub_user_1" });
    expect(store.createReceived).toHaveBeenCalledWith(
      event,
      "wellhub_user_1"
    );
  });
});
