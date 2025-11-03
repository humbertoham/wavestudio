// src/types/date-fns-tz.d.ts
declare module "date-fns-tz" {
  // Versión 1.x
  export function zonedTimeToUtc(
    date: Date | number | string,
    timeZone: string
  ): Date;

  export function utcToZonedTime(
    date: Date | number | string,
    timeZone: string
  ): Date;

  /** También existe en 1.x y es útil en UI */
  export function formatInTimeZone(
    date: Date | number,
    timeZone: string,
    formatStr: string,
    options?: Record<string, unknown>
  ): string;
}
