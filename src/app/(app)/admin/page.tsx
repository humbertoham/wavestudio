"use client";

import useSWR from "swr";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FiMessageCircle } from "react-icons/fi";
import { getWhatsAppHref } from "@/lib/whatsapp";
import {
  confirmChallengeLifecycleAction,
  shouldShowChallengePointControl,
} from "@/lib/challenge-ui";
import {
  WELLHUB_PLAN_CREDITS,
  WELLHUB_PLAN_LABELS,
  WELLHUB_PLANS,
} from "@/lib/wellhub-config";

// --- helpers ---
const USER_PAGE_SIZE = 25;
const PURCHASE_PAGE_SIZE = 20;

const fetcher = (url: string) =>
  fetch(url, { credentials: "include" }).then(r => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  });

function Section({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-4 md:p-6 border rounded-[var(--radius)] bg-[--color-card] text-[--color-card-foreground]">
      {children}
    </div>
  );
}
function toLocalDatetimeMX(iso: string) {
  const d = new Date(iso);

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Monterrey",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);

  const year = parts.find(p => p.type === "year")?.value;
  const month = parts.find(p => p.type === "month")?.value;
  const day = parts.find(p => p.type === "day")?.value;

  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Monterrey",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);

  return `${year}-${month}-${day}T${time}`;
}

async function readApiMessage(res: Response, fallback: string) {
  const payload = await res.json().catch(() => null);

  if (
    payload &&
    typeof payload === "object" &&
    "message" in payload &&
    typeof payload.message === "string"
  ) {
    return payload.message;
  }

  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }

  return fallback;
}

function formatAdminDate(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

function formatMoneyMXN(value?: number | null) {
  return typeof value === "number"
    ? value.toLocaleString("es-MX", {
        style: "currency",
        currency: "MXN",
        maximumFractionDigits: 0,
      })
    : "—";
}

function formatCreditReason(reason: string) {
  const labels: Record<string, string> = {
    PURCHASE_CREDIT: "Compra",
    BOOKING_DEBIT: "Reserva",
    CANCEL_REFUND: "Cancelacion",
    ADMIN_ADJUST: "Ajuste admin",
    CORPORATE_MONTHLY: "Renovacion corporativa",
    ADMIN_WELLHUB_PLAN_CHANGE: "Cambio WellHub",
  };

  return labels[reason] ?? reason;
}

function metadataText(value: unknown) {
  return typeof value === "string" && value !== "NONE" ? value : "Ninguno";
}

function metadataNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

type Affiliation = "NONE" | "WELLHUB" | "TOTALPASS";
type WellhubPlan = "GOLD_PLUS" | "PLATINUM" | "DIAMOND" | "DIAMOND_PLUS";
type Role = "USER" | "COACH" | "ADMIN";
type AdminTab =
  | "classes"
  | "instructors"
  | "packs"
  | "purchases"
  | "revenue"
  | "users"
  | "challenge";
type PurchasePaymentStatusFilter =
  | "ALL"
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "REFUNDED"
  | "CANCELED"
  | "NO_PAYMENT";
type PurchaseRemainingFilter = "ALL" | "ACTIVE" | "ZERO";
type PurchaseSort = "newest" | "oldest";

const AFFILIATION_LABELS: Record<Affiliation, string> = {
  NONE: "Ninguna",
  WELLHUB: "WellHub",
  TOTALPASS: "TotalPass",
};

const ROLE_LABELS: Record<Role, string> = {
  USER: "User",
  COACH: "Coach",
  ADMIN: "Admin",
};

const PURCHASE_PAYMENT_STATUS_LABELS: Record<
  PurchasePaymentStatusFilter,
  string
> = {
  ALL: "Todos",
  PENDING: "Pendiente",
  APPROVED: "Aprobado",
  REJECTED: "Rechazado",
  REFUNDED: "Reembolsado",
  CANCELED: "Cancelado",
  NO_PAYMENT: "Sin pago",
};

const PURCHASE_REMAINING_LABELS: Record<PurchaseRemainingFilter, string> = {
  ALL: "Todos",
  ACTIVE: "Con restantes",
  ZERO: "Usados / cero",
};

function isAdminTab(value: string | null): value is AdminTab {
  return (
    value === "classes" ||
    value === "instructors" ||
    value === "packs" ||
    value === "purchases" ||
    value === "revenue" ||
    value === "users" ||
    value === "challenge"
  );
}

function isAffiliation(value: string | null): value is Affiliation {
  return value === "NONE" || value === "WELLHUB" || value === "TOTALPASS";
}

function isPurchasePaymentStatusFilter(
  value: string | null
): value is PurchasePaymentStatusFilter {
  return (
    value === "ALL" ||
    value === "PENDING" ||
    value === "APPROVED" ||
    value === "REJECTED" ||
    value === "REFUNDED" ||
    value === "CANCELED" ||
    value === "NO_PAYMENT"
  );
}

function isPurchaseRemainingFilter(
  value: string | null
): value is PurchaseRemainingFilter {
  return value === "ALL" || value === "ACTIVE" || value === "ZERO";
}

function isPurchaseSort(value: string | null): value is PurchaseSort {
  return value === "newest" || value === "oldest";
}

function isDateInputValue(value: string | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseQueryInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), 1), max);
}

function getAdminWhatsAppMessage(name?: string | null) {
  const trimmedName = name?.trim();
  return trimmedName
    ? `Hola ${trimmedName}, te contactamos de WAVE Studio.`
    : "Hola, te contactamos de WAVE Studio.";
}

type Instructor = { id: string; name: string; bio?: string | null };
type ClassItem = {
  id: string; title: string; focus: string; date: string; durationMin: number; capacity: number;
  instructorId: string; instructor?: { id: string; name: string };
  isCanceled?: boolean; // ← agregar
  challengeId?: string | null;
  challengePoints?: number | null;
  challengeEligibleAt?: string | null;
  challengeActivationVersion?: number | null;
  challengePointsLocked?: boolean;
};
type ChallengeAdminState = {
  id: string | null;
  name: string;
  active: boolean;
  activationVersion: number;
  activatedAt: string | null;
  deactivatedAt: string | null;
};
type ChallengeLeaderboard = {
  items: Array<{
    rank: number;
    id: string;
    name: string;
    email: string;
    points: number;
  }>;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};
