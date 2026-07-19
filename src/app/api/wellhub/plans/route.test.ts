import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }));

import { GET } from "./route";
import {
  WELLHUB_PLAN_CREDITS,
  WELLHUB_PLAN_LABELS,
  WELLHUB_PLANS,
} from "@/lib/wellhub-config";

describe("GET /api/wellhub/plans", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires authentication", async () => {
    mocks.requireAuth.mockRejectedValue(new Error("UNAUTHORIZED"));
    expect((await GET(new Request("http://localhost/api/wellhub/plans"))).status).toBe(401);
  });

  it("returns only canonical supported plans and credit amounts", async () => {
    mocks.requireAuth.mockResolvedValue({ sub: "user_1" });
    const response = await GET(new Request("http://localhost/api/wellhub/plans"));
    await expect(response.json()).resolves.toEqual({
      plans: WELLHUB_PLANS.map((value) => ({
        value,
        label: WELLHUB_PLAN_LABELS[value],
        credits: WELLHUB_PLAN_CREDITS[value],
      })),
    });
  });
});
