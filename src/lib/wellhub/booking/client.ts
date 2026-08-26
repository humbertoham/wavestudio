import type { WellhubBookingConfig } from "@/lib/wellhub/config";

type EnabledBookingConfig = Extract<WellhubBookingConfig, { enabled: true }>;

export class WellhubBookingApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly httpStatus?: number,
    public readonly retryable = false
  ) {
    super(code);
    this.name = "WellhubBookingApiError";
  }
}

export type WellhubClassPayload = {
  name: string;
  description: string;
  notes?: string;
  bookable: boolean;
  visible: boolean;
  reference: string;
  product_id: number;
  categories?: number[];
};

export type WellhubSlotPayload = {
  occur_date: string;
  room?: string;
  status: 0 | 1;
  length_in_minutes: number;
  total_capacity: number;
  total_booked: number;
  product_id: number;
  cancellable_until?: string;
  instructors?: Array<{ name: string; substitute: boolean }>;
  virtual: false;
};

export type WellhubBookingDecision =
  | { status: "RESERVED" }
  | {
      status: "REJECTED";
      reason: string;
      reason_category:
        | "CLASS_IS_FULL"
        | "USER_IS_ALREADY_BOOKED"
        | "SPOT_NOT_AVAILABLE"
        | "CHECK_IN_AND_CANCELATION_WINDOWS_CLOSED"
        | "CLASS_HAS_BEEN_CANCELED"
        | "CLASS_NOT_FOUND"
        | "GENERAL_ERROR"
        | "TECHNICAL_ERROR";
    }
  | { status: "CANCELLED_BY_GYM"; reason?: string };

type WellhubClassRecord = {
  id: string;
  reference: string | null;
};

type WellhubSlotRecord = {
  id: string;
  classId: string;
  occurDate: string;
};

export interface WellhubBookingClient {
  listCategoryIds(locale?: string): Promise<Set<number>>;
  listClasses(): Promise<WellhubClassRecord[]>;
  createClass(payload: WellhubClassPayload): Promise<string>;
  updateClass(classId: string, payload: WellhubClassPayload): Promise<void>;
  listSlots(
    classId: string,
    from: Date,
    to: Date
  ): Promise<WellhubSlotRecord[]>;
  createSlot(classId: string, payload: WellhubSlotPayload): Promise<string>;
  updateSlot(
    classId: string,
    slotId: string,
    payload: WellhubSlotPayload
  ): Promise<void>;
  updateCapacity(
    classId: string,
    slotId: string,
    payload: { total_capacity: number; total_booked: number }
  ): Promise<void>;
  decideBooking(
    bookingNumber: string,
    decision: WellhubBookingDecision
  ): Promise<void>;
}

function parseObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function identifier(value: unknown) {
  if (
    (typeof value === "string" && /^\d{1,30}$/.test(value)) ||
    (typeof value === "number" && Number.isSafeInteger(value) && value > 0)
  ) {
    return String(value);
  }
  return null;
}

function apiError(response: Response) {
  const status = response.status;
  return new WellhubBookingApiError(
    `WELLHUB_BOOKING_HTTP_${status}`,
    status,
    status === 408 || status === 409 || status === 429 || status >= 500
  );
}

