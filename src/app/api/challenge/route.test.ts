import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthFromRequest: vi.fn(),
  getChallengeStatus: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getAuthFromRequest: mocks.getAuthFromRequest,
}));
vi.mock("@/lib/challenge", () => ({
  getChallengeStatus: mocks.getChallengeStatus,
}));

import { GET } from "./route";

describe("GET /api/challenge", () => {
  it("requires authentication", async () => {
    mocks.getAuthFromRequest.mockResolvedValue(null);
    const response = await GET(
      new Request("https://example.test/api/challenge") as any
    );
    expect(response.status).toBe(401);
    expect(mocks.getChallengeStatus).not.toHaveBeenCalled();
  });

  it("returns only the authenticated user's own total", async () => {
    mocks.getAuthFromRequest.mockResolvedValue({ sub: "user_self" });
    mocks.getChallengeStatus.mockResolvedValue({
      active: true,
      name: "WAVE Challenge",
      points: 7,
      activatedAt: new Date("2026-07-13T00:00:00Z"),
    });

    const response = await GET(
      new Request(
        "https://example.test/api/challenge?userId=another_user"
      ) as any
    );

    expect(mocks.getChallengeStatus).toHaveBeenCalledWith("user_self");
    await expect(response.json()).resolves.toMatchObject({
      active: true,
      points: 7,
    });
  });
});
