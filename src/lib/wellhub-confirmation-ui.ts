export const WELLHUB_CONFIRMATION_COPY = {
  title: "Actualiza tu plan de WellHub",
  body:
    "Para continuar usando WAVE Studio, necesitamos que confirmes cuál es tu plan actual de WellHub. Esta actualización nos permite asignarte correctamente los créditos correspondientes a tu plan.",
  note: "Selecciona tu plan actual para continuar.",
  submit: "Guardar y continuar",
} as const;

export function validateWellhubConfirmationSelection(value: string) {
  return value ? null : "Selecciona tu plan actual de WellHub.";
}
