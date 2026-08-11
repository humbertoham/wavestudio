import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type CheckinRow = {
  id: string;
  externalEventId: string;
  externalUserId: string;
  externalGymId: string;
  externalProductId: string;
  eventTimestamp: string;
  matchedUserId: string | null;
  status: "RECEIVED" | "AUTHORIZED" | "REJECTED" | "ERROR";
  validatedAt?: Date | null;
  failureCode?: string | null;
  failureReason?: string | null;
};

const mocks = vi.hoisted(() => {
  const rows = new Map<string, CheckinRow>();
  let nextId = 1;

  const prisma = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { email: string } }) =>
        where.email === "member@example.com"
          ? { id: "wave_user_1", affiliation: "WELLHUB" }
          : null
      ),
    },
    wellhubCheckin: {
      create: vi.fn(async ({ data }: { data: Omit<CheckinRow, "id" | "status"> }) => {
        if (rows.has(data.externalEventId)) {
          throw { code: "P2002", meta: { target: ["externalEventId"] } };
        }
        const row: CheckinRow = {
          ...data,
          id: `checkin_${nextId++}`,
          status: "RECEIVED",
        };
        rows.set(row.externalEventId, row);
        return row;
      }),
      findUnique: vi.fn(async ({ where }: { where: Record<string, string> }) => {
        if (where.externalEventId) return rows.get(where.externalEventId) ?? null;
        return [...rows.values()].find((row) => row.id === where.id) ?? null;
      }),
      updateMany: vi.fn(
        async ({ where, data }: { where: { id: string; status?: string }; data: Partial<CheckinRow> }) => {
          const row = [...rows.values()].find((candidate) => candidate.id === where.id);
          if (!row || (where.status && row.status !== where.status)) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        }
      ),
    },
  };

  return {
    prisma,
    rows,
    reset() {
      rows.clear();
      nextId = 1;
      prisma.user.findUnique.mockClear();
      prisma.wellhubCheckin.create.mockClear();
      prisma.wellhubCheckin.findUnique.mockClear();
      prisma.wellhubCheckin.updateMany.mockClear();
    },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));

import { computeWellhubSignature } from "@/lib/wellhub/signature";
import { POST } from "./route";

const secret = "fake-wellhub-integration-secret";

function payload(email = "member@example.com") {
  return JSON.stringify({
    event_type: "checkin",
    event_data: {
      user: {
        unique_token: "1000000000003",
        ...(email ? { email } : {}),
      },
      gym: {
        id: 129,
        product: { id: 2 },
      },
      timestamp: 1786453200,
    },
  });
}

function signedRequest(raw: string, valid = true) {
  const signature = valid
    ? computeWellhubSignature(raw, secret)
    : "A".repeat(40);
  return new Request("http://localhost/api/integrations/wellhub/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Gympass-Signature": signature,
    },
    body: raw,
  });
}

describe("Wellhub complete mocked webhook flow", () => {
  beforeEach(() => {
    mocks.reset();
    vi.stubEnv("APP_ENV", "development");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("WELLHUB_CHECKIN_ENABLED", "true");
    vi.stubEnv(
      "WELLHUB_API_BASE_URL",
      "https://apitesting.partners.gympass.com/access/v1"
    );
    vi.stubEnv("WELLHUB_API_TOKEN", "fake-token");
    vi.stubEnv("WELLHUB_GYM_ID", "129");
    vi.stubEnv("WELLHUB_WEBHOOK_SECRET", secret);
    vi.stubEnv("WELLHUB_API_TIMEOUT_MS", "800");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("stores, matches, validates, and authorizes a valid check-in", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        metadata: { total: 1, errors: 0 },
        results: {
          user: { gympass_id: "1000000000003" },
          validated_at: "2026-08-11T12:00:00Z",
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(signedRequest(payload()));
    const row = [...mocks.rows.values()][0];

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, result: "AUTHORIZED" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(row).toMatchObject({
      status: "AUTHORIZED",
      matchedUserId: "wave_user_1",
      externalUserId: "1000000000003",
    });
  });

  it("stores a provider-declined ticket as rejected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            metadata: { total: 0, errors: 1 },
            errors: [
              {
                key: "checkin.validation.expired",
                message: "Check-In expired",
              },
            ],
          }),
          { status: 400 }
        )
      )
    );

    const response = await POST(signedRequest(payload("")));
    const row = [...mocks.rows.values()][0];

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, result: "REJECTED" });
    expect(row).toMatchObject({
      status: "REJECTED",
      matchedUserId: null,
      failureCode: "checkin.validation.expired",
    });
  });

  it("deduplicates a repeated webhook before a second validation call", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const raw = payload();

    const first = await POST(signedRequest(raw));
    const second = await POST(signedRequest(raw));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({
      duplicate: true,
      result: "AUTHORIZED",
    });
    expect(mocks.rows.size).toBe(1);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects a spoofed signature with no persistence or external call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(signedRequest(payload(), false));

    expect(response.status).toBe(401);
    expect(mocks.rows.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps a Wellhub outage recoverable and auditable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("sandbox unavailable");
      })
    );

    const response = await POST(signedRequest(payload()));
    const row = [...mocks.rows.values()][0];

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      result: "ERROR",
      retryable: true,
    });
    expect(row).toMatchObject({
      status: "ERROR",
      failureCode: "WELLHUB_NETWORK_ERROR",
    });
  });
});
