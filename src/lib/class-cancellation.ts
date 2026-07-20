export const STUDIO_TIME_ZONE = "America/Monterrey";

type BookingStatus = "ACTIVE" | "CANCELED" | undefined;

function part(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPart["type"]
) {
  return parts.find((candidate) => candidate.type === type)?.value;
}

function spanishDayPeriod(value: string | undefined) {
  const normalized = value?.trim().toLocaleLowerCase("es-MX") ?? "";

  if (normalized.startsWith("a")) return "a. m.";
  if (normalized.startsWith("p")) return "p. m.";
  return normalized;
}

export function formatBookingCancellation(
  status: BookingStatus,
  canceledAt?: string | null
) {
  if (status !== "CANCELED" || !canceledAt) return null;

  const date = new Date(canceledAt);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("es-MX", {
    timeZone: STUDIO_TIME_ZONE,
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);

  const day = part(parts, "day");
  const month = part(parts, "month");
  const year = part(parts, "year");
  const hour = part(parts, "hour");
  const minute = part(parts, "minute");
  const dayPeriod = spanishDayPeriod(part(parts, "dayPeriod"));

  if (!day || !month || !year || !hour || !minute || !dayPeriod) return null;

  return `Canceló el ${day} de ${month} de ${year} a las ${hour}:${minute} ${dayPeriod}`;
}

export function isLateCanceledBooking(
  classDateIso: string,
  canceledAt?: string | null
) {
  if (!canceledAt) return false;

  const classTime = new Date(classDateIso).getTime();
  const canceledTime = new Date(canceledAt).getTime();

  if (Number.isNaN(classTime) || Number.isNaN(canceledTime)) return false;

  const minutesBeforeClass = Math.floor((classTime - canceledTime) / 60000);
  return minutesBeforeClass < 240;
}
