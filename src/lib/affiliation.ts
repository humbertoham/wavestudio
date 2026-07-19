import { Affiliation, WellhubPlan } from "@prisma/client";

import { parseWellhubPlan } from "@/lib/wellhub";

export type NormalizedAffiliation =
  | {
      ok: true;
      affiliation: Affiliation;
      wellhubPlan: WellhubPlan | null;
    }
  | {
      ok: false;
      field: "affiliation" | "wellhubPlan";
      code: "INVALID_AFFILIATION" | "WELLHUB_PLAN_REQUIRED" | "INVALID_WELLHUB_PLAN";
      message: string;
    };

export function parseAffiliation(value: unknown): Affiliation | null {
  const map: Record<string, Affiliation> = {
    NONE: Affiliation.NONE,
    WELLHUB: Affiliation.WELLHUB,
    TOTALPASS: Affiliation.TOTALPASS,
    none: Affiliation.NONE,
    wellhub: Affiliation.WELLHUB,
    totalpass: Affiliation.TOTALPASS,
  };

  return typeof value === "string" ? (map[value] ?? null) : null;
}

function hasPlanInput(value: unknown) {
  return typeof value === "string" ? value.trim().length > 0 : value != null;
}

export function normalizeAffiliationAndPlan(
  affiliationInput: unknown,
  wellhubPlanInput: unknown
): NormalizedAffiliation {
  const affiliation = parseAffiliation(affiliationInput);

  if (!affiliation) {
    return {
      ok: false,
      field: "affiliation",
      code: "INVALID_AFFILIATION",
      message: "Selecciona una afiliacion valida.",
    };
  }

  const wellhubPlan = parseWellhubPlan(wellhubPlanInput);

  if (hasPlanInput(wellhubPlanInput) && !wellhubPlan) {
    return {
      ok: false,
      field: "wellhubPlan",
      code: "INVALID_WELLHUB_PLAN",
      message: "Selecciona un plan de WellHub valido.",
    };
  }

  if (affiliation === Affiliation.WELLHUB && !wellhubPlan) {
    return {
      ok: false,
      field: "wellhubPlan",
      code: "WELLHUB_PLAN_REQUIRED",
      message: "Selecciona tu plan de WellHub.",
    };
  }

  return {
    ok: true,
    affiliation,
    wellhubPlan: affiliation === Affiliation.WELLHUB ? wellhubPlan : null,
  };
}
