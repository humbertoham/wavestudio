import { FiStar } from "react-icons/fi";

export function ChallengePointsBadge({ points }: { points: number }) {
  const safePoints = Number.isFinite(points) ? Math.max(0, Math.floor(points)) : 0;
  const label = `${safePoints} punto${safePoints === 1 ? "" : "s"} del Challenge`;

  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-bold text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
      aria-label={label}
    >
      <FiStar aria-hidden="true" className="fill-current" />
      <span>{safePoints} punto{safePoints === 1 ? "" : "s"}</span>
    </span>
  );
}
