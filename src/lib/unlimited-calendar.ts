import { formatInTimeZone, zonedTimeToUtc } from "date-fns-tz";
import { BUSINESS_TIME_ZONE } from "@/lib/package-expiration";

export const unlimitedErrorMessages = {
  UNLIMITED_DAILY_LIMIT:
    "Tu paquete ilimitado permite reservar una clase por día.",
  UNLIMITED_SEAT_LIMIT:
    "Tu paquete ilimitado permite reservar solo un lugar por clase. Los lugares adicionales requieren créditos disponibles.",
  UNLIMITED_NOT_ACTIVE:
    "Tu paquete ilimitado ya no está vigente para nuevas reservas.",
  UNLIMITED_ENTITLEMENT_REVOKED:
    "Este paquete ilimitado fue revocado y ya no puede utilizarse para reservar clases.",
  UNLIMITED_MONTH_MISMATCH:
    "Tu paquete ilimitado no corresponde al mes de esta clase.",
} as const;
export type UnlimitedErrorCode = keyof typeof unlimitedErrorMessages;

export function businessClassDay(date: Date) {
  const key = formatInTimeZone(date, BUSINESS_TIME_ZONE, "yyyy-MM-dd");
  const [year, month] = key.split("-").map(Number);
  return { key, year, month, serviceDate: new Date(`${key}T00:00:00.000Z`) };
}

export function monthlyPeriod(year: number, month: number) {
  if (
    !Number.isInteger(year) ||
    year < 2000 ||
    year > 2200 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    throw new Error("INVALID_UNLIMITED_MONTH");
  }
  const local = (y: number, m: number) =>
    zonedTimeToUtc(
      `${y}-${String(m).padStart(2, "0")}-01T00:00:00`,
      BUSINESS_TIME_ZONE,
    );
  return {
    startsAt: local(year, month),
    expiresAt: local(
      month === 12 ? year + 1 : year,
      month === 12 ? 1 : month + 1,
    ),
  };
}

export function monthLabel(year: number, month: number) {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: BUSINESS_TIME_ZONE,
    month: "long",
    year: "numeric",
  }).format(monthlyPeriod(year, month).startsAt);
}
