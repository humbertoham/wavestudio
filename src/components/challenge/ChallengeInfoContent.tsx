import { FiStar } from "react-icons/fi";

import {
  CHALLENGE_INFO_INTRO,
  CHALLENGE_INFO_POINTS,
  CHALLENGE_INFO_TITLE,
} from "@/lib/challenge-copy";

export function ChallengeInfoContent() {
  return (
    <div className="card p-6 md:p-8">
      <div className="flex items-center gap-3">
        <FiStar aria-hidden="true" className="h-8 w-8 fill-current text-amber-500" />
        <h1 className="font-display text-3xl font-bold">{CHALLENGE_INFO_TITLE}</h1>
      </div>
      <p className="mt-4 text-lg text-muted-foreground">{CHALLENGE_INFO_INTRO}</p>
      <ul className="mt-6 space-y-3" aria-label="Reglas del Challenge">
        {CHALLENGE_INFO_POINTS.map((point) => (
          <li key={point} className="flex gap-3">
            <span aria-hidden="true" className="font-bold text-primary">•</span>
            <span>{point}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
