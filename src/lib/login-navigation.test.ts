import { describe, expect, it } from "vitest";

import {
  DEFAULT_AUTHENTICATED_PATH,
  safePostLoginDestination,
} from "./login-navigation";

describe("safePostLoginDestination", () => {
  it("preserves a safe internal requested page", () => {
    expect(safePostLoginDestination("/perfil?tab=cuenta#datos")).toBe(
      "/perfil?tab=cuenta#datos"
    );
  });

  it("removes stale affiliation, login, and non-pending WellHub destinations", () => {
    for (const path of [
      "/afiliacion",
      "/afiliacion?next=%2Fperfil",
      "/login",
      "/actualizar-plan-wellhub",
    ]) {
      expect(safePostLoginDestination(path), path).toBe(
        DEFAULT_AUTHENTICATED_PATH
      );
    }
  });

  it("rejects external, protocol-relative, API, and malformed destinations", () => {
    for (const path of [
      "https://example.test/perfil",
      "//example.test/perfil",
      "/api/auth/me",
      "/_next/static/file.js",
      null,
    ]) {
      expect(safePostLoginDestination(path), String(path)).toBe(
        DEFAULT_AUTHENTICATED_PATH
      );
    }
  });
});
