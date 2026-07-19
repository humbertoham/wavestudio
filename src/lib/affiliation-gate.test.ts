import { describe, expect, it } from "vitest";

import { shouldRequireAffiliationOnboarding } from "./affiliation-gate";

describe("shouldRequireAffiliationOnboarding", () => {
  it("gates existing non-admin users without the session confirmation claim", () => {
    expect(
      shouldRequireAffiliationOnboarding("/clases", {
        role: "USER",
      })
    ).toBe(true);
  });

  it("does not gate confirmed users", () => {
    expect(
      shouldRequireAffiliationOnboarding("/mis-clases", {
        role: "USER",
        affiliationConfirmed: true,
      })
    ).toBe(false);
  });

  it("does not gate admins", () => {
    expect(
      shouldRequireAffiliationOnboarding("/admin", {
        role: "ADMIN",
      })
    ).toBe(false);
  });

  it("allows the onboarding endpoint while the user is unconfirmed", () => {
    expect(
      shouldRequireAffiliationOnboarding("/api/users/me/affiliation", {
        role: "USER",
      })
    ).toBe(false);
  });
});
