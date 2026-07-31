import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ClassesAccountSummary,
  shouldLoadClassesPrivateData,
} from "./ClassesAccountSummary";

const inactiveChallenge = { active: false, points: 0 };

describe("ClassesAccountSummary", () => {
  it("hides private class data while the session is loading", () => {
    const html = renderToStaticMarkup(
      createElement(ClassesAccountSummary, {
        isAuthenticated: false,
        isSessionLoading: true,
        hasLoadedPrivateData: false,
        tokens: 0,
        challenge: inactiveChallenge,
      })
    );

    expect(html).toBe("");
    expect(
      shouldLoadClassesPrivateData({
        isAuthenticated: false,
        isSessionLoading: true,
      })
    ).toBe(false);
  });

  it("hides the summary and prevents private loading for visitors", () => {
    const html = renderToStaticMarkup(
      createElement(ClassesAccountSummary, {
        isAuthenticated: false,
        isSessionLoading: false,
        hasLoadedPrivateData: false,
        tokens: 0,
        challenge: inactiveChallenge,
      })
    );

    expect(html).toBe("");
    expect(html).not.toContain("Tus clases");
    expect(
      shouldLoadClassesPrivateData({
        isAuthenticated: false,
        isSessionLoading: false,
      })
    ).toBe(false);
  });

  it("does not show a temporary zero before private data loads", () => {
    const html = renderToStaticMarkup(
      createElement(ClassesAccountSummary, {
        isAuthenticated: true,
        isSessionLoading: false,
        hasLoadedPrivateData: false,
        tokens: 0,
        challenge: inactiveChallenge,
      })
    );

    expect(html).toBe("");
  });

  it("shows the authenticated zero state after private data loads", () => {
    const html = renderToStaticMarkup(
      createElement(ClassesAccountSummary, {
        isAuthenticated: true,
        isSessionLoading: false,
        hasLoadedPrivateData: true,
        tokens: 0,
        challenge: inactiveChallenge,
      })
    );

    expect(html).toContain("Tus clases:");
    expect(html).toContain('class="font-bold">0</span>');
  });

  it("shows the authenticated user's real value", () => {
    const html = renderToStaticMarkup(
      createElement(ClassesAccountSummary, {
        isAuthenticated: true,
        isSessionLoading: false,
        hasLoadedPrivateData: true,
        tokens: 7,
        challenge: { active: true, points: 12 },
      })
    );

    expect(html).toContain('class="font-bold">7</span>');
    expect(html).toContain("12 puntos");
    expect(
      shouldLoadClassesPrivateData({
        isAuthenticated: true,
        isSessionLoading: false,
      })
    ).toBe(true);
  });
});
