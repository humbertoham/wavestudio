import { formatInTimeZone, zonedTimeToUtc } from "date-fns-tz";

export const BUSINESS_TIME_ZONE = "America/Monterrey";

type BusinessDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
};

type BusinessMonth = {
  year: number;
  month: number;
};

function pad(value: number, length = 2) {
  return String(value).padStart(length, "0");
}

function businessParts(date: Date): BusinessDateParts {
  const [year, month, day, hour] = formatInTimeZone(
    date,
    BUSINESS_TIME_ZONE,
    "yyyy-MM-dd-HH"
  )
    .split("-")
    .map(Number);

  return { year, month, day, hour };
}

function businessLocalToUtc(
  year: number,
  month: number,
  day: number,
  hour: number
) {
  return zonedTimeToUtc(
    `${pad(year, 4)}-${pad(month)}-${pad(day)}T${pad(hour)}:00:00.000`,
    BUSINESS_TIME_ZONE
  );
}

function lastDayOfMonth({ year, month }: BusinessMonth) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function nextMonth({ year, month }: BusinessMonth): BusinessMonth {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

function previousMonth({ year, month }: BusinessMonth): BusinessMonth {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

function addBusinessCalendarDays(
  { year, month, day }: Pick<BusinessDateParts, "year" | "month" | "day">,
  days: number
) {
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function periodForMonth(month: BusinessMonth) {
  const next = nextMonth(month);
  const previous = previousMonth(month);
  const previousLastDay = lastDayOfMonth(previous);
  const targetLastDay = lastDayOfMonth(month);
  const previousExpiresAt = businessLocalToUtc(
    previous.year,
    previous.month,
    previousLastDay,
    23
  );

  return {
    periodKey: `${pad(month.year, 4)}-${pad(month.month)}`,
    periodStart: businessLocalToUtc(month.year, month.month, 1, 0),
    nextPeriodStart: businessLocalToUtc(next.year, next.month, 1, 0),
    renewalWindowStart: previousExpiresAt,
    previousPeriodExpiresAt: previousExpiresAt,
    expiresAt: businessLocalToUtc(month.year, month.month, targetLastDay, 23),
  };
}

export function getMonthlyRenewalPeriod(now = new Date()) {
  const local = businessParts(now);
  const localMonth = { year: local.year, month: local.month };
  const isEndOfMonthRun =
    local.day === lastDayOfMonth(localMonth) && local.hour >= 23;
  const isFirstDayRun = local.day === 1;
  const targetMonth = isEndOfMonthRun ? nextMonth(localMonth) : localMonth;

  return {
    now,
    businessTimeZone: BUSINESS_TIME_ZONE,
    local,
    isAllowedRunWindow: isEndOfMonthRun || isFirstDayRun,
    trigger: isEndOfMonthRun ? "END_OF_MONTH_23" : "FIRST_DAY",
    ...periodForMonth(targetMonth),
  };
}

export function getPackageExpirationAt11Pm(
  from: Date,
  validityDays: number
) {
  if (!Number.isFinite(validityDays) || validityDays <= 0) {
    throw new Error("validityDays must be a positive number");
  }

  const target = addBusinessCalendarDays(
    businessParts(from),
    Math.floor(validityDays)
  );

  return businessLocalToUtc(target.year, target.month, target.day, 23);
}

export function formatBusinessDateTime(date: Date) {
  return formatInTimeZone(date, BUSINESS_TIME_ZONE, "yyyy-MM-dd HH:mm");
}
