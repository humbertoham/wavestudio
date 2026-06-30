type GatePayload = {
  role?: unknown;
  affiliationConfirmed?: unknown;
};

const ONBOARDING_PATH = "/afiliacion";

const AUTH_ALLOWED_PREFIXES = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/api/auth",
  "/api/register",
  "/api/users/me/affiliation",
];

const PAGE_GATE_PREFIXES = [
  "/admin",
  "/clases",
  "/compras",
  "/dashboard",
  "/mis-clases",
  "/perfil",
  "/reservas",
];

function startsWithPath(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isAffiliationGateAllowedPath(pathname: string) {
  return (
    startsWithPath(pathname, ONBOARDING_PATH) ||
    AUTH_ALLOWED_PREFIXES.some((prefix) => startsWithPath(pathname, prefix))
  );
}

export function isAffiliationGatedPath(pathname: string) {
  return (
    PAGE_GATE_PREFIXES.some((prefix) => startsWithPath(pathname, prefix)) ||
    startsWithPath(pathname, "/api")
  );
}

export function shouldRequireAffiliationOnboarding(
  pathname: string,
  payload: GatePayload | null | undefined
) {
  if (!payload) return false;
  if (payload.role === "ADMIN") return false;
  if (payload.affiliationConfirmed === true) return false;
  if (isAffiliationGateAllowedPath(pathname)) return false;

  return isAffiliationGatedPath(pathname);
}
