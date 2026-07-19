import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ChallengeInfoContent } from "./ChallengeInfoContent";
import { ChallengeNavLink } from "./ChallengeNavLink";
import { ChallengePointsBadge } from "./ChallengePointsBadge";
import {
  CHALLENGE_ACTIVATION_CONFIRMATION,
  CHALLENGE_INFO_POINTS,
} from "@/lib/challenge-copy";
import {
  confirmChallengeLifecycleAction,
  shouldShowChallengePointControl,
} from "@/lib/challenge-ui";

describe("Challenge UI", () => {
  it("renders the accessible star and the user's actual point total", () => {
    const html = renderToStaticMarkup(
      createElement(ChallengePointsBadge, { points: 10 })
    );

    expect(html).toContain("10 puntos");
    expect(html).toContain('aria-label="10 puntos del Challenge"');
    expect(html).toContain('aria-hidden="true"');
  });

  it("shows the navbar information link only while active", () => {
    const active = renderToStaticMarkup(
      createElement(ChallengeNavLink, { active: true, className: "link" })
    );
    const inactive = renderToStaticMarkup(
      createElement(ChallengeNavLink, { active: false, className: "link" })
    );

    expect(active).toContain("¿Cómo funciona el Challenge?");
    expect(active).toContain('href="/challenge"');
    expect(inactive).toBe("");
  });

  it("renders the centralized accessible Spanish explanation", () => {
    const html = renderToStaticMarkup(createElement(ChallengeInfoContent));

    expect(html).toContain('aria-label="Reglas del Challenge"');
    for (const point of CHALLENGE_INFO_POINTS) expect(html).toContain(point);
  });

  it("hides the class control whenever inactive or ineligible", () => {
    expect(
      shouldShowChallengePointControl({
        active: true,
        challengeId: "challenge_1",
        eligibleAt: new Date(),
      })
    ).toBe(true);
    expect(
      shouldShowChallengePointControl({
        active: false,
        challengeId: "challenge_1",
        eligibleAt: new Date(),
      })
    ).toBe(false);
    expect(
      shouldShowChallengePointControl({
        active: true,
        challengeId: null,
        eligibleAt: null,
      })
    ).toBe(false);
  });

  it("requires the Spanish activation confirmation before continuing", () => {
    const confirmFn = vi.fn(() => false);

    expect(confirmChallengeLifecycleAction("activate", confirmFn)).toBe(false);
    expect(confirmFn).toHaveBeenCalledWith(CHALLENGE_ACTIVATION_CONFIRMATION);
  });
});
