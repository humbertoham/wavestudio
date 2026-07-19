import { WELLHUB_CONFIRMATION_PATH } from "./wellhub-confirmation-gate";

export const DEFAULT_AUTHENTICATED_PATH = "/clases";

const INTERNAL_ORIGIN = "https://wave.internal";
const DISALLOWED_DESTINATIONS = new Set([
  "/afiliacion",
  "/login",
  WELLHUB_CONFIRMATION_PATH,
]);

export function safePostLoginDestination(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/")) {
    return DEFAULT_AUTHENTICATED_PATH;
  }

  try {
    const parsed = new URL(value, INTERNAL_ORIGIN);
    const normalizedPathname =
      parsed.pathname.length > 1
        ? parsed.pathname.replace(/\/+$/, "")
        : parsed.pathname;

    if (parsed.origin !== INTERNAL_ORIGIN) return DEFAULT_AUTHENTICATED_PATH;
    if (normalizedPathname.startsWith("/api")) return DEFAULT_AUTHENTICATED_PATH;
    if (normalizedPathname.startsWith("/_next")) return DEFAULT_AUTHENTICATED_PATH;
    if (DISALLOWED_DESTINATIONS.has(normalizedPathname)) {
      return DEFAULT_AUTHENTICATED_PATH;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return DEFAULT_AUTHENTICATED_PATH;
  }
}
