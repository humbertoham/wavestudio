import { ChallengePointsBadge } from "@/components/challenge/ChallengePointsBadge";

type ClassesAccountSummaryProps = {
  isAuthenticated: boolean;
  isSessionLoading: boolean;
  hasLoadedPrivateData: boolean;
  tokens: number;
  challenge: {
    active: boolean;
    points: number;
  };
};

export function shouldLoadClassesPrivateData({
  isAuthenticated,
  isSessionLoading,
}: Pick<
  ClassesAccountSummaryProps,
  "isAuthenticated" | "isSessionLoading"
>) {
  return isAuthenticated && !isSessionLoading;
}

export function ClassesAccountSummary({
  isAuthenticated,
  isSessionLoading,
  hasLoadedPrivateData,
  tokens,
  challenge,
}: ClassesAccountSummaryProps) {
  if (
    !shouldLoadClassesPrivateData({ isAuthenticated, isSessionLoading }) ||
    !hasLoadedPrivateData
  ) {
    return null;
  }

  return (
    <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
      <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm">
        <span className="opacity-70">Tus clases:</span>
        <span className="font-bold">{tokens}</span>
      </span>
      {challenge.active && <ChallengePointsBadge points={challenge.points} />}
    </div>
  );
}
