import { NextResponse } from "next/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ signToken: vi.fn(() => "signed-token") }));
vi.mock("./jwt", () => ({ signToken: mocks.signToken }));
import {
  buildSessionPayload,
  clearSessionCookie,
  issueSessionCookie,
  sessionCookieUsesSecureTransport,
} from "./session-cookie";

const user = {
  id: "user_1",
  role: "COACH" as const,
  affiliationConfirmedAt: new Date("2026-07-18T00:00:00.000Z"),
  authVersion: 8,
  wellhubPlanConfirmationRequired: false,
  wellhubPlanConfirmationCampaign: "campaign-1",
};

describe("session cookie", () => {
  it("builds the canonical JWT payload from current persisted user state", () => {
    expect(buildSessionPayload(user)).toEqual({
      sub: "user_1",
      role: "COACH",
      affiliationConfirmed: true,
      sessionVersion: 8,
      wellhubPlanConfirmationRequired: false,
      wellhubPlanConfirmationCampaign: "campaign-1",
    });
  });

  it("writes an HTTP-only app-wide same-site cookie with the current version", () => {
    const response = NextResponse.json({ ok: true });
    issueSessionCookie(response, new Request("https://uat.wave.test/api"), user);

    const header = response.headers.get("set-cookie") ?? "";
    expect(header).toContain("session=");
    expect(header).toContain("Path=/");
    expect(header).toContain("Max-Age=604800");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=lax");
    expect(header).toContain("Secure");

    expect(header).toContain("session=signed-token");
    expect(mocks.signToken).toHaveBeenCalledWith(expect.objectContaining({
      sub: "user_1",
      role: "COACH",
      sessionVersion: 8,
    }));
  });

  it("supports local HTTP development and deployed HTTPS safely", () => {
    expect(
      sessionCookieUsesSecureTransport(
        new Request("http://127.0.0.1:3200/api/auth/login")
      )
    ).toBe(false);
    expect(
      sessionCookieUsesSecureTransport(
        new Request("http://internal/api", {
          headers: { "x-forwarded-proto": "https" },
        })
      )
    ).toBe(true);
  });

  it("clears the same cookie name, path, and security attributes", () => {
    const response = NextResponse.json({ ok: true });
    clearSessionCookie(response, new Request("https://uat.wave.test/logout"));
    const header = response.headers.get("set-cookie") ?? "";
    expect(header).toContain("session=");
    expect(header).toContain("Path=/");
    expect(header).toContain("Max-Age=0");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=lax");
    expect(header).toContain("Secure");
  });
});
