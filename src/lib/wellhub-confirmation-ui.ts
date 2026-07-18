export const WELLHUB_CONFIRMATION_COPY = {
  title: "Actualiza tu plan de WellHub",
  body:
    "Para continuar usando WAVE Studio, necesitamos que confirmes cuál es tu plan actual de WellHub. Esta actualización nos permite asignarte correctamente los créditos correspondientes a tu plan.",
  note: "Selecciona tu plan actual para continuar.",
  submit: "Guardar y continuar",
} as const;

export const WELLHUB_CONFIRMATION_DESTINATION = "/clases";

export async function completeWellhubConfirmationNavigation(params: {
  refreshSession?: () => Promise<
    { wellhubPlanConfirmationRequired: boolean } | null | undefined
  >;
  replace: (destination: string) => void;
  refreshRouter: () => void;
  sessionErrorMessage?: string;
}) {
  if (params.refreshSession) {
    const session = await params.refreshSession();
    if (!session || session.wellhubPlanConfirmationRequired) {
      throw new Error(
        params.sessionErrorMessage ??
          "No se pudo actualizar la sesión. Intenta continuar nuevamente."
      );
    }
  }

  params.replace(WELLHUB_CONFIRMATION_DESTINATION);
  params.refreshRouter();
  return WELLHUB_CONFIRMATION_DESTINATION;
}

export function validateWellhubConfirmationSelection(value: string) {
  return value ? null : "Selecciona tu plan actual de WellHub.";
}
