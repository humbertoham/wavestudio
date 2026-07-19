import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyToken: vi.fn(),
}));

vi.mock("./jwt", () => ({ verifyToken: mocks.verifyToken }));
vi.mock("./prisma", () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

import { getVerifiedSessionCookiePayload } from "./auth";

describe("verified HTTP-only session cookie payload", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a cryptographically verified cookie without treating it as current", async () => {
    const payload = {
      sub: "user_1",
      role: "USER" as const,
      sessionVersion: 4,
      wellhubPlanConfirmationRequired: true,
      wellhubPlanConfirmationCampaign: "campaign-1",
    };
    mocks.verifyToken.mockReturnValueOnce(payload);
    await expect(
      getVerifiedSessionCookiePayload(
        new Request("https://wave.test/recovery", {
          headers: { cookie: "session=opaque-signed-value" },
        })
      )
    ).resolves.toEqual(payload);
  });

  it("rejects tampered or expired cookies and never falls back to bearer", async () => {
    mocks.verifyToken.mockImplementationOnce(() => {
      throw new Error("invalid or expired signature");
    });
    await expect(
      getVerifiedSessionCookiePayload(
        new Request("https://wave.test/recovery", {
          headers: {
            cookie: "session=tampered",
            authorization: "Bearer unrelated-token",
          },
        })
      )
    ).resolves.toBeNull();

    await expect(
      getVerifiedSessionCookiePayload(
        new Request("https://wave.test/recovery", {
          headers: { authorization: "Bearer otherwise-valid-token" },
        })
      )
    ).resolves.toBeNull();
    expect(mocks.verifyToken).toHaveBeenCalledTimes(1);
  });
});
