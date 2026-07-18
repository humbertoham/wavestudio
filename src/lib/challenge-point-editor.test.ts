import { describe, expect, it } from "vitest";

import {
  CHALLENGE_USER_MAX_POINTS,
  challengePointEditorKeyAction,
  parseChallengePointInput,
} from "./challenge-point-editor";

describe("challenge point editor", () => {
  it.each([
    ["0", 0],
    ["25", 25],
    [`${CHALLENGE_USER_MAX_POINTS}`, CHALLENGE_USER_MAX_POINTS],
  ])("accepts the whole-number input %s", (input, value) => {
    expect(parseChallengePointInput(input)).toEqual({ valid: true, value });
  });

  it.each(["", " ", "NaN", "1.5", "-1", "1e2", "1000001"])(
    "rejects invalid editor input %s",
    (input) => {
      expect(parseChallengePointInput(input)).toEqual({
        valid: false,
        value: null,
      });
    }
  );

  it("maps Enter to save and Escape to cancel", () => {
    expect(challengePointEditorKeyAction("Enter")).toBe("save");
    expect(challengePointEditorKeyAction("Escape")).toBe("cancel");
    expect(challengePointEditorKeyAction("Tab")).toBeNull();
  });
});