export function createWellhubBookingClient(
  config: EnabledBookingConfig,
  dependencies: { fetchImpl?: typeof fetch } = {}
): WellhubBookingClient {
  const fetchImpl = dependencies.fetchImpl ?? fetch;

  async function request(
    path: string,
    init: RequestInit,
    expectedStatuses: readonly number[],
    baseUrl = config.apiBaseUrl
  ) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${config.apiToken}`,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
        cache: "no-store",
        signal: controller.signal,
      });
      const raw = await response.text();
      if (!expectedStatuses.includes(response.status)) throw apiError(response);
      return raw;
    } catch (error) {
      if (error instanceof WellhubBookingApiError) throw error;
      const timeoutFailure =
        controller.signal.aborted ||
        (error instanceof Error && error.name === "AbortError");
      throw new WellhubBookingApiError(
        timeoutFailure
          ? "WELLHUB_BOOKING_TIMEOUT"
          : "WELLHUB_BOOKING_NETWORK_ERROR",
        undefined,
        true
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  const gymPath = `/gyms/${encodeURIComponent(config.gymId)}`;

  return {
    async listCategoryIds(locale = "es_MX") {
      const raw = await request(
        `${gymPath}/categories?locale=${encodeURIComponent(locale)}`,
        { method: "GET" },
        [200]
      );
      const parsed = parseObject(raw);
      const results = Array.isArray(parsed?.results) ? parsed.results : null;
      if (!results) {
        throw new WellhubBookingApiError("MALFORMED_CATEGORY_RESPONSE");
      }
      const ids = new Set<number>();
      for (const item of results) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const id = Number((item as Record<string, unknown>).id);
        if (Number.isSafeInteger(id) && id > 0) ids.add(id);
      }
      return ids;
    },

    async listClasses() {
      const raw = await request(`${gymPath}/classes`, { method: "GET" }, [200]);
      const parsed = parseObject(raw);
      const rows = Array.isArray(parsed?.classes) ? parsed.classes : null;
      if (!rows) throw new WellhubBookingApiError("MALFORMED_CLASS_LIST_RESPONSE");
      return rows.flatMap((row) => {
        if (!row || typeof row !== "object" || Array.isArray(row)) return [];
        const object = row as Record<string, unknown>;
        const id = identifier(object.id);
        if (!id) return [];
        return [
          {
            id,
            reference:
              typeof object.reference === "string" ? object.reference : null,
          },
        ];
      });
    },

    async createClass(payload) {
      const raw = await request(
        `${gymPath}/classes`,
        { method: "POST", body: JSON.stringify({ classes: [payload] }) },
        [201]
      );
      const parsed = parseObject(raw);
      const rows = Array.isArray(parsed?.classes) ? parsed.classes : null;
      const first = rows?.[0];
      const id =
        first && typeof first === "object" && !Array.isArray(first)
          ? identifier((first as Record<string, unknown>).id)
          : null;
      if (!id) throw new WellhubBookingApiError("MALFORMED_CLASS_CREATE_RESPONSE");
      return id;
    },

    async updateClass(classId, payload) {
      await request(
        `${gymPath}/classes/${encodeURIComponent(classId)}`,
        { method: "PUT", body: JSON.stringify(payload) },
        [200, 204]
      );
    },

    async listSlots(classId, from, to) {
      const query = new URLSearchParams({
        from: from.toISOString(),
        to: to.toISOString(),
      });
      const raw = await request(
        `${gymPath}/classes/${encodeURIComponent(classId)}/slots?${query}`,
        { method: "GET" },
        [200]
      );
      const parsed = parseObject(raw);
      const rows = Array.isArray(parsed?.results) ? parsed.results : null;
      if (!rows) throw new WellhubBookingApiError("MALFORMED_SLOT_LIST_RESPONSE");
      return rows.flatMap((row) => {
        if (!row || typeof row !== "object" || Array.isArray(row)) return [];
        const object = row as Record<string, unknown>;
        const id = identifier(object.id);
        const relatedClassId = identifier(object.class_id);
        const occurDate = object.occur_date;
        if (!id || !relatedClassId || typeof occurDate !== "string") return [];
        return [{ id, classId: relatedClassId, occurDate }];
      });
    },

    async createSlot(classId, payload) {
      const raw = await request(
        `${gymPath}/classes/${encodeURIComponent(classId)}/slots`,
        { method: "POST", body: JSON.stringify(payload) },
        [201]
      );
      const parsed = parseObject(raw);
      const rows = Array.isArray(parsed?.results) ? parsed.results : null;
      const first = rows?.[0];
      const id =
        first && typeof first === "object" && !Array.isArray(first)
          ? identifier((first as Record<string, unknown>).id)
          : null;
      if (!id) throw new WellhubBookingApiError("MALFORMED_SLOT_CREATE_RESPONSE");
      return id;
    },

    async updateSlot(classId, slotId, payload) {
      await request(
        `${gymPath}/classes/${encodeURIComponent(classId)}/slots/${encodeURIComponent(slotId)}`,
        { method: "PUT", body: JSON.stringify(payload) },
        [200, 204]
      );
    },

    async updateCapacity(classId, slotId, payload) {
      await request(
        `${gymPath}/classes/${encodeURIComponent(classId)}/slots/${encodeURIComponent(slotId)}`,
        { method: "PATCH", body: JSON.stringify(payload) },
        [204]
      );
    },

    async decideBooking(bookingNumber, decision) {
      const bookingV2BaseUrl = config.apiBaseUrl.replace(/\/v1$/, "/v2");
      await request(
        `${gymPath}/bookings/${encodeURIComponent(bookingNumber)}`,
        { method: "PATCH", body: JSON.stringify(decision) },
        [204],
        bookingV2BaseUrl
      );
    },
  };
}
