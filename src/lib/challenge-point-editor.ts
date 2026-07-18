export const CHALLENGE_USER_MAX_POINTS = 1_000_000;

export function parseChallengePointInput(raw: string) {
  const normalized = raw.trim();
  if (!/^\d+$/.test(normalized)) {
    return { valid: false as const, value: null };
  }

  const value = Number(normalized);
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > CHALLENGE_USER_MAX_POINTS
  ) {
    return { valid: false as const, value: null };
  }

  return { valid: true as const, value };
}

export function challengePointEditorKeyAction(key: string) {
  if (key === "Enter") return "save" as const;
  if (key === "Escape") return "cancel" as const;
  return null;
}
