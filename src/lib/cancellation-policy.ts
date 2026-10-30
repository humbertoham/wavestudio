export const CANCELLATION_CUTOFF_HOURS = 6;
export const CANCELLATION_CUTOFF_MINUTES = CANCELLATION_CUTOFF_HOURS * 60;
export const CANCELLATION_CUTOFF_MS = CANCELLATION_CUTOFF_MINUTES * 60_000;

export const CANCELLATION_POLICY_TEXT =
  `Puedes cancelar tu reservación hasta ${CANCELLATION_CUTOFF_HOURS} horas antes del inicio de la clase.`;
export const LATE_CANCELLATION_WARNING =
  `Faltan menos de ${CANCELLATION_CUTOFF_HOURS} horas para la clase.`;

/** Compare timestamps directly: exactly six hours is still on time. */
export function isLateCancellation(classStart: Date, canceledAt: Date) {
  return classStart.getTime() - canceledAt.getTime() < CANCELLATION_CUTOFF_MS;
}
