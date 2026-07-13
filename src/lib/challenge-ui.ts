import {
  CHALLENGE_ACTIVATION_CONFIRMATION,
  CHALLENGE_DEACTIVATION_CONFIRMATION,
} from "@/lib/challenge-copy";

export function shouldShowChallengePointControl(params: {
  active: boolean;
  challengeId?: string | null;
  eligibleAt?: string | Date | null;
}) {
  return params.active && !!params.challengeId && !!params.eligibleAt;
}

export function confirmChallengeLifecycleAction(
  action: "activate" | "deactivate",
  confirmFn: (message: string) => boolean
) {
  return confirmFn(
    action === "activate"
      ? CHALLENGE_ACTIVATION_CONFIRMATION
      : CHALLENGE_DEACTIVATION_CONFIRMATION
  );
}
