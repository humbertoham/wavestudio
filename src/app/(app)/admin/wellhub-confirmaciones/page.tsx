"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";

import { WELLHUB_PLAN_LABELS } from "@/lib/wellhub-config";

type Report = {
  campaign: string | null;
  totals: {
    included: number;
    pending: number;
    completed: number;
    failedOrInconsistent: number;
  };
  items: Array<{
    id: string;
    status: "PENDING" | "COMPLETED";
    requestedAt: string;
    confirmedAt: string | null;
    previousPlan: keyof typeof WELLHUB_PLAN_LABELS | null;
    selectedPlan: keyof typeof WELLHUB_PLAN_LABELS | null;
    creditDeltaApplied: number | null;
    resultingBalance: number | null;
    user: {
      id: string;
      name: string;
      email: string;
      affiliation: string;
      wellhubPlan: keyof typeof WELLHUB_PLAN_LABELS | null;
      wellhubPlanConfirmationRequired: boolean;
      wellhubPlanConfirmedAt: string | null;
      wellhubPlanConfirmationCampaign: string | null;
    };
  }>;
  page: number;
  pageSize: number;
  totalPages: number;
};

function date(value: string | null) {
  return value ? new Date(value).toLocaleString("es-MX") : "—";
}

function ReportContent() {
  const search = useSearchParams();
  const initialCampaign = search.get("campaign") ?? "";
  const [campaign, setCampaign] = useState(initialCampaign);
  const [activeCampaign, setActiveCampaign] = useState(initialCampaign);
  const [page, setPage] = useState(1);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), pageSize: "25" });
    if (activeCampaign) params.set("campaign", activeCampaign);

    fetch(`/api/admin/wellhub-plan-confirmations?${params}`, {
      credentials: "include",
    })
      .then(async (res) => {
        const payload = await res.json().catch(() => null);
        if (!res.ok) throw new Error("No se pudo cargar el reporte.");
        return payload as Report;
      })
      .then((payload) => {
        if (!cancelled) {
          setReport(payload);
          if (!activeCampaign && payload.campaign) {
            setCampaign(payload.campaign);
          }
        }
      })
      .catch((fetchError) => {
        if (!cancelled) {
          setError(
            fetchError instanceof Error
              ? fetchError.message
              : "No se pudo cargar el reporte."
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeCampaign, page]);

  function searchCampaign(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setActiveCampaign(campaign.trim());
  }

  return (
    <main className="container-app space-y-6 py-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Confirmaciones WellHub</h1>
          <p className="text-sm text-muted-foreground">
            Progreso y auditoría por campaña.
          </p>
        </div>
        <Link href="/admin?tab=users" className="btn-outline">
          Volver a usuarios
        </Link>
      </div>

      <form onSubmit={searchCampaign} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="campaign" className="sr-only">
          Campaña
        </label>
        <input
          id="campaign"
          value={campaign}
          onChange={(event) => setCampaign(event.target.value)}
          placeholder="Campaña (vacío muestra la más reciente)"
          className="input flex-1"
        />
        <button className="btn-primary" type="submit">
          Consultar
        </button>
      </form>

      {error && <div className="rounded border border-red-400 p-3 text-red-700">{error}</div>}
      {loading ? (
        <p>Cargando reporte...</p>
      ) : report ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Incluidos", report.totals.included],
              ["Pendientes", report.totals.pending],
              ["Completados", report.totals.completed],
              ["Inconsistentes", report.totals.failedOrInconsistent],
            ].map(([label, value]) => (
              <div key={label} className="rounded-[var(--radius)] border bg-[--color-card] p-4">
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="mt-1 text-2xl font-semibold">{value}</p>
              </div>
            ))}
          </section>

          <section className="overflow-x-auto rounded-[var(--radius)] border bg-[--color-card] p-4">
            <p className="mb-3 text-sm">
              Campaña: <strong>{report.campaign ?? "Sin campañas"}</strong>
            </p>
            <table className="min-w-[980px] w-full text-left text-sm">
              <thead className="border-b">
                <tr>
                  <th className="py-2">Usuario</th>
                  <th>Estado</th>
                  <th>Solicitado</th>
                  <th>Última confirmación</th>
                  <th>Plan actual</th>
                  <th>Plan confirmado</th>
                  <th>Delta</th>
                  <th>Saldo</th>
                </tr>
              </thead>
              <tbody>
                {report.items.map((item) => (
                  <tr key={item.id} className="border-b align-top">
                    <td className="py-2">
                      <div>{item.user.name}</div>
                      <div className="text-xs text-muted-foreground">{item.user.email}</div>
                    </td>
                    <td>{item.status === "COMPLETED" ? "Completado" : "Pendiente"}</td>
                    <td>{date(item.requestedAt)}</td>
                    <td>{date(item.user.wellhubPlanConfirmedAt ?? item.confirmedAt)}</td>
                    <td>{item.user.wellhubPlan ? WELLHUB_PLAN_LABELS[item.user.wellhubPlan] : "Sin plan"}</td>
                    <td>{item.selectedPlan ? WELLHUB_PLAN_LABELS[item.selectedPlan] : "—"}</td>
                    <td>{item.creditDeltaApplied ?? "—"}</td>
                    <td>{item.resultingBalance ?? "—"}</td>
                  </tr>
                ))}
                {report.items.length === 0 && (
                  <tr><td colSpan={8} className="py-6 text-center text-muted-foreground">Sin registros.</td></tr>
                )}
              </tbody>
            </table>
          </section>

          <div className="flex items-center justify-between">
            <button className="btn-outline" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Anterior</button>
            <span className="text-sm">Página {report.page} de {report.totalPages}</span>
            <button className="btn-outline" disabled={page >= report.totalPages} onClick={() => setPage((value) => value + 1)}>Siguiente</button>
          </div>
        </>
      ) : null}
    </main>
  );
}

export default function WellhubConfirmationsAdminPage() {
  return (
    <Suspense fallback={<main className="container-app py-8">Cargando...</main>}>
      <ReportContent />
    </Suspense>
  );
}
