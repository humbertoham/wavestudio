"use client";

export type PackageCalendarDraft = {
  type?: "STANDARD" | "MONTHLY_UNLIMITED";
  unlimitedMonth?: number | null;
  unlimitedYear?: number | null;
};
const months = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

export function PackageTypeFields({
  value,
  onChange,
}: {
  value: PackageCalendarDraft;
  onChange: (change: PackageCalendarDraft) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3 md:col-span-5">
      <label className="text-sm">
        Tipo de paquete
        <select
          className="input mt-1 w-full"
          value={value.type ?? "STANDARD"}
          onChange={(e) =>
            onChange({ type: e.target.value as PackageCalendarDraft["type"] })
          }
        >
          <option value="STANDARD">Paquete de clases</option>
          <option value="MONTHLY_UNLIMITED">Ilimitado mensual</option>
        </select>
      </label>
      {value.type === "MONTHLY_UNLIMITED" && (
        <>
          <label className="text-sm">
            Mes
            <select
              required
              className="input mt-1 w-full"
              value={value.unlimitedMonth ?? ""}
              onChange={(e) =>
                onChange({
                  unlimitedMonth: e.target.value
                    ? Number(e.target.value)
                    : null,
                })
              }
            >
              <option value="">Selecciona el mes</option>
              {months.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Año
            <input
              required
              className="input mt-1 w-full"
              type="number"
              min={2000}
              max={2200}
              step={1}
              value={value.unlimitedYear ?? ""}
              onChange={(e) =>
                onChange({
                  unlimitedYear: e.target.value ? Number(e.target.value) : null,
                })
              }
            />
          </label>
          <p className="text-xs text-muted-foreground sm:col-span-3">
            Una clase por día, un lugar incluido. La vigencia corresponde al mes
            de la clase; se puede comprar y reservar anticipadamente. Editar
            este paquete no cambia las compras existentes.
          </p>
        </>
      )}
    </div>
  );
}
