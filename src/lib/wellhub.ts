import { Affiliation, Prisma, WellhubPlan } from "@prisma/client";

export const LEGACY_WELLHUB_PACK_ID = "corp_wellhub_monthly";
export const TOTALPASS_PACK_ID = "corp_totalpass_monthly";
export const TOTALPASS_MONTHLY_CREDITS = 10;

export const WELLHUB_PLAN_LABELS: Record<WellhubPlan, string> = {
  GOLD_PLUS: "Gold+",
  PLATINUM: "Platinum",
  DIAMOND: "Diamond",
  DIAMOND_PLUS: "Diamond+",
};

export const WELLHUB_PLAN_CREDITS: Record<WellhubPlan, number> = {
  GOLD_PLUS: 2,
  PLATINUM: 8,
  DIAMOND: 30,
  DIAMOND_PLUS: 30,
};

export const WELLHUB_PLAN_PACK_IDS: Record<WellhubPlan, string> = {
  GOLD_PLUS: "corp_wellhub_gold_plus_monthly",
  PLATINUM: "corp_wellhub_platinum_monthly",
  DIAMOND: "corp_wellhub_diamond_monthly",
  DIAMOND_PLUS: "corp_wellhub_diamond_plus_monthly",
};

export const WELLHUB_PLANS = Object.keys(
  WELLHUB_PLAN_LABELS
) as WellhubPlan[];

export const WELLHUB_INTERNAL_PACK_IDS = [
  LEGACY_WELLHUB_PACK_ID,
  ...WELLHUB_PLANS.map((plan) => WELLHUB_PLAN_PACK_IDS[plan]),
] as string[];

export const CORPORATE_INTERNAL_PACK_IDS = [
  ...WELLHUB_INTERNAL_PACK_IDS,
  TOTALPASS_PACK_ID,
] as string[];

type PackClient = {
  pack: {
    upsert(args: Prisma.PackUpsertArgs): Promise<unknown>;
  };
};

export type CorporateGrantConfig = {
  classesGranted: number;
  packId: string;
};

export function isWellhubPlan(value: unknown): value is WellhubPlan {
  return typeof value === "string" && WELLHUB_PLANS.includes(value as WellhubPlan);
}

export function parseWellhubPlan(value: unknown): WellhubPlan | null {
  if (typeof value !== "string") return null;

  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_")
    .replace(/\+/g, "_PLUS")
    .replace(/__+/g, "_")
    .replace(/_$/g, "");

  if (isWellhubPlan(normalized)) return normalized;
  return null;
}

export function getWellhubPlanCredits(
  plan: WellhubPlan | null | undefined
): number | null {
  return plan ? (WELLHUB_PLAN_CREDITS[plan] ?? null) : null;
}

export function getCorporateGrantConfig(
  affiliation: Affiliation | null | undefined,
  wellhubPlan: WellhubPlan | null | undefined
): CorporateGrantConfig | null {
  if (affiliation === Affiliation.WELLHUB) {
    const classesGranted = getWellhubPlanCredits(wellhubPlan);
    if (!classesGranted || !wellhubPlan) return null;

    return {
      classesGranted,
      packId: WELLHUB_PLAN_PACK_IDS[wellhubPlan],
    };
  }

  if (affiliation === Affiliation.TOTALPASS) {
    return {
      classesGranted: TOTALPASS_MONTHLY_CREDITS,
      packId: TOTALPASS_PACK_ID,
    };
  }

  return null;
}

export async function ensureCorporatePacks(client: PackClient) {
  await client.pack.upsert({
    where: { id: LEGACY_WELLHUB_PACK_ID },
    update: {
      name: "WellHub Mensual (Interno Legacy)",
      classes: 30,
      price: 0,
      validityDays: 31,
      isActive: false,
      isVisible: false,
      oncePerUser: false,
      classesLabel: "30 clases",
    },
    create: {
      id: LEGACY_WELLHUB_PACK_ID,
      name: "WellHub Mensual (Interno Legacy)",
      classes: 30,
      price: 0,
      validityDays: 31,
      isActive: false,
      isVisible: false,
      oncePerUser: false,
      classesLabel: "30 clases",
    },
  });

  for (const plan of WELLHUB_PLANS) {
    const credits = WELLHUB_PLAN_CREDITS[plan];
    const classesLabel = `${credits} clase${credits === 1 ? "" : "s"}`;

    await client.pack.upsert({
      where: { id: WELLHUB_PLAN_PACK_IDS[plan] },
      update: {
        name: `WellHub ${WELLHUB_PLAN_LABELS[plan]} Mensual (Interno)`,
        classes: credits,
        price: 0,
        validityDays: 31,
        isActive: false,
        isVisible: false,
        oncePerUser: false,
        classesLabel,
      },
      create: {
        id: WELLHUB_PLAN_PACK_IDS[plan],
        name: `WellHub ${WELLHUB_PLAN_LABELS[plan]} Mensual (Interno)`,
        classes: credits,
        price: 0,
        validityDays: 31,
        isActive: false,
        isVisible: false,
        oncePerUser: false,
        classesLabel,
      },
    });
  }

  await client.pack.upsert({
    where: { id: TOTALPASS_PACK_ID },
    update: {
      name: "TotalPass Mensual (Interno)",
      classes: TOTALPASS_MONTHLY_CREDITS,
      price: 0,
      validityDays: 31,
      isActive: false,
      isVisible: false,
      oncePerUser: false,
      classesLabel: `${TOTALPASS_MONTHLY_CREDITS} clases`,
    },
    create: {
      id: TOTALPASS_PACK_ID,
      name: "TotalPass Mensual (Interno)",
      classes: TOTALPASS_MONTHLY_CREDITS,
      price: 0,
      validityDays: 31,
      isActive: false,
      isVisible: false,
      oncePerUser: false,
      classesLabel: `${TOTALPASS_MONTHLY_CREDITS} clases`,
    },
  });
}
