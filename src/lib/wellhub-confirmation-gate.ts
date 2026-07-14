export const WELLHUB_CONFIRMATION_PATH = "/actualizar-plan-wellhub";

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

export function shouldRequireWellhubPlanConfirmation(
  pathname: string,
  required: boolean | null | undefined
) {
  return (
    required === true && !isWellhubConfirmationAllowedPath(pathname)
  );
}
