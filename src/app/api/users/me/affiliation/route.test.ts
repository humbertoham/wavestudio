import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireAuth: vi.fn() }));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }));

import { POST } from "./route";

function request() {
  return new Request("https://wave.test/api/users/me/affiliation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ affiliation: "NONE" }),
  });
}

describe("disabled POST /api/users/me/affiliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves authentication", async () => {
    mocks.requireAuth.mockRejectedValue(new Error("UNAUTHORIZED"));

    const response = await POST(request());
    expect(response.status).toBe(401);
  });

  it("never changes affiliation through the obsolete onboarding endpoint", async () => {
    mocks.requireAuth.mockResolvedValue({ sub: "fixture-user", role: "USER" });

    const response = await POST(request());
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: "AFFILIATION_ONBOARDING_DISABLED",
      message: "La afiliacion ya no se confirma desde esta pagina.",
      redirectTo: "/clases",
    });
  });
});
