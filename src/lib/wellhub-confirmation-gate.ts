export const WELLHUB_CONFIRMATION_PATH = "/actualizar-plan-wellhub";

export type WellhubConfirmationState = {
  affiliation?: unknown;
  wellhubPlanConfirmationRequired?: unknown;
  wellhubPlanConfirmationCampaign?: unknown;
  pendingWellhubPlanConfirmationCampaigns?: readonly string[] | null;
};

const ALLOWED_PAGE_PATHS = [
  WELLHUB_CONFIRMATION_PATH,
  "/login",
  "/forgot-password",
  "/reset-password",
];

const ALLOWED_API_PATHS = [
  "/api/auth/login",
  "/api/auth/me",
  "/api/auth/logout",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/wellhub/plans",
  "/api/users/me/wellhub-plan-confirmation",
];

function startsWithPath(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isWellhubConfirmationAllowedPath(pathname: string) {
  return (
    ALLOWED_PAGE_PATHS.some((prefix) => startsWithPath(pathname, prefix)) ||
    ALLOWED_API_PATHS.some((prefix) => startsWithPath(pathname, prefix))
  );
}

export function hasPendingWellhubPlanConfirmation(
  state: WellhubConfirmationState | null | undefined
) {
  if (!state || state.affiliation !== "WELLHUB") return false;
  if (state.wellhubPlanConfirmationRequired !== true) return false;
  if (typeof state.wellhubPlanConfirmationCampaign !== "string") return false;

  return Boolean(
    state.pendingWellhubPlanConfirmationCampaigns?.includes(
      state.wellhubPlanConfirmationCampaign
    )
  );
}

export function shouldRequireWellhubPlanConfirmation(
  pathname: string,
  state: WellhubConfirmationState | null | undefined
) {
  return (
    hasPendingWellhubPlanConfirmation(state) &&
    !isWellhubConfirmationAllowedPath(pathname)
  );
}