type Pack = {
  id: string;
  name: string;
  classes: number;
  price: number;           // entero (pesos)
  validityDays: number;
  isActive: boolean;
  oncePerUser: boolean; // ✅ AQUI
  createdAt: string;

  classesLabel: string | null;
  highlight: "POPULAR" | "BEST" | null;
  description: string[] | null;
};
type User = {
  id: string;
  name: string | null;
  email: string;
  role: Role;
  phone?: string | null;
  dateOfBirth?: string | null;
  affiliation: Affiliation;
  wellhubPlan?: WellhubPlan | null;
  affiliationConfirmedAt?: string | null;
  bookingBlocked?: boolean;
};
type PaginatedUsers = {
  items: User[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};
type UserDetails = {
  user: {
    id: string;
    name: string | null;
    email: string;
    role: Role;
    dateOfBirth?: string | null;
    phone?: string | null;
    emergencyPhone?: string | null;
    affiliation: Affiliation;
    wellhubPlan?: WellhubPlan | null;
    affiliationConfirmedAt?: string | null;
    bookingBlocked: boolean;
    bookingBlockedAt?: string | null;
    bookingBlockLogs?: Array<{
      id: string;
      blocked: boolean;
      createdAt: string;
    }>;
    createdAt: string;
  };
  tokenBalance: number;
  purchases: Array<{
    id: string;
    createdAt: string;
    expiresAt: string;
    classesLeft: number;
    pausedDays: number;
    pausedUntil?: string | null;
    isPaused?: boolean;
    pack: { id: string; name: string; classes: number; validityDays: number; price: number };
    payment?: { id: string; status: "PENDING"|"APPROVED"|"REJECTED"|"REFUNDED"|"CANCELED"|null } | null;
  }>;
  bookings: Array<{
    id: string;
    status: "ACTIVE"|"CANCELED";
    quantity: number;
    createdAt: string;
    class: {
      id: string;
      title: string;
      date: string;
      instructor?: { id: string; name: string } | null;
    };
    packPurchase?: { id: string; pack?: { id: string; name: string } | null } | null;
  }>;
  creditHistory: Array<{
    id: string;
    delta: number;
    reason: string;
    metadata?: Record<string, unknown> | null;
    createdAt: string;
    packPurchase?: {
      id: string;
      pack?: { id: string; name: string } | null;
    } | null;
    booking?: {
      id: string;
      class?: { title: string; date: string } | null;
    } | null;
  }>;
};
type PurchasedPackage = {
  id: string;
  createdAt: string;
  expiresAt: string;
  classesLeft: number;
  classesPurchased: number;
  creditReason?: string | null;
  user: { name: string | null; email: string; affiliation: Affiliation };
  pack: { name: string; classes: number; price: number };
  amountPaid: number;
  paymentStatus: "PENDING" | "APPROVED" | "REJECTED" | "REFUNDED" | "CANCELED" | null;
  paymentProvider: "MERCADOPAGO" | "ADMIN" | null;
  paymentReference?: string | null;
  checkoutStatus?: "CREATED" | "OPEN" | "EXPIRED" | "COMPLETED" | "CANCELED" | null;
};
type PaginatedPurchasedPackages = {
  items: PurchasedPackage[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};
type BookingRow = {
  id: string;
  status: "ACTIVE" | "CANCELED";
  quantity: number;
  createdAt: string;
  user: { id: string; name: string | null; email: string };
  class: {
    id: string;
    title: string;
    date: string;
    instructor?: { id: string; name: string } | null;
  };
};

// ...
export default function AdminPage() {
  return (
    <Suspense
      fallback={
        <main className="container-app py-8">
          <p className="text-sm text-muted-foreground">Cargando panel...</p>
        </main>
      }
    >
      <AdminPageContent />
    </Suspense>
  );
}

function AdminPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const [tab, setTab] = useState<AdminTab>(
    isAdminTab(tabParam) ? tabParam : "classes"
  );

  useEffect(() => {
    const nextTab = isAdminTab(tabParam) ? tabParam : "classes";
    if (nextTab !== tab) {
      setTab(nextTab);
    }
  }, [tab, tabParam]);

  const tabs: Array<[value: AdminTab, label: string]> = [
    ["classes", "Clases"],
    ["instructors", "Instructores"],
    ["packs", "Paquetes"],
    ["purchases", "Compras"],
    ["revenue", "Ingresos"],
    ["users", "Usuarios"],
    ["challenge", "CHALLENGE"],
  ];

  function selectTab(next: AdminTab) {
    setTab(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === "classes") {
      params.delete("tab");
    } else {
      params.set("tab", next);
    }
    const query = params.toString();
    router.push(query ? `?${query}` : "/admin", { scroll: false });
  }

  return (
    <main className="container-app py-8 space-y-6">
      <h1 className="text-2xl font-bold">Panel de administrador</h1>

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap" role="tablist" aria-label="Secciones del panel">
        {tabs.map(([value, label]) => {
          const selected = tab === value;
          return (
            <button
              key={value}
              role="tab"
              aria-selected={selected}
              aria-controls={`panel-${value}`}
              onClick={() => selectTab(value)}
              className={selected ? "btn-primary" : "btn-outline"}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Panels */}
      <section
        id="panel-classes"
        role="tabpanel"
        hidden={tab !== "classes"}
        aria-labelledby="classes"
        className="space-y-6"
      >
        {tab === "classes" && <ClassesSection />}
      </section>

      <section
        id="panel-instructors"
        role="tabpanel"
        hidden={tab !== "instructors"}
        aria-labelledby="instructors"
        className="space-y-6"
      >
        {tab === "instructors" && <InstructorsSection />}
      </section>

      <section
        id="panel-packs"
        role="tabpanel"
        hidden={tab !== "packs"}
        aria-labelledby="packs"
        className="space-y-6"
      >
        {tab === "packs" && <PacksSection />}
      </section>

      <section
        id="panel-purchases"
        role="tabpanel"
        hidden={tab !== "purchases"}
        aria-labelledby="purchases"
        className="space-y-6"
      >
        {tab === "purchases" && <PurchasedPackagesSection />}
      </section>

     

      

      <section
        id="panel-revenue"
        role="tabpanel"
        hidden={tab !== "revenue"}
        aria-labelledby="revenue"
        className="space-y-6"
      >
        {tab === "revenue" && <RevenueSection />}
      </section>

      
      
<section
  id="panel-users"
  role="tabpanel"
  hidden={tab !== "users"}
  aria-labelledby="users"
  className="space-y-6"
>
  {tab === "users" && <UserInspectorSection />}
</section>
      <section
        id="panel-challenge"
        role="tabpanel"
        hidden={tab !== "challenge"}
        aria-labelledby="challenge"
        className="space-y-6"
      >
        {tab === "challenge" && <ChallengeSection />}
      </section>
    </main>
  );
}

/* ---------------------------------------------------
   CLASES — listar / crear / editar por fila / eliminar
---------------------------------------------------- */
function ChallengeSection() {
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const status = useSWR<{ challenge: ChallengeAdminState }>(
    "/api/admin/challenge",
    fetcher
  );
  const challenge = status.data?.challenge;
  const leaderboard = useSWR<ChallengeLeaderboard>(
    challenge?.active
      ? "/api/admin/challenge/leaderboard?page=" + page + "&pageSize=25"
      : null,
    fetcher
  );

  async function changeChallenge(method: "POST" | "DELETE") {
    if (
      !confirmChallengeLifecycleAction(
        method === "POST" ? "activate" : "deactivate",
        (message) => window.confirm(message)
      )
    ) return;

    setBusy(true);
    setNotice(null);
    setActionError(null);

    try {
      const response = await fetch("/api/admin/challenge", {
        method,
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(
          await readApiMessage(response, "No se pudo actualizar el Challenge.")
        );
      }

      setPage(1);
      setNotice(
        method === "POST"
          ? "Challenge activado correctamente."
          : "Challenge desactivado. Los puntos y el historial se conservaron."
      );
      await status.mutate();
      await leaderboard.mutate();
      window.dispatchEvent(new Event("challenge-updated"));
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "No se pudo actualizar el Challenge."
      );
    } finally {
      setBusy(false);
    }
  }

  if (status.isLoading) {
    return <Section><p className="text-sm text-muted-foreground">Cargando Challenge...</p></Section>;
  }

  if (status.error || !challenge) {
    return <Section><p className="text-sm text-red-600">No se pudo cargar el Challenge.</p></Section>;
  }

  return (
    <div className="space-y-6">
      <Section>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">CHALLENGE</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Estado actual:{" "}
              <span className={challenge.active ? "font-bold text-green-600" : "font-bold text-gray-600"}>
                {challenge.active ? "Activo" : "Inactivo"}
              </span>
            </p>
            {challenge.active && challenge.activatedAt && (
              <p className="mt-1 text-sm text-muted-foreground">
                Activado: {formatAdminDate(challenge.activatedAt)} · periodo {challenge.activationVersion}
              </p>
            )}
          </div>
          {challenge.active ? (
            <button
              className="btn-danger"
              type="button"
              disabled={busy}
              onClick={() => changeChallenge("DELETE")}
            >
              {busy ? "Desactivando..." : "Desactivar Challenge"}
            </button>
          ) : (
            <button
              className="btn-primary"
              type="button"
              disabled={busy}
              onClick={() => changeChallenge("POST")}
            >
              {busy ? "Activando..." : "Activar Challenge"}
            </button>
          )}
        </div>

        <p className="mt-5 text-sm text-muted-foreground">
          {challenge.active
            ? "Solo las clases creadas durante un periodo activo son elegibles. Inician en 1 punto y su valor se bloquea después de la primera asignación."
            : "Al activarlo se habilitan los puntos por asistencia, la configuración de puntos para clases nuevas elegibles y la visualización de puntos en perfiles."}
        </p>
        {notice && <p role="status" className="mt-4 text-sm font-medium text-green-700">{notice}</p>}
        {actionError && <p role="alert" className="mt-4 text-sm text-red-600">{actionError}</p>}
      </Section>

      {challenge.active && (
        <Section>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold">Leaderboard privado</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Usuarios registrados, ordenados de mayor a menor puntaje.
              </p>
            </div>
            <span className="text-sm text-muted-foreground">
              {leaderboard.data?.total ?? 0} usuarios
            </span>
          </div>

          {leaderboard.isLoading && <p className="mt-5 text-sm text-muted-foreground">Cargando leaderboard...</p>}
          {leaderboard.error && <p className="mt-5 text-sm text-red-600">No se pudo cargar el leaderboard.</p>}

          {leaderboard.data && (
            <>
              <div className="mt-5 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="border-b text-left">
                    <tr>
                      <th className="py-2 pr-4">Posición</th>
                      <th className="py-2 pr-4">Usuario</th>
                      <th className="py-2 pr-4">Correo</th>
                      <th className="py-2 text-right">Puntos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.data.items.map((item) => (
                      <tr key={item.id} className="border-b">
                        <td className="py-2 pr-4">#{item.rank}</td>
                        <td className="py-2 pr-4 font-medium">{item.name}</td>
                        <td className="py-2 pr-4 text-muted-foreground">{item.email}</td>
                        <td className="py-2 text-right font-bold">{item.points}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex items-center justify-between gap-3">
                <button
                  className="btn-outline"
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  Anterior
                </button>
                <span className="text-sm text-muted-foreground">
                  Página {leaderboard.data.page} de {leaderboard.data.totalPages}
                </span>
                <button
                  className="btn-outline"
                  type="button"
                  disabled={page >= leaderboard.data.totalPages}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Siguiente
                </button>
              </div>
            </>
          )}
        </Section>
      )}
    </div>
  );
}

function ClassesSection() {
  const { data, error, isLoading, mutate } = useSWR<{items: ClassItem[]}>("/api/admin/classes", fetcher);
  const { data: instructors } = useSWR<{items: Instructor[]}>("/api/admin/instructors", fetcher);
  const { data: challengeData } = useSWR<{ challenge: ChallengeAdminState }>(
    "/api/admin/challenge",
    fetcher
  );

  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState<Partial<ClassItem> & { repeatNextMonth?: boolean }>({
    durationMin: 60,
    capacity: 12,
    repeatNextMonth: false,
  });

  const filtered = useMemo(()=> {
  if (!data?.items) return [];
  const q = search.trim().toLowerCase();
  const base = data.items.filter(c => !c.isCanceled); // ← oculta canceladas
  if (!q) return base;
  return base.filter(c =>
    c.title.toLowerCase().includes(q) ||
    c.focus.toLowerCase().includes(q) ||
    (c.instructor?.name ?? "").toLowerCase().includes(q)
  );
}, [data, search]);

  async function createClass(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/admin/classes", {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify(creating), // ← incluye repeatNextMonth
    });
    setCreating({ durationMin: 60, capacity: 12, repeatNextMonth: false });
    mutate();
  }

  async function deleteClass(id: string) {
    if (!confirm("¿Eliminar clase?")) return;
    const prev = data;
    mutate({ items: data?.items.filter(i => i.id !== id) ?? [] }, { revalidate: false });
    const res = await fetch(`/api/admin/classes/${id}`, { method:"DELETE" });
    if (!res.ok) {
      mutate(prev);
      alert(await readApiMessage(res, "No se pudo eliminar la clase."));
    } else mutate();
  }

  return (
    <Section>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <h2 className="text-xl font-semibold">Clases</h2>
        <input
          className="input"
          placeholder="Buscar por título, enfoque o instructor…"
          value={search}
          onChange={e=>setSearch(e.target.value)}
        />
      </div>

      {/* Crear */}
      <form onSubmit={createClass} className="grid md:grid-cols-3 gap-3 mb-6">
        <input className="input" placeholder="Título" required
          value={creating.title ?? ""}
          onChange={e=>setCreating(f=>({...f, title:e.target.value}))}/>
        <input className="input" placeholder="Enfoque (Yoga, HIIT...)"
          value={creating.focus ?? ""}
          onChange={e=>setCreating(f=>({...f, focus:e.target.value}))}/>
        <input className="input" type="datetime-local" required
          value={creating.date ?? ""}
          onChange={e=>setCreating(f=>({...f, date:e.target.value}))}/>
        <input className="input" type="number" min={15} placeholder="Duración (min)" required
          value={creating.durationMin ?? 60}
          onChange={e=>setCreating(f=>({...f, durationMin:Number(e.target.value)}))}/>
        <input className="input" type="number" min={1} placeholder="Cupo" required
          value={creating.capacity ?? 12}
          onChange={e=>setCreating(f=>({...f, capacity:Number(e.target.value)}))}/>
        <select className="input" required
          value={creating.instructorId ?? ""}
          onChange={e=>setCreating(f=>({...f, instructorId:e.target.value}))}>
          <option value="">-- Instructor --</option>
          {instructors?.items.map(i=> <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>

        {/* ← NUEVO: check para replicar en el mes siguiente */}
        <div className="md:col-span-2">
  <label className="block text-sm mb-1">
    ¿Repetir todo el mes siguiente?
  </label>
  <select
    className="input"
    value={creating.repeatNextMonth ? "yes" : "no"}
    onChange={e =>
      setCreating(f => ({
        ...f,
        repeatNextMonth: e.target.value === "yes",
      }))
    }
  >
    <option value="no">No</option>
    <option value="yes">Sí</option>
  </select>
</div>

        <button className="btn-primary md:col-span-3">Agregar clase</button>
      </form>

      {isLoading && <p className="text-sm text-gray-500">Cargando…</p>}
      {error && <p className="text-sm text-red-600">Error cargando clases</p>}

      {/* Tabla editable */}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-left border-b">
            <tr><th>Título</th><th>Enfoque</th><th>Fecha</th><th>Dur.</th><th>Cupo</th><th>Instructor</th><th>Challenge</th><th className="text-right">Acciones</th></tr>
          </thead>
          <tbody>
            {filtered.map(c=>(
              <EditableClassRow
                key={c.id}
                item={c}
                instructors={instructors?.items ?? []}
                challengeActive={challengeData?.challenge.active === true}
                onDeleted={()=>deleteClass(c.id)}
                onSaved={()=>mutate()}
              />
            ))}
            {!isLoading && filtered.length===0 && (
              <tr><td colSpan={8} className="py-3 text-center text-gray-500">Sin resultados</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Section>
  );
}


function EditableClassRow({
  item, instructors, challengeActive, onDeleted, onSaved
}: {
  item: ClassItem; instructors: Instructor[];
  challengeActive: boolean;
  onDeleted: () => void; onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<ClassItem>>({
    title: item.title,
    focus: item.focus,
    date: toLocalDatetimeMX(item.date),
    durationMin: item.durationMin,
    capacity: item.capacity,
    instructorId: item.instructorId
  });
  const [saving, setSaving] = useState(false);
  const [challengePoints, setChallengePoints] = useState(item.challengePoints ?? 1);
  const [savingChallengePoints, setSavingChallengePoints] = useState(false);

  async function saveChallengePoints() {
    if (!Number.isInteger(challengePoints) || challengePoints < 1 || challengePoints > 10) {
      alert("Los puntos del Challenge deben ser un número entero entre 1 y 10.");
      return;
    }

    setSavingChallengePoints(true);
    const response = await fetch(`/api/admin/classes/${item.id}/challenge-points`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ points: challengePoints }),
    });
    setSavingChallengePoints(false);

    if (!response.ok) {
      alert(await readApiMessage(response, "No se pudieron guardar los puntos del Challenge."));
      return;
    }

    onSaved();
  }

  async function save() {
    setSaving(true);
    const { date, ...rest } = draft;
    const payload: any = { ...rest };
    if (date) payload.date = date; // server convierte a Date
    const res = await fetch(`/api/admin/classes/${item.id}`, {
      method:"PUT", headers:{ "Content-Type":"application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (res.ok) { setEditing(false); onSaved(); }
  }

  return (
    <tr className="border-b align-top">
      <td className="py-2">
        {editing
          ? <input className="input" value={draft.title ?? ""} onChange={e=>setDraft(d=>({...d, title:e.target.value}))}/>
          : item.title}
      </td>
      <td className="py-2">
        {editing
          ? <input className="input" value={draft.focus ?? ""} onChange={e=>setDraft(d=>({...d, focus:e.target.value}))}/>
          : item.focus}
      </td>
      <td className="py-2">
        {editing
          ? <input className="input" type="datetime-local" value={draft.date as string}
              onChange={e=>setDraft(d=>({...d, date:e.target.value}))}/>
          : new Date(item.date).toLocaleString()}
      </td>
      <td className="py-2">
        {editing
          ? <input className="input" type="number" value={draft.durationMin ?? 0}
              onChange={e=>setDraft(d=>({...d, durationMin:Number(e.target.value)}))}/>
          : item.durationMin}
      </td>
      <td className="py-2">
        {editing
          ? <input className="input" type="number" value={draft.capacity ?? 0}
              onChange={e=>setDraft(d=>({...d, capacity:Number(e.target.value)}))}/>
          : item.capacity}
      </td>
      <td className="py-2">
        {editing
          ? (
            <select className="input" value={draft.instructorId ?? ""} onChange={e=>setDraft(d=>({...d, instructorId:e.target.value}))}>
              {instructors.map(i=> <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          ) : (item.instructor?.name ?? "—")}
      </td>
      <td className="min-w-48 px-2 py-2">
        {shouldShowChallengePointControl({
          active: challengeActive,
          challengeId: item.challengeId,
          eligibleAt: item.challengeEligibleAt,
        }) ? (
          <div>
            <label className="text-xs font-semibold" htmlFor={`challenge-points-${item.id}`}>
              Puntos del Challenge
            </label>
            <div className="mt-1 flex items-center gap-2">
              <input
                id={`challenge-points-${item.id}`}
                className="input w-20"
                type="number"
                min={1}
                max={10}
                step={1}
                value={challengePoints}
                disabled={item.challengePointsLocked || savingChallengePoints}
                onChange={(event) => setChallengePoints(Number(event.target.value))}
              />
              <button
                type="button"
                className="btn-outline"
                disabled={item.challengePointsLocked || savingChallengePoints || challengePoints === item.challengePoints}
                onClick={saveChallengePoints}
              >
                {savingChallengePoints ? "Guardando..." : "Guardar"}
              </button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {item.challengePointsLocked
                ? "Valor bloqueado después de la primera asignación."
                : "Esta clase otorgará esta cantidad al confirmar asistencia."}
            </p>
          </div>
        ) : null}
      </td>
      <td className="py-2">
        <div className="flex justify-end gap-2">
          {!editing ? (
            <>
              <button className="btn-outline" onClick={()=>setEditing(true)}>Editar</button>
              <button className="btn-danger" onClick={onDeleted}>Eliminar</button>
            </>
          ) : (
            <>
              <button className="btn-primary" onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar"}</button>
              <button className="btn-ghost" onClick={()=>{
                setEditing(false);
                setDraft({
                  title: item.title, focus: item.focus, date: toLocalDatetimeMX(item.date),
                  durationMin: item.durationMin, capacity: item.capacity, instructorId: item.instructorId
                });
              }}>Cancelar</button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

/* ---------------------------------------------------
   INSTRUCTORES — listar / crear / editar por fila / eliminar
---------------------------------------------------- */
function InstructorsSection() {
  const { data, error, isLoading, mutate } = useSWR<{items: Instructor[]}>("/api/admin/instructors", fetcher);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState<{name:string; bio?:string}>({ name:"", bio:"" });

  const filtered = useMemo(()=>{
    const q = search.trim().toLowerCase();
    return (data?.items ?? []).filter(i =>
      i.name.toLowerCase().includes(q) || (i.bio ?? "").toLowerCase().includes(q)
    );
  }, [data, search]);

  async function createInstructor(e: React.FormEvent){
    e.preventDefault();
    await fetch("/api/admin/instructors",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(creating)});
    setCreating({ name:"", bio:"" });
    mutate();
  }

  async function deleteInstructor(id: string){
    if(!confirm("¿Eliminar instructor?")) return;
    const prev = data;
    mutate({ items: data?.items.filter(x=>x.id!==id) ?? [] }, { revalidate:false });
    const r = await fetch(`/api/admin/instructors/${id}`,{ method:"DELETE" });
    if (!r.ok) mutate(prev); else mutate();
  }

  return (
    <Section>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <h2 className="text-xl font-semibold">Instructores</h2>
        <input className="input" placeholder="Buscar…" value={search} onChange={e=>setSearch(e.target.value)}/>
      </div>

      <form onSubmit={createInstructor} className="grid md:grid-cols-3 gap-3 mb-6">
        <input className="input" placeholder="Nombre" required value={creating.name} onChange={e=>setCreating(f=>({...f, name:e.target.value}))}/>
        <input className="input md:col-span-2" placeholder="Bio" value={creating.bio} onChange={e=>setCreating(f=>({...f, bio:e.target.value}))}/>
        <button className="btn-primary md:col-span-3">Agregar instructor</button>
      </form>

      {isLoading && <p className="text-sm text-gray-500">Cargando…</p>}
      {error && <p className="text-sm text-red-600">Error cargando instructores</p>}

      <ul className="space-y-3">
        {filtered.map(i=>(
          <EditableInstructorRow key={i.id} item={i} onSaved={()=>mutate()} onDeleted={()=>deleteInstructor(i.id)} />
        ))}
        {!isLoading && filtered.length===0 && <li className="text-center text-gray-500">Sin resultados</li>}
      </ul>
    </Section>
  );
}

function EditableInstructorRow({ item, onSaved, onDeleted }:{
  item: Instructor; onSaved: ()=>void; onDeleted: ()=>void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<Instructor>>({ name: item.name, bio: item.bio ?? "" });
  const [saving, setSaving] = useState(false);

  async function save(){
    setSaving(true);
    const res = await fetch(`/api/admin/instructors/${item.id}`,{
      method:"PUT", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(draft)
    });
    setSaving(false);
    if (res.ok) { setEditing(false); onSaved(); }
  }

  return (
    <li className="flex flex-col md:flex-row md:items-center gap-2">
      {editing ? (
        <>
          <input className="input" value={draft.name ?? ""} onChange={e=>setDraft(d=>({...d, name:e.target.value}))}/>
          <input className="input flex-1" value={draft.bio ?? ""} onChange={e=>setDraft(d=>({...d, bio:e.target.value}))}/>
          <div className="flex gap-2">
            <button className="btn-primary" onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar"}</button>
            <button className="btn-ghost" onClick={()=>{ setEditing(false); setDraft({ name:item.name, bio:item.bio ?? "" }); }}>Cancelar</button>
            <button className="btn-danger" onClick={onDeleted}>Eliminar</button>
          </div>
        </>
      ) : (
        <>
          <div className="font-medium">{item.name}</div>
          <div className="text-sm text-gray-600 flex-1">{item.bio || "—"}</div>
          <div className="flex gap-2">
            <button className="btn-outline" onClick={()=>setEditing(true)}>Editar</button>
            <button className="btn-danger" onClick={onDeleted}>Eliminar</button>
          </div>
        </>
      )}
    </li>
  );
}

/* ---------------------------------------------------
   PAQUETES — listar / crear / editar por fila / eliminar
---------------------------------------------------- */
function PacksSection() {
  const { data, error, isLoading, mutate } = useSWR<{ items: Pack[] }>("/api/admin/packs", fetcher);
  const [search, setSearch] = useState("");

  // helper de tipo para evitar comparaciones problemáticas
  type HighlightOpt = "popular" | "best";
  const isHighlight = (v: unknown): v is HighlightOpt => v === "popular" || v === "best";

  // Estado del formulario de creación (separado del tipo Pack para no pelear con Json/enum)
  const [creating, setCreating] = useState<{
    name: string;
    classes?: number;
    price?: number;           // entero en pesos; si usas centavos cambia en el API
    validityDays?: number;
    isActive: boolean;
    oncePerUser?: boolean; // 👈 NUEVO
    classesLabel?: string;
    highlight?: "" | HighlightOpt; // "" = sin highlight
    descriptionText?: string; // textarea; se transforma a string[]
  }>({ isActive: true, name: "" });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.items ?? []).filter((p) => {
      const inName = p.name.toLowerCase().includes(q);
      const inClasses = String(p.classes).includes(q);
      const inPrice = String(p.price).includes(q);
      const inLabel = (p.classesLabel ?? "").toLowerCase().includes(q);
      const inHighlight = (p.highlight ?? "").toString().toLowerCase().includes(q);
      return inName || inClasses || inPrice || inLabel || inHighlight;
    });
  }, [data, search]);

  function toLines(s?: string) {
    return (s ?? "")
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);
  }

  async function createPack(e: React.FormEvent) {
    e.preventDefault();

    // Construye payload limpio (sin undefineds)
    const payload: any = {
  name: creating.name?.trim(),
  classes: creating.classes,
  price: creating.price,
  validityDays: creating.validityDays,
  isActive: !!creating.isActive,
  oncePerUser: !!creating.oncePerUser, // 👈 NUEVO
  classesLabel: creating.classesLabel?.trim() || undefined,
  highlight: isHighlight(creating.highlight) ? creating.highlight : undefined,
  description: toLines(creating.descriptionText),
};


    // elimina undefined para no romper validaciones
    Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

    const r = await fetch("/api/admin/packs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      // credentials: "include", // descomenta si tu auth está en cookie cross-subdomain
    });

    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      alert(`No se pudo crear: ${err.error ?? r.status}`);
      return;
    }

    setCreating({ isActive: true, name: "" });
    mutate();
  }

  async function deletePack(id: string) {
    if (!confirm("¿Eliminar paquete?")) return;
    const prev = data;
    mutate({ items: data?.items.filter((x) => x.id !== id) ?? [] }, { revalidate: false });
    const r = await fetch(`/api/admin/packs/${id}`, { method: "DELETE" });
    if (!r.ok) mutate(prev);
    else mutate();
  }

  return (
    <Section>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <h2 className="text-xl font-semibold">Paquetes</h2>
        <input
          className="input"
          placeholder="Buscar por nombre, precio, label…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Crear */}
      <form onSubmit={createPack} className="grid md:grid-cols-5 gap-3 mb-6">
        <input
          className="input"
          placeholder="Nombre"
          required
          value={creating.name}
          onChange={(e) => setCreating((f) => ({ ...f, name: e.target.value }))}
        />

        <input
          className="input"
          type="number"
          placeholder="# clases"
          required
          min={1}
          step={1}
          value={creating.classes ?? ""}
          onChange={(e) =>
            setCreating((f) => ({
              ...f,
              classes: e.target.value === "" ? undefined : Number(e.target.value),
            }))
          }
        />

        <input
          className="input"
          type="number"
          placeholder="Precio (entero)"
          required
          min={0}
          step={1}
          value={creating.price ?? ""}
          onChange={(e) =>
            setCreating((f) => ({
              ...f,
              price: e.target.value === "" ? undefined : Number(e.target.value),
            }))
          }
        />

        <input
          className="input"
          type="number"
          placeholder="Vigencia (días)"
          required
          min={1}
          step={1}
          value={creating.validityDays ?? ""}
          onChange={(e) =>
            setCreating((f) => ({
              ...f,
              validityDays: e.target.value === "" ? undefined : Number(e.target.value),
            }))
          }
        />
     <label className="inline-flex items-center gap-2">
  <input
    type="checkbox"
    checked={!!creating.oncePerUser}
    onChange={(e) =>
      setCreating((f) => ({
        ...f,
        oncePerUser: e.target.checked,
      }))
    }
  />
  Solo una vez por usuario
</label>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={!!creating.isActive}
            onChange={(e) => setCreating((f) => ({ ...f, isActive: e.target.checked }))}
          />
          Activo
        </label>
   


        {/* Nueva fila: classesLabel y highlight */}
        <input
          className="input"
          placeholder="Etiqueta clases (ej. '5 clases')"
          value={creating.classesLabel ?? ""}
          onChange={(e) => setCreating((f) => ({ ...f, classesLabel: e.target.value }))}
        />

      

        {/* Descripción multilinea (ocupa toda la fila) */}
        <textarea
          className="input md:col-span-5"
          placeholder="Descripción (una línea por bullet)"
          value={creating.descriptionText ?? ""}
          onChange={(e) => setCreating((f) => ({ ...f, descriptionText: e.target.value }))}
          rows={3}
        />

        <button className="btn-primary md:col-span-5">Crear paquete</button>
      </form>

      {isLoading && <p className="text-sm text-gray-500">Cargando…</p>}
      {error && <p className="text-sm text-red-600">Error cargando paquetes</p>}

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-left border-b">
            <tr>
              <th>Nombre</th>
              <th>#Clases</th>
              <th>Precio</th>
              <th>Vigencia</th>
              <th>Activo</th>
              <th className="text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <EditablePackRow
                key={p.id}
                item={p}
                onSaved={() => mutate()}
                onDeleted={() => deletePack(p.id)}
              />
            ))}
            {!isLoading && filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="py-3 text-center text-gray-500">
                  Sin resultados
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function EditablePackRow({
  item,
  onSaved,
  onDeleted,
}: {
  item: Pack;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(true); // abre avanzado por defecto al editar

  // helper de tipo (mismo que arriba)
  type HighlightOpt = "popular" | "best";
  const isHighlight = (v: unknown): v is HighlightOpt => v === "popular" || v === "best";

  // Normaliza la description del item a textarea (líneas)
  const initialDescriptionText = Array.isArray(item.description)
    ? (item.description as string[]).join("\n")
    : "";

  const [draft, setDraft] = useState<{
    name?: string;
    classes?: number;
    price?: number; // entero (pesos)
    validityDays?: number;
    isActive?: boolean;
    oncePerUser?: boolean; // 👈 NUEVO
    classesLabel?: string | null;
    highlight?: "" | HighlightOpt | null; // "" = sin highlight
    descriptionText?: string; // textarea → string[]
  }>({
    name: item.name,
    classes: item.classes,
    price: item.price,
    validityDays: item.validityDays,
    isActive: item.isActive,
    oncePerUser: item.oncePerUser ?? false, // 👈 NUEVO
    classesLabel: item.classesLabel ?? "",
    highlight:
      item.highlight && typeof item.highlight === "string"
        ? (item.highlight.toLowerCase() as HighlightOpt)
        : "",
    descriptionText: initialDescriptionText,
  });

  function toLines(s?: string) {
    return (s ?? "")
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);
  }

  function cleanPayload(obj: Record<string, any>) {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined) out[k] = v;
    }
    return out;
  }

  async function save() {
    setSaving(true);

    // Construir payload PATCH (solo lo que cambió o es relevante)
    const payload: any = {
      name: draft.name?.trim(),
      classes: draft.classes,
      price: draft.price, // el backend redondea a int
      validityDays: draft.validityDays,
      isActive: draft.isActive,
      oncePerUser: draft.oncePerUser, // 👈 FALTA ESTO
      classesLabel:
        draft.classesLabel === ""
          ? null // permite limpiar a null
          : draft.classesLabel?.trim(),
      highlight: isHighlight(draft.highlight) ? draft.highlight : null, // ✅ type guard
      description: toLines(draft.descriptionText),
    };

    const res = await fetch(`/api/admin/packs/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cleanPayload(payload)),
    });

    setSaving(false);
    if (res.ok) {
      setEditing(false);
      onSaved();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(`No se pudo guardar: ${err.error ?? res.status}`);
    }
  }

  return (
    <>
      <tr className="border-b align-top">
        <td className="py-2">
          {editing ? (
            <input
              className="input"
              value={draft.name ?? ""}
              onChange={(e) =>
                setDraft((d) => ({ ...d, name: e.target.value }))
              }
            />
          ) : (
            item.name
          )}
        </td>

        <td className="py-2">
          {editing ? (
            <input
              className="input"
              type="number"
              min={1}
              step={1}
              value={draft.classes ?? ""}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  classes:
                    e.target.value === "" ? undefined : Number(e.target.value),
                }))
              }
            />
          ) : (
            item.classes
          )}
        </td>

        <td className="py-2">
          {editing ? (
            <input
              className="input"
              type="number"
              min={0}
              step={1}
              value={draft.price ?? ""}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  price:
                    e.target.value === "" ? undefined : Number(e.target.value),
                }))
              }
            />
          ) : (
            `$${item.price}`
          )}
        </td>

        <td className="py-2">
          {editing ? (
            <input
              className="input"
              type="number"
              min={1}
              step={1}
              value={draft.validityDays ?? ""}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  validityDays:
                    e.target.value === ""
                      ? undefined
                      : Number(e.target.value),
                }))
              }
            />
          ) : (
            `${item.validityDays} días`
          )}
        </td>

        <td className="py-2">
          {editing ? (
            <input
              type="checkbox"
              checked={!!draft.isActive}
              onChange={(e) =>
                setDraft((d) => ({ ...d, isActive: e.target.checked }))
              }
            />
          ) : item.isActive ? (
            "Sí"
          ) : (
            "No"
          )}
        </td>

        <td className="py-2">
          <div className="flex justify-end gap-2">
            {!editing ? (
              <>
                <button
                  className="btn-outline"
                  onClick={() => {
                    setEditing(true);
                    setShowAdvanced(true);
                  }}
                >
                  Editar
                </button>
                <button className="btn-danger" onClick={onDeleted}>
                  Eliminar
                </button>
              </>
            ) : (
              <>
                <button className="btn-primary" onClick={save} disabled={saving}>
                  {saving ? "Guardando…" : "Guardar"}
                </button>
                <button
                  className="btn-ghost"
                  onClick={() => {
                    setEditing(false);
                    setDraft({
                      name: item.name,
                      classes: item.classes,
                      price: item.price,
                      validityDays: item.validityDays,
                      isActive: item.isActive,
                      classesLabel: item.classesLabel ?? "",
                      oncePerUser: item.oncePerUser ?? false,
                      highlight:
                        item.highlight && typeof item.highlight === "string"
                          ? (item.highlight.toLowerCase() as HighlightOpt)
                          : "",
                      descriptionText: initialDescriptionText,
                    });
                  }}
                >
                  Cancelar
                </button>
                <button
                  className="btn-outline"
                  onClick={() => setShowAdvanced((v) => !v)}
                >
                  {showAdvanced ? "Ocultar extras" : "Mostrar extras"}
                </button>
              </>
            )}
          </div>
        </td>
      </tr>

      {/* Panel extra para edición avanzada */}
      {editing && showAdvanced && (
        <tr className="border-b">
          <td colSpan={6} className="py-3">
            <div className="grid md:grid-cols-4 gap-3">
              <div className="md:col-span-2">
                <label className="block text-xs text-gray-500 mb-1">
                  Etiqueta de clases
                </label>
                <input
                  className="input w-full"
                  placeholder={`ej. "${draft.classes ?? ""} clases"`}
                  value={draft.classesLabel ?? ""}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, classesLabel: e.target.value }))
                  }
                />
              </div>

           
                    <div>
  <label className="block text-xs text-gray-500 mb-1">
    Restricción
  </label>

  <label className="inline-flex items-center gap-2 text-sm">
    <input
      type="checkbox"
      checked={!!draft.oncePerUser}
      onChange={(e) =>
        setDraft((d) => ({
          ...d,
          oncePerUser: e.target.checked,
        }))
      }
    />
    Solo una vez por usuario
  </label>
</div>

              <div className="md:col-span-4">
                <label className="block text-xs text-gray-500 mb-1">
                  Descripción (una línea por bullet)
                </label>
                <textarea
                  className="input w-full"
                  rows={3}
                  placeholder="- Acceso a todas las clases\n- Válido fines de semana"
                  value={draft.descriptionText ?? ""}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, descriptionText: e.target.value }))
                  }
                />
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}


function PurchasedPackagesSection() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const page = parseQueryInt(searchParams.get("pPage"), 1, 100000);
  const pageSize = parseQueryInt(
    searchParams.get("pPageSize"),
    PURCHASE_PAGE_SIZE,
    100
  );
  const q = searchParams.get("pQ") ?? "";
  const pack = searchParams.get("pPack") ?? "";
  const statusParam = searchParams.get("pStatus");
  const paymentStatus: PurchasePaymentStatusFilter =
    isPurchasePaymentStatusFilter(statusParam) ? statusParam : "ALL";
  const affiliationParam = searchParams.get("pAffiliation");
  const affiliation: Affiliation | "ALL" = isAffiliation(affiliationParam)
    ? affiliationParam
    : "ALL";
  const fromParam = searchParams.get("pFrom");
  const toParam = searchParams.get("pTo");
  const from = isDateInputValue(fromParam) ? fromParam : "";
  const to = isDateInputValue(toParam) ? toParam : "";
  const remainingParam = searchParams.get("pRemaining");
  const remaining: PurchaseRemainingFilter = isPurchaseRemainingFilter(
    remainingParam
  )
    ? remainingParam
    : "ALL";
  const sortParam = searchParams.get("pSort");
  const sort: PurchaseSort = isPurchaseSort(sortParam) ? sortParam : "newest";

  const apiParams = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (q.trim()) apiParams.set("q", q.trim());
  if (pack.trim()) apiParams.set("pack", pack.trim());
  if (paymentStatus !== "ALL") apiParams.set("paymentStatus", paymentStatus);
  if (affiliation !== "ALL") apiParams.set("affiliation", affiliation);
  if (from) apiParams.set("from", from);
  if (to) apiParams.set("to", to);
  if (remaining !== "ALL") apiParams.set("remaining", remaining);
  if (sort !== "newest") apiParams.set("sort", sort);

  const { data, error, isLoading, mutate } =
    useSWR<PaginatedPurchasedPackages>(
      `/api/admin/purchased-packages?${apiParams.toString()}`,
      fetcher
    );

  const totalPages = data?.totalPages ?? 1;
  const hasFilters =
    q.trim() ||
    pack.trim() ||
    paymentStatus !== "ALL" ||
    affiliation !== "ALL" ||
    from ||
    to ||
    remaining !== "ALL" ||
    sort !== "newest" ||
    pageSize !== PURCHASE_PAGE_SIZE;

  function updatePurchaseParams(
    next: Record<string, string | number | null | undefined>,
    options: { resetPage?: boolean; replace?: boolean } = { resetPage: true }
  ) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "purchases");

    for (const [key, value] of Object.entries(next)) {
      const param = `p${key}`;
      const isDefaultPageSize =
        key === "PageSize" && Number(value) === PURCHASE_PAGE_SIZE;
      const isDefaultSort = key === "Sort" && value === "newest";

      if (
        value == null ||
        value === "" ||
        value === "ALL" ||
        isDefaultPageSize ||
        isDefaultSort
      ) {
        params.delete(param);
      } else {
        params.set(param, String(value));
      }
    }

    if (options.resetPage !== false) {
      params.delete("pPage");
    }

    const nextUrl = `?${params.toString()}`;
    if (options.replace) {
      router.replace(nextUrl, { scroll: false });
    } else {
      router.push(nextUrl, { scroll: false });
    }
  }

  function clearPurchaseFilters() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "purchases");
    [
      "pPage",
      "pPageSize",
      "pQ",
      "pStatus",
      "pPack",
      "pAffiliation",
      "pFrom",
      "pTo",
      "pRemaining",
      "pSort",
    ].forEach((key) => params.delete(key));

    router.push(`?${params.toString()}`, { scroll: false });
  }

  return (
    <Section>
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Paquetes comprados</h2>
          <p className="text-sm text-muted-foreground">
            Ultimas compras y asignaciones registradas.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button className="btn-outline w-full md:w-auto" onClick={() => mutate()}>
            Actualizar
          </button>
          <button
            className="btn-outline w-full md:w-auto"
            onClick={clearPurchaseFilters}
            disabled={!hasFilters}
          >
            Limpiar filtros
          </button>
        </div>
      </div>

      <div className="mb-5 grid gap-3 md:grid-cols-4">
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Usuario</span>
          <input
            className="input w-full"
            placeholder="Nombre o email"
            value={q}
            onChange={(e) =>
              updatePurchaseParams(
                { Q: e.target.value },
                { resetPage: true, replace: true }
              )
            }
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Paquete</span>
          <input
            className="input w-full"
            placeholder="Nombre del paquete"
            value={pack}
            onChange={(e) =>
              updatePurchaseParams(
                { Pack: e.target.value },
                { resetPage: true, replace: true }
              )
            }
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Pago</span>
          <select
            className="input w-full"
            value={paymentStatus}
            onChange={(e) => updatePurchaseParams({ Status: e.target.value })}
          >
            {(
              Object.keys(
                PURCHASE_PAYMENT_STATUS_LABELS
              ) as PurchasePaymentStatusFilter[]
            ).map((value) => (
              <option key={value} value={value}>
                {PURCHASE_PAYMENT_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Afiliacion</span>
          <select
            className="input w-full"
            value={affiliation}
            onChange={(e) => updatePurchaseParams({ Affiliation: e.target.value })}
          >
            <option value="ALL">Todas</option>
            {(Object.keys(AFFILIATION_LABELS) as Affiliation[]).map((value) => (
              <option key={value} value={value}>
                {AFFILIATION_LABELS[value]}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Desde</span>
          <input
            className="input w-full"
            type="date"
            value={from}
            onChange={(e) => updatePurchaseParams({ From: e.target.value })}
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Hasta</span>
          <input
            className="input w-full"
            type="date"
            value={to}
            onChange={(e) => updatePurchaseParams({ To: e.target.value })}
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Restantes</span>
          <select
            className="input w-full"
            value={remaining}
            onChange={(e) => updatePurchaseParams({ Remaining: e.target.value })}
          >
            {(Object.keys(PURCHASE_REMAINING_LABELS) as PurchaseRemainingFilter[]).map(
              (value) => (
                <option key={value} value={value}>
                  {PURCHASE_REMAINING_LABELS[value]}
                </option>
              )
            )}
          </select>
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Orden</span>
          <select
            className="input w-full"
            value={sort}
            onChange={(e) => updatePurchaseParams({ Sort: e.target.value })}
          >
            <option value="newest">Mas recientes</option>
            <option value="oldest">Mas antiguas</option>
          </select>
        </label>
      </div>

      {isLoading && <p className="text-sm text-gray-500">Cargando...</p>}
      {error && (
        <p className="text-sm text-red-600">Error cargando paquetes comprados</p>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-[1200px] w-full text-sm border-collapse">
          <thead className="border-b text-left">
            <tr>
              <th>Compra</th>
              <th>Usuario</th>
              <th>Email</th>
              <th>Afiliacion</th>
              <th>Paquete</th>
              <th>Clases</th>
              <th>Restantes</th>
              <th>Monto</th>
              <th>Estado pago</th>
              <th>Proveedor / referencia</th>
              <th>Checkout</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((item) => {
              return (
                <tr key={item.id} className="border-b">
                  <td className="py-2">
                    <span className="whitespace-nowrap">
                      {formatAdminDate(item.createdAt)}
                    </span>
                  </td>
                  <td className="py-2">{item.user.name ?? "-"}</td>
                  <td className="py-2">{item.user.email}</td>
                  <td className="py-2">
                    {AFFILIATION_LABELS[item.user.affiliation]}
                  </td>
                  <td className="py-2">{item.pack.name}</td>
                  <td className="py-2">{item.classesPurchased}</td>
                  <td className="py-2">{item.classesLeft}</td>
                  <td className="py-2">{formatMoneyMXN(item.amountPaid)}</td>
                  <td className="py-2">
                    <span className="font-medium">
                      {item.paymentStatus ?? "SIN_PAGO"}
                    </span>
                  </td>
                  <td className="py-2">
                    <div className="flex max-w-[220px] flex-col">
                      <span className="text-xs text-muted-foreground">
                        {item.paymentProvider ?? "N/A"}
                      </span>
                      <span className="truncate" title={item.paymentReference ?? ""}>
                        {item.paymentReference ?? "-"}
                      </span>
                    </div>
                  </td>
                  <td className="py-2">
                    {item.checkoutStatus ?? "-"}
                  </td>
                </tr>
              );
            })}

            {!isLoading && (data?.items.length ?? 0) === 0 && (
              <tr>
                <td colSpan={11} className="py-3 text-center text-muted-foreground">
                  Sin compras registradas
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {data && (
        <div className="mt-4 flex flex-col gap-2 text-sm md:flex-row md:items-center md:justify-between">
          <p className="text-muted-foreground">
            Pagina {data.page} de {totalPages} · {data.total} registros
          </p>
          <div className="flex flex-wrap gap-2">
            <select
              className="input"
              value={pageSize}
              onChange={(e) =>
                updatePurchaseParams({ PageSize: e.target.value }, { resetPage: true })
              }
            >
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <button
              className="btn-outline"
              disabled={page <= 1}
              onClick={() =>
                updatePurchaseParams(
                  { Page: Math.max(1, page - 1) },
                  { resetPage: false }
                )
              }
            >
              Anterior
            </button>
            <button
              className="btn-outline"
              disabled={page >= totalPages}
              onClick={() =>
                updatePurchaseParams({ Page: page + 1 }, { resetPage: false })
              }
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
    </Section>
  );
}


function RevenueSection() {
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(
    now.getMonth() + 1
  ).padStart(2, "0")}`;

  const [month, setMonth] = useState(defaultMonth);

  const { data, error, isLoading, mutate } = useSWR<{
    packRevenue: number;
    appsRevenue: number;
    totalRevenue: number;
    wellhub: { count: number; revenue: number };
    totalpass: { count: number; revenue: number };
  }>(`/api/admin/revenue?month=${month}`, fetcher);

  const fmtMoney = (n?: number) =>
    typeof n === "number"
      ? n.toLocaleString("es-MX", {
          style: "currency",
          currency: "MXN",
          maximumFractionDigits: 0,
        })
      : "—";

  return (
    <Section>
      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
        <h2 className="text-xl font-semibold">Ingresos del mes</h2>

        <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
          <div className="flex flex-col text-sm">
            <label className="text-gray-600 mb-1">Mes</label>
            <input
              type="month"
              className="input"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>

          <div className="flex gap-2 mt-1 sm:mt-6">
            <button
              className="btn-outline w-full sm:w-auto"
              onClick={() => mutate()}
            >
              Actualizar
            </button>
          </div>
        </div>
      </div>

      {isLoading && (
        <p className="text-sm text-gray-500">Calculando…</p>
      )}
      {error && (
        <p className="text-sm text-red-600">
          Error cargando ingresos
        </p>
      )}

      {data && (
        <>
          {/* KPI PRINCIPAL */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 mb-6">
            <div className="rounded-xl border p-4">
              <div className="text-sm text-gray-600">
                Ingresos totales
              </div>
              <div className="text-2xl font-semibold">
                {fmtMoney(data.totalRevenue)}
              </div>
            </div>

            <div className="rounded-xl border p-4">
              <div className="text-sm text-gray-600">
                Ingresos paquetes
              </div>
              <div className="text-2xl font-semibold">
                {fmtMoney(data.packRevenue)}
              </div>
            </div>

            <div className="rounded-xl border p-4">
              <div className="text-sm text-gray-600">
                Ingresos apps
              </div>
              <div className="text-2xl font-semibold">
                {fmtMoney(data.appsRevenue)}
              </div>
            </div>
          </div>

          {/* BREAKDOWN APPS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
            <div className="rounded-xl border p-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">
                  WELLHUB
                </span>
                <span className="text-xs px-2 py-1 rounded bg-pink-100 text-pink-700">
                  {data.wellhub.count} asistencias
                </span>
              </div>
              <div className="text-xl font-semibold mt-2">
                {fmtMoney(data.wellhub.revenue)}
              </div>
            </div>

            <div className="rounded-xl border p-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">
                  TOTALPASS
                </span>
                <span className="text-xs px-2 py-1 rounded bg-green-100 text-green-700">
                  {data.totalpass.count} asistencias
                </span>
              </div>
              <div className="text-xl font-semibold mt-2">
                {fmtMoney(data.totalpass.revenue)}
              </div>
            </div>
          </div>
        </>
      )}
    </Section>
  );
}


/* 
SECCION DE USUARIOS
*/
function UserInspectorSection() {
  const [q, setQ] = useState("");
  const [userPage, setUserPage] = useState(1);
  const [userAffiliation, setUserAffiliation] = useState<Affiliation | "ALL">("ALL");
  const [userWellhubPlan, setUserWellhubPlan] = useState<WellhubPlan | "ALL">("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // admin actions
  const [tokenDelta, setTokenDelta] = useState<number>(0);
  const [adjustingTokens, setAdjustingTokens] = useState(false);

  const [selectedPackId, setSelectedPackId] = useState("");
  const [buyingPack, setBuyingPack] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [togglingBlock, setTogglingBlock] = useState(false);
  const [savingAffiliation, setSavingAffiliation] = useState(false);
  const [affiliationDraft, setAffiliationDraft] = useState<Affiliation>("NONE");
  const [wellhubPlanDraft, setWellhubPlanDraft] = useState<WellhubPlan | "">("");
  const [savingRole, setSavingRole] = useState(false);
  const [pauseDaysById, setPauseDaysById] = useState<Record<string, number>>({});
  const [pausingPackId, setPausingPackId] = useState<string | null>(null);

  // 1️⃣ últimos usuarios
  const userParams = new URLSearchParams({
    page: String(userPage),
    pageSize: String(USER_PAGE_SIZE),
  });
  if (q.trim()) userParams.set("q", q.trim());
  if (userAffiliation !== "ALL") userParams.set("affiliation", userAffiliation);
  if (userWellhubPlan !== "ALL") userParams.set("wellhubPlan", userWellhubPlan);
  const usersUrl = `/api/admin/users?${userParams.toString()}`;
  const { data: usersData, isLoading: loadingList, mutate: mutateUsers } =
    useSWR<PaginatedUsers>(usersUrl, fetcher);

  // 2️⃣ búsqueda

  // 3️⃣ detalles usuario
  const {
    data: details,
    isLoading: loadingDetails,
    error: detailsError,
    mutate,
  } = useSWR<UserDetails>(
    selectedId ? `/api/admin/users/${selectedId}/details` : null,
    fetcher
  );

  // 4️⃣ paquetes activos
  const { data: packs } = useSWR<{ items: Pack[] }>(
    "/api/admin/packs",
    fetcher
  );

  const list = usersData?.items;
  const userTotalPages = usersData?.totalPages ?? 1;

  useEffect(() => {
    if (!details?.user) return;
    setAffiliationDraft(details.user.affiliation);
    setWellhubPlanDraft(details.user.wellhubPlan ?? "");
  }, [details?.user.id, details?.user.affiliation, details?.user.wellhubPlan]);

  const affiliationSaveDisabled =
    savingAffiliation ||
    !details ||
    (affiliationDraft === details.user.affiliation &&
      (affiliationDraft === "WELLHUB" ? wellhubPlanDraft : null) ===
        (details.user.wellhubPlan ?? null));

  async function updateBookingBlocked(next: boolean) {
    if (!selectedId) return;

    setTogglingBlock(true);
    setFeedback(null);

    try {
      const res = await fetch(`/api/admin/users/${selectedId}/booking-block`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingBlocked: next }),
      });

      if (!res.ok) {
        throw new Error(
          await readApiMessage(res, "No se pudo actualizar el bloqueo.")
        );
      }

      await mutate();
      setFeedback({
        type: "success",
        text: next ? "Reservas bloqueadas." : "Reservas desbloqueadas.",
      });
    } catch (error) {
      setFeedback({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "No se pudo actualizar el bloqueo.",
      });
    } finally {
      setTogglingBlock(false);
    }
  }

  async function saveAffiliationSettings() {
    if (!selectedId || !details) return;

    const nextPlan = affiliationDraft === "WELLHUB" ? wellhubPlanDraft : null;
    const currentPlan = details.user.wellhubPlan ?? null;

    if (
      affiliationDraft === details.user.affiliation &&
      nextPlan === currentPlan
    ) {
      return;
    }

    if (affiliationDraft === "WELLHUB" && !wellhubPlanDraft) {
      setFeedback({
        type: "error",
        text: "Selecciona un plan de WellHub.",
      });
      return;
    }

    setSavingAffiliation(true);
    setFeedback(null);

    try {
      const res = await fetch(`/api/admin/users/${selectedId}/details`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          affiliation: affiliationDraft,
          wellhubPlan: nextPlan,
        }),
      });

      if (!res.ok) {
        throw new Error(
          await readApiMessage(res, "No se pudo actualizar la afiliacion.")
        );
      }

      const payload = await res.json().catch(() => null);
      const updatedBalance =
        payload &&
        typeof payload === "object" &&
        "tokenBalance" in payload &&
        typeof payload.tokenBalance === "number"
          ? payload.tokenBalance
          : null;
      const creditDelta =
        payload &&
        typeof payload === "object" &&
        "wellhubSync" in payload &&
        payload.wellhubSync &&
        typeof payload.wellhubSync === "object" &&
        "creditDeltaApplied" in payload.wellhubSync &&
        typeof payload.wellhubSync.creditDeltaApplied === "number"
          ? payload.wellhubSync.creditDeltaApplied
          : null;

      await Promise.all([mutate(), mutateUsers()]);
      setFeedback({
        type: "success",
        text:
          affiliationDraft === "NONE"
            ? `Afiliacion actualizada. Saldo: ${
                updatedBalance ?? details.tokenBalance
              } creditos. Las renovaciones corporativas futuras quedan detenidas.`
            : `Afiliacion actualizada. Saldo: ${
                updatedBalance ?? details.tokenBalance
              } creditos.${
                creditDelta != null ? ` Delta WellHub: ${creditDelta}.` : ""
              }`,
      });
    } catch (error) {
      setFeedback({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "No se pudo actualizar la afiliacion.",
      });
    } finally {
      setSavingAffiliation(false);
    }
  }

  async function updateRole(next: Role) {
    if (!selectedId || next === details?.user.role) return;

    setSavingRole(true);
    setFeedback(null);

    try {
      const res = await fetch(`/api/admin/users/${selectedId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: next }),
      });

      if (!res.ok) {
        throw new Error(await readApiMessage(res, "No se pudo actualizar el rol."));
      }

      const payload = await res.json().catch(() => null);
      await Promise.all([mutate(), mutateUsers()]);
      setFeedback({
        type: "success",
        text:
          payload && typeof payload.message === "string"
            ? payload.message
            : "Rol actualizado.",
      });
    } catch (error) {
      setFeedback({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "No se pudo actualizar el rol.",
      });
    } finally {
      setSavingRole(false);
    }
  }

  async function pausePurchase(purchaseId: string) {
    if (!selectedId) return;

    const days = pauseDaysById[purchaseId] ?? 1;
    if (!Number.isInteger(days) || days < 1 || days > 30) {
      setFeedback({
        type: "error",
        text: "La pausa debe ser de 1 a 30 dias.",
      });
      return;
    }

    setPausingPackId(purchaseId);
    setFeedback(null);

    try {
      const res = await fetch(
        `/api/admin/users/${selectedId}/packs/${purchaseId}/pause`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ days }),
        }
      );

      if (!res.ok) {
        throw new Error(await readApiMessage(res, "No se pudo pausar el paquete."));
      }

      await mutate();
      setFeedback({
        type: "success",
        text: `Paquete pausado por ${days} dia${days === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      setFeedback({
        type: "error",
        text:
          error instanceof Error ? error.message : "No se pudo pausar el paquete.",
      });
    } finally {
      setPausingPackId(null);
    }
  }

  return (
    <Section>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* LISTA */}
        <div className="md:col-span-1 space-y-3">
          <h2 className="text-xl font-semibold">Usuarios</h2>

          <input
            className="input w-full"
            placeholder="Buscar por nombre o email…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setUserPage(1);
            }}
          />

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">Afiliacion</span>
              <select
                className="input w-full"
                value={userAffiliation}
                onChange={(e) => {
                  const next = e.target.value as Affiliation | "ALL";
                  setUserAffiliation(next);
                  if (next !== "WELLHUB") setUserWellhubPlan("ALL");
                  setUserPage(1);
                }}
              >
                <option value="ALL">Todas</option>
                {(Object.keys(AFFILIATION_LABELS) as Affiliation[]).map((value) => (
                  <option key={value} value={value}>
                    {AFFILIATION_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">Plan WellHub</span>
              <select
                className="input w-full"
                value={userWellhubPlan}
                disabled={userAffiliation !== "ALL" && userAffiliation !== "WELLHUB"}
                onChange={(e) => {
                  setUserWellhubPlan(e.target.value as WellhubPlan | "ALL");
                  setUserPage(1);
                }}
              >
                <option value="ALL">Todos</option>
                {WELLHUB_PLANS.map((value) => (
                  <option key={value} value={value}>
                    {WELLHUB_PLAN_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {loadingList && (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          )}

          <div className="border rounded-[var(--radius)] overflow-hidden">
            <ul className="divide-y">
              {(list ?? []).map((u) => {
                const whatsappHref = getWhatsAppHref(
                  u.phone,
                  getAdminWhatsAppMessage(u.name)
                );

                return (
                  <li key={u.id} className="flex items-stretch gap-2 p-2">
                    <button
                      className={`min-w-0 flex-1 rounded-[var(--radius)] text-left p-2 hover:bg-[--color-muted] ${
                        selectedId === u.id ? "bg-[--color-muted]" : ""
                      }`}
                      onClick={() => {
                        setSelectedId(u.id);
                        setFeedback(null);
                        setTokenDelta(0);
                      }}
                    >
                      <div className="flex items-center gap-2 font-medium">
                        <span className="min-w-0 truncate">{u.name ?? "—"}</span>
                        {u.bookingBlocked && (
                          <span className="shrink-0 rounded bg-red-100 px-2 py-0.5 text-[11px] text-red-700">
                            Bloqueado
                          </span>
                        )}
                      </div>
                      <div className="truncate text-sm text-muted-foreground">
                        {u.email}
                      </div>
                      <div className="mt-1 text-xs font-medium text-muted-foreground">
                        {ROLE_LABELS[u.role]}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
                        <span className="rounded bg-[--color-muted] px-2 py-0.5 text-muted-foreground">
                          {AFFILIATION_LABELS[u.affiliation]}
                        </span>
                        {u.affiliation === "WELLHUB" && u.wellhubPlan && (
                          <span className="rounded bg-pink-100 px-2 py-0.5 text-pink-700">
                            {WELLHUB_PLAN_LABELS[u.wellhubPlan]}
                          </span>
                        )}
                        {!u.affiliationConfirmedAt && u.role !== "ADMIN" && (
                          <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-700">
                            Pendiente
                          </span>
                        )}
                      </div>
                    </button>

                    {whatsappHref ? (
                      <a
                        className="btn-outline h-10 self-center whitespace-nowrap px-3 text-xs"
                        href={whatsappHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={u.phone?.trim() || "WhatsApp"}
                        aria-label={`Enviar WhatsApp a ${u.name ?? u.email}`}
                      >
                        <FiMessageCircle aria-hidden="true" />
                        WhatsApp
                      </a>
                    ) : (
                      <span className="self-center whitespace-nowrap px-2 text-xs text-muted-foreground">
                        Sin telefono
                      </span>
                    )}
                  </li>
                );
              })}

              {!loadingList && (list?.length ?? 0) === 0 && (
                <li className="p-3 text-sm text-muted-foreground">
                  {q.trim() ? "Sin resultados" : "No hay usuarios"}
                </li>
              )}
            </ul>
          </div>

          {usersData && !loadingList && (
            <div className="space-y-2 text-xs text-muted-foreground">
              <p className="text-center">
                Pagina {usersData.page} de {userTotalPages} · {usersData.total} usuarios
              </p>
              <div className="flex gap-2">
                <button
                  className="btn-outline flex-1"
                  disabled={userPage <= 1}
                  onClick={() => setUserPage((current) => Math.max(1, current - 1))}
                >
                  Anterior
                </button>
                <button
                  className="btn-outline flex-1"
                  disabled={userPage >= userTotalPages}
                  onClick={() => setUserPage((current) => current + 1)}
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </div>

        {/* DETALLES */}
        <div className="md:col-span-2 space-y-6">
          {!selectedId && (
            <p className="text-sm text-muted-foreground">
              Selecciona un usuario.
            </p>
          )}

          {selectedId && loadingDetails && (
            <p className="text-sm text-muted-foreground">
              Cargando detalles…
            </p>
          )}

          {selectedId && detailsError && (
            <p className="text-sm text-red-600">
              Error al cargar datos.
            </p>
          )}

          {selectedId && details && (
            <>
              {feedback && (
                <div
                  className={`rounded-[var(--radius)] border p-3 text-sm ${
                    feedback.type === "success"
                      ? "border-green-200 bg-green-50 text-green-700"
                      : "border-red-200 bg-red-50 text-red-700"
                  }`}
                >
                  {feedback.text}
                </div>
              )}

              {/* PERFIL + TOKENS */}
              <div className="grid md:grid-cols-2 gap-4">
                <div className="p-4 border rounded-[var(--radius)]">
                  <h3 className="font-semibold mb-2">Perfil</h3>
                  <dl className="grid grid-cols-3 gap-2 text-sm">
                    <dt className="text-muted-foreground">Nombre</dt>
                    <dd className="col-span-2">{details.user.name ?? "—"}</dd>

                    <dt className="text-muted-foreground">Email</dt>
                    <dd className="col-span-2">{details.user.email}</dd>

                    <dt className="text-muted-foreground">Rol</dt>
                    <dd className="col-span-2 space-y-1">
                      <select
                        className="input w-full"
                        value={details.user.role}
                        disabled={savingRole}
                        onChange={(e) => updateRole(e.target.value as Role)}
                      >
                        {(Object.keys(ROLE_LABELS) as Role[]).map((value) => (
                          <option key={value} value={value}>
                            {ROLE_LABELS[value]}
                          </option>
                        ))}
                      </select>
                    </dd>

                    <dt className="text-muted-foreground">Afiliación</dt>
                    <dd className="col-span-2 space-y-1">
                      <select
                        className="input w-full"
                        value={affiliationDraft}
                        disabled={savingAffiliation}
                        onChange={(e) => {
                          const next = e.target.value as Affiliation;
                          setAffiliationDraft(next);
                          if (next !== "WELLHUB") setWellhubPlanDraft("");
                        }}
                      >
                        {(Object.keys(AFFILIATION_LABELS) as Affiliation[]).map(
                          (value) => (
                            <option key={value} value={value}>
                              {AFFILIATION_LABELS[value]}
                            </option>
                          )
                        )}
                      </select>
                      {affiliationDraft === "WELLHUB" && (
                        <select
                          className="input w-full"
                          value={wellhubPlanDraft}
                          disabled={savingAffiliation}
                          onChange={(e) =>
                            setWellhubPlanDraft(e.target.value as WellhubPlan)
                          }
                        >
                          <option value="">Selecciona plan</option>
                          {WELLHUB_PLANS.map(
                            (value) => (
                              <option key={value} value={value}>
                                {WELLHUB_PLAN_LABELS[value]} -{" "}
                                {WELLHUB_PLAN_CREDITS[value]} creditos
                              </option>
                            )
                          )}
                        </select>
                      )}
                      {details.user.affiliation === "WELLHUB" &&
                        details.user.wellhubPlan && (
                          <p className="text-xs text-muted-foreground">
                            Plan actual: {WELLHUB_PLAN_LABELS[details.user.wellhubPlan]}.
                          </p>
                        )}
                      <button
                        type="button"
                        className="btn btn-outline w-full"
                        disabled={affiliationSaveDisabled}
                        onClick={saveAffiliationSettings}
                      >
                        {savingAffiliation ? "Guardando..." : "Guardar afiliacion"}
                      </button>
                      <p className="text-xs text-muted-foreground">
                        Ninguna detiene renovaciones corporativas futuras.
                      </p>
                    </dd>

                    <dt className="text-muted-foreground">Alta</dt>
                    <dd className="col-span-2">
                      {new Date(details.user.createdAt).toLocaleString()}
                    </dd>
                  </dl>
                </div>

                <div className="p-4 border rounded-[var(--radius)] space-y-3">
  <h3 className="font-semibold">Saldo de tokens</h3>

  <p className="text-3xl font-bold">
    {details.tokenBalance}
  </p>

  {/* Controles +/- */}
  <div className="flex items-center gap-2">
    <button
      type="button"
      className="btn btn-outline px-3"
      onClick={() => setTokenDelta((d) => d - 1)}
      disabled={adjustingTokens}
    >
      −
    </button>

    <input
      type="number"
      className="input w-24 text-center"
      value={tokenDelta}
      onChange={(e) => setTokenDelta(Number(e.target.value))}
    />

    <button
      type="button"
      className="btn btn-outline px-3"
      onClick={() => setTokenDelta((d) => d + 1)}
      disabled={adjustingTokens}
    >
      +
    </button>
  </div>

  {/* Preview saldo */}
  {tokenDelta !== 0 && (
    <p className="text-sm">
      Saldo resultante:{" "}
      <span
        className={
          details.tokenBalance + tokenDelta < 0
            ? "text-red-600 font-medium"
            : "font-medium"
        }
      >
        {details.tokenBalance + tokenDelta}
      </span>
    </p>
  )}

  {details.tokenBalance + tokenDelta < 0 && (
    <p className="text-xs text-red-600">
      El saldo no puede quedar negativo.
    </p>
  )}

  <button
    className="btn btn-primary w-full"
    disabled={
      tokenDelta === 0 ||
      adjustingTokens ||
      details.tokenBalance + tokenDelta < 0
    }
    onClick={async () => {
      setAdjustingTokens(true);
      try {
        await fetch(
          `/api/admin/users/${selectedId}/tokens`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              delta: tokenDelta,
              reason: "ADMIN_ADJUST",
            }),
          }
        );
        setTokenDelta(0);
        mutate();
      } finally {
        setAdjustingTokens(false);
      }
    }}
  >
    Aplicar ajuste
  </button>

  <p className="text-xs text-muted-foreground">
    Ajuste manual: los botones + / − suman o restan tokens al saldo actual.
    No modifica paquetes existentes.
  </p>
</div>


              </div>

              {/* BLOQUEAR RESERVAS */}
              <div className="p-4 border rounded-[var(--radius)] space-y-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="font-semibold">Reservas</h3>
                    <p
                      className="text-sm text-muted-foreground"
                      title="Bloquea reservas por cancelacion tardia o falta a clase."
                    >
                      Bloquear reservas:{" "}
                      <span className="font-semibold">
                        {details.user.bookingBlocked ? "SI" : "NO"}
                      </span>
                    </p>
                  </div>

                  <label className="inline-flex cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={details.user.bookingBlocked}
                      disabled={togglingBlock}
                      onChange={(e) => updateBookingBlocked(e.target.checked)}
                    />
                    <span className="relative h-7 w-12 rounded-full bg-gray-300 transition peer-checked:bg-red-600 after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-5" />
                    <span className="text-sm font-medium">
                      {togglingBlock ? "Guardando..." : details.user.bookingBlocked ? "SI" : "NO"}
                    </span>
                  </label>
                </div>

                {details.user.bookingBlocked && (
                  <p className="text-xs text-red-600">
                    Bloqueado desde {formatAdminDate(details.user.bookingBlockedAt)}
                  </p>
                )}

                {(details.user.bookingBlockLogs?.length ?? 0) > 0 && (
                  <div className="border-t pt-3">
                    <p className="mb-2 text-xs font-semibold text-muted-foreground">
                      Historial reciente
                    </p>
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {details.user.bookingBlockLogs?.map((log) => (
                        <li key={log.id}>
                          {log.blocked ? "Bloqueado" : "Desbloqueado"} -{" "}
                          {formatAdminDate(log.createdAt)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* ASIGNAR PAQUETE */}
              <div className="p-4 border rounded-[var(--radius)] space-y-3">
                <h3 className="font-semibold">Asignar paquete</h3>

                <div className="flex gap-2">
                  <select
                    className="input w-full"
                    value={selectedPackId}
                    onChange={(e) =>
                      setSelectedPackId(e.target.value)
                    }
                  >
                    <option value="">
                      Selecciona un paquete…
                    </option>
                    {(packs?.items ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {p.classes} clases
                      </option>
                    ))}
                  </select>

                  <button
                    className="btn btn-primary"
                    disabled={!selectedPackId || buyingPack}
                    onClick={async () => {
                      setBuyingPack(true);
                      try {
                        await fetch(
                          `/api/admin/users/${selectedId}/packs`,
                          {
                            method: "POST",
                            headers: {
                              "Content-Type": "application/json",
                            },
                            body: JSON.stringify({
                              packId: selectedPackId,
                            }),
                          }
                        );
                        setSelectedPackId("");
                        mutate();
                      } finally {
                        setBuyingPack(false);
                      }
                    }}
                  >
                    Asignar
                  </button>
                </div>

                <p className="text-xs text-muted-foreground">
                  Crea una compra y acredita tokens automáticamente.
                </p>
              </div>

              {/* PAQUETES COMPRADOS */}
              <div className="p-4 border rounded-[var(--radius)]">
  <h3 className="font-semibold mb-3">Paquetes</h3>

  <div className="overflow-x-auto">
    <table className="min-w-[900px] w-full text-sm border-collapse">
      <thead className="border-b border-[var(--color-border)] text-left">
        <tr>
          <th>Paquete</th>
          <th>Restantes</th>
          <th>Vence</th>
          <th>Estado</th>
          <th>Pausar</th>
        </tr>
      </thead>
      <tbody>
        {details.purchases.map((p) => {
          const pausedUntilDate = p.pausedUntil ? new Date(p.pausedUntil) : null;
          const isPaused =
            !!pausedUntilDate && pausedUntilDate.getTime() > Date.now();
          const isExpired = new Date(p.expiresAt).getTime() <= Date.now();
          const pauseDays = pauseDaysById[p.id] ?? 1;

          return (
            <tr key={p.id} className="border-b border-[var(--color-border)]">
              <td className="py-2">{p.pack.name}</td>
              <td className="py-2">{p.classesLeft}</td>
              <td className="py-2">
                <span className="whitespace-nowrap">
                  {new Date(p.expiresAt).toLocaleDateString()}
                </span>
              </td>
              <td className="py-2">
                {isPaused ? (
                  <span className="rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
                    Pausado hasta {pausedUntilDate?.toLocaleDateString()}
                  </span>
                ) : isExpired ? (
                  <span className="text-xs font-medium text-red-600">
                    Expirado
                  </span>
                ) : (
                  <span className="text-xs font-medium text-green-600">
                    Activo
                  </span>
                )}
                {p.pausedDays > 0 && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {p.pausedDays} dia{p.pausedDays === 1 ? "" : "s"} pausados
                  </div>
                )}
              </td>
              <td className="py-2">
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={30}
                    className="input w-20"
                    value={pauseDays}
                    onChange={(e) =>
                      setPauseDaysById((current) => ({
                        ...current,
                        [p.id]: Number(e.target.value),
                      }))
                    }
                    disabled={pausingPackId === p.id}
                  />
                  <button
                    className="btn btn-outline whitespace-nowrap"
                    disabled={
                      pausingPackId === p.id || pauseDays < 1 || pauseDays > 30
                    }
                    onClick={() => pausePurchase(p.id)}
                  >
                    {pausingPackId === p.id ? "Pausando..." : "Pausar paquete"}
                  </button>
                </div>
              </td>
            </tr>
          );
        })}

        {details.purchases.length === 0 && (
          <tr>
            <td
              colSpan={5}
              className="py-3 text-center text-muted-foreground"
            >
              Sin paquetes
            </td>
          </tr>
        )}
      </tbody>
    </table>
  </div>
</div>

              {/* HISTORIAL DE CREDITOS */}
              <div className="p-4 border rounded-[var(--radius)]">
                <h3 className="font-semibold mb-3">Historial de creditos</h3>

                <div className="overflow-x-auto">
                  <table className="min-w-[900px] w-full text-sm border-collapse">
                    <thead className="border-b text-left">
                      <tr>
                        <th>Fecha</th>
                        <th>Motivo</th>
                        <th>Delta</th>
                        <th>Detalle</th>
                        <th>Saldo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {details.creditHistory.map((entry) => {
                        const metadata = entry.metadata ?? {};
                        const resultingBalance = metadataNumber(
                          metadata.resultingAvailableBalance
                        );
                        const previousEntitlement = metadataNumber(
                          metadata.previousMonthlyEntitlement
                        );
                        const newEntitlement = metadataNumber(
                          metadata.newMonthlyEntitlement
                        );
                        const actorId = metadataText(metadata.adminActorId);
                        const isWellhubChange =
                          entry.reason === "ADMIN_WELLHUB_PLAN_CHANGE";
                        const deltaText =
                          entry.delta > 0 ? `+${entry.delta}` : String(entry.delta);

                        return (
                          <tr key={entry.id} className="border-b align-top">
                            <td className="py-2 whitespace-nowrap">
                              {formatAdminDate(entry.createdAt)}
                            </td>
                            <td className="py-2">
                              {formatCreditReason(entry.reason)}
                            </td>
                            <td
                              className={`py-2 font-medium ${
                                entry.delta < 0
                                  ? "text-red-600"
                                  : entry.delta > 0
                                    ? "text-green-600"
                                    : ""
                              }`}
                            >
                              {deltaText}
                            </td>
                            <td className="py-2">
                              {isWellhubChange ? (
                                <div className="space-y-1">
                                  <div>
                                    {metadataText(metadata.previousAffiliation)} /{" "}
                                    {metadataText(metadata.previousWellhubPlan)} {"->"}{" "}
                                    {metadataText(metadata.newAffiliation)} /{" "}
                                    {metadataText(metadata.newWellhubPlan)}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    Entitlement: {previousEntitlement ?? 0} {"->"}{" "}
                                    {newEntitlement ?? 0} - Actor: {actorId} - Ciclo:{" "}
                                    {metadataText(metadata.cycleId)}
                                  </div>
                                </div>
                              ) : entry.packPurchase?.pack?.name ? (
                                entry.packPurchase.pack.name
                              ) : entry.booking?.class?.title ? (
                                entry.booking.class.title
                              ) : (
                                "Sin referencia"
                              )}
                            </td>
                            <td className="py-2">
                              {resultingBalance != null ? resultingBalance : "-"}
                            </td>
                          </tr>
                        );
                      })}

                      {details.creditHistory.length === 0 && (
                        <tr>
                          <td
                            colSpan={5}
                            className="py-3 text-center text-muted-foreground"
                          >
                            Sin historial
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              
              {/* RESERVAS */}
<div className="p-4 border rounded-[var(--radius)]">
  <h3 className="font-semibold mb-3">Reservas</h3>

  <div className="overflow-x-auto">
    <table className="min-w-[800px] w-full text-sm border-collapse">
      <thead className="border-b text-left">
        <tr>
          <th>Reservado</th>
          <th>Clase</th>
          <th>Fecha clase</th>
          <th>Instructor</th>
          <th>Estado</th>
          <th>Cantidad</th>
        </tr>
      </thead>

      <tbody>
        {details.bookings.map((b) => (
          <tr key={b.id} className="border-b">
            <td className="py-2">
              <span className="whitespace-nowrap">
  {new Date(b.createdAt).toLocaleString()}
</span>

            </td>

            <td className="py-2">{b.class.title}</td>

            <td className="py-2">
              <span className="whitespace-nowrap">
  {new Date(b.class.date).toLocaleString()}
</span>

            </td>

            <td className="py-2">
              {b.class.instructor?.name ?? "—"}
            </td>

            <td className="py-2">
              <span
                className={
                  b.status === "ACTIVE"
                    ? "text-green-600 font-medium"
                    : "text-red-600 font-medium"
                }
              >
                {b.status}
              </span>
            </td>

            <td className="py-2 text-center">{b.quantity}</td>

            
          </tr>
        ))}

        {details.bookings.length === 0 && (
          <tr>
            <td
              colSpan={7}
              className="py-3 text-center text-muted-foreground"
            >
              Sin reservas
            </td>
          </tr>
        )}
      </tbody>
    </table>
  </div>
</div>


            </>
          )}
        </div>
      </div>
    </Section>
  );
}
