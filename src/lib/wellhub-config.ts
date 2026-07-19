export const WELLHUB_PLANS = [
  "GOLD_PLUS",
  "PLATINUM",
  "DIAMOND",
  "DIAMOND_PLUS",
] as const;

export type WellhubPlanValue = (typeof WELLHUB_PLANS)[number];

export const WELLHUB_PLAN_LABELS: Record<WellhubPlanValue, string> = {
  GOLD_PLUS: "Gold+",
  PLATINUM: "Platinum",
  DIAMOND: "Diamond",
  DIAMOND_PLUS: "Diamond+",
};

export const WELLHUB_PLAN_CREDITS: Record<WellhubPlanValue, number> = {
  GOLD_PLUS: 2,
  PLATINUM: 8,
  DIAMOND: 30,
  DIAMOND_PLUS: 30,
};
