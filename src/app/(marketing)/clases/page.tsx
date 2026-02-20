// src/app/(marketing)/clases/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { motion, cubicBezier, type Variants } from "framer-motion";
import { FiClock, FiUser } from "react-icons/fi";
import { useRouter } from "next/navigation";

const EASE = cubicBezier(0.22, 1, 0.36, 1);
const MX_TZ = "America/Mexico_City";
const MX_LOCALE: Intl.LocalesArgument = "es-MX";



type ApiSession = {
  id: string;
  title: string;
  focus?: string | null;
  coach: string;
  startsAt: string; // ISO
  durationMin: number;
  capacity?: number | null;
  booked?: number | null;
  isFull?: boolean | null;
  isCanceled?: boolean;
  userHasBooking?: boolean;
  bookingId?: string;
};

type Session = {
  id: string;
  title: string;
  focus?: string;
  time: string;
  coach: string;
  duration: string;
  isCanceled?: boolean;
  status?: "BOOK" | "FULL" | "CANCELLED";
  startsAtISO: string;
  capacity?: number | null;
  booked?: number | null;
  spots: number; // calculado
  userHasBooking?: boolean;
  bookingId?: string;

};

type Day = {
  id: string;
  dow: "LUN" | "MAR" | "MIÉ" | "JUE" | "VIE" | "SÁB" | "DOM";
  dateLabel: string; // "01 ABR"
  dateKey: string;   // YYYY-MM-DD en MX
  sessions: Session[];
};

const colVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, delay: 0.04 * i, ease: EASE },
  }),
};

const cardVariants: Variants = {
  hidden: { opacity: 0, scale: 0.98 },
  show: { opacity: 1, scale: 1, transition: { duration: 0.3, ease: EASE } },
};

// ---------- Helpers de fecha/hora ----------
function fmtTimeMX(iso: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(MX_LOCALE, {
    timeZone: MX_TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

/**
 * Construye "hoy 00:00" en México *con offset correcto* (maneja DST).
 * Devuelve un Date cuyo instante corresponde exactamente a 00:00 en CDMX.
 */
function startOfTodayInMX(): Date {
  // 1) Partes de fecha en MX
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MX_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(new Date())
    .reduce<Record<string, string>>((acc, p) => {
      if (p.type === "year" || p.type === "month" || p.type === "day") acc[p.type] = p.value;
      return acc;
    }, {});

  const y = parts.year;
  const m = parts.month;
  const d = parts.day;

  // 2) Offset corto de MX para HOY (e.g., "UTC-6" o "UTC-5")
  const tzParts = new Intl.DateTimeFormat("en-US", {
    timeZone: MX_TZ,
    timeZoneName: "shortOffset",
    hour: "2-digit",
  })
    .formatToParts(new Date())
    .find((p) => p.type === "timeZoneName")?.value ?? "UTC-06";

  // Normaliza a ±HH:MM
  const mOffset = tzParts.match(/([+-]\d{1,2})/);
  const hh = mOffset ? String(Math.abs(parseInt(mOffset[1], 10))).padStart(2, "0") : "06";
  const sign = mOffset && parseInt(mOffset[1], 10) >= 0 ? "+" : "-";
  const offset = `${sign}${hh}:00`;

  // 3) ISO local de MX a medianoche con offset correcto
  const isoLocal = `${y}-${m}-${d}T00:00:00${offset}`;
  return new Date(isoLocal);
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function getDOWAbbr(d: Date): Day["dow"] {
  const wd = new Intl.DateTimeFormat("es", { weekday: "short", timeZone: MX_TZ })
    .format(d)
    .toUpperCase()
    .replace(".", "");
  const map: Record<string, Day["dow"]> = {
    LUN: "LUN",
    MAR: "MAR",
    MIÉ: "MIÉ",
    MIE: "MIÉ",
    JUE: "JUE",
    VIE: "VIE",
    SÁB: "SÁB",
    SAB: "SÁB",
    DOM: "DOM",
  };
  return map[wd] ?? "DOM";
}

function fmtDayLabel(d: Date) {
  const day = new Intl.DateTimeFormat(MX_LOCALE, { timeZone: MX_TZ, day: "2-digit" }).format(d);
  const mon = new Intl.DateTimeFormat(MX_LOCALE, { timeZone: MX_TZ, month: "short" })
    .format(d)
    .toUpperCase()
    .replace(".", "");
  return `${day} ${mon}`;
}

/** YYYY-MM-DD del día en MX (clave de agrupación) */
function ymdKey(d: Date) {
  const [dd, mm, yyyy] = new Intl.DateTimeFormat("es-MX", {
    timeZone: MX_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
    .format(d)
    .split("/");
  return `${yyyy}-${mm}-${dd}`;
}

function buildEmptyDays(from: Date, count: number): Day[] {
  return Array.from({ length: count }).map((_, i) => {
    const d = addDays(from, i);
    return {
      id: ymdKey(d),
      dow: getDOWAbbr(d),
      dateLabel: fmtDayLabel(d),
      dateKey: ymdKey(d),
      sessions: [],
    };
  });
}

// ---------- Mapeo de API a UI ----------
function toSession(api: ApiSession): Session {
  const isCancelled = api.isCanceled === true;

  const full =
    !!api.isFull ||
    (!!api.capacity &&
      typeof api.booked === "number" &&
      api.booked >= api.capacity);

  const capacity = typeof api.capacity === "number" ? api.capacity : null;
  const booked = typeof api.booked === "number" ? api.booked : 0;
  const spots = capacity != null ? Math.max(0, capacity - booked) : 0;

  return {
    id: api.id,
    title: api.title,
    focus: api.focus ?? undefined,
    coach: api.coach,
    time: fmtTimeMX(api.startsAt),
    duration: `${api.durationMin}MIN`,
    status: isCancelled
      ? "CANCELLED"
      : full
      ? "FULL"
      : undefined,
    isCanceled: isCancelled,
    startsAtISO: api.startsAt,
    capacity,
    booked,
    spots,
    userHasBooking: api.userHasBooking ?? false,
    bookingId: api.bookingId ?? undefined,

  };
}


// ---------- Reserva: Modal sencillo ----------
function useIsomorphicLayoutEffect(effect: any, deps: any[]) {
  const useEff = typeof window !== "undefined" ? useEffect : () => {};
  // @ts-ignore
  return useEff(effect, deps);
}

type ReserveMenuProps = {
  open: boolean;
  onClose: () => void;
  session: Session | null;
  tokens: number;
  affiliation: string | null; // 👈 NUEVO
  onBooked: (qty: number, bookingId: string) => void;  // para actualizar tokens localmente
};

function ReserveMenu({ open, onClose, session, tokens, onBooked, affiliation }: ReserveMenuProps) {
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const isCorporate =
  affiliation === "WELLHUB" ||
  affiliation === "TOTALPASS";

  const maxBySpots = session?.spots ?? 0;
  const baseMax = Math.max(0, Math.min(maxBySpots, tokens));
  const max = isCorporate ? Math.min(1, baseMax) : baseMax;


  useIsomorphicLayoutEffect(() => {
    if (open) {
      setQty(Math.min(1, max));
      setErr(null);
    }
  }, [open]);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!open || !mounted) return null;

  const canConfirm = session && qty >= 1 && qty <= max && !busy;

  async function confirm() {
  if (!session) return;
  if (!canConfirm) return;

  try {
    setBusy(true);
    setErr(null);

    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId: session.id, quantity: qty }),
    });

    // ✅ Si falla, intenta leer el JSON y tomar el campo "error"
    if (!res.ok) {
      let msg = `No se pudo confirmar la reserva (HTTP ${res.status})`;
      try {
        const data = await res.json();
        if (data?.error) msg = data.error;
      } catch {
        // Si no es JSON, intenta leer texto plano
        const text = await res.text();
        if (text) msg = text;
      }
      throw new Error(msg);
    }

    // ✅ Si todo ok
    const data = await res.json();

    onBooked(qty, data.bookingId);
    if (typeof data.tokens === "number") {
      // onBooked ya descontó; podrías sincronizar saldo exacto si lo deseas
    }
    onClose();
  } catch (e: any) {
    setErr(e?.message || "Error al reservar.");
  } finally {
    setBusy(false);
  }
}
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* panel */}
      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1, transition: { duration: 0.25, ease: EASE } }}
        className="relative w-full md:w-[520px] rounded-t-2xl md:rounded-2xl bg-[color:var(--color-card)] p-4 md:p-5 shadow-xl"
      >
        <div className="flex items-center gap-2">
          <h3 className="font-display text-lg font-bold">Reservar</h3>
          <button className="ml-auto btn-outline h-8 px-3" onClick={onClose}>
            Cerrar
          </button>
        </div>

        {session && (
          <>
            <div className="mt-3 space-y-1">
              <div className="font-semibold">{session.title}</div>
              <div className="text-sm text-muted-foreground">
                {session.time} • {session.duration} • {session.coach}
              </div>
              <div className="text-sm">
                <span className="font-semibold">Spots disponibles:</span>{" "}
                {session.spots}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="card p-3">
                <div className="text-xs text-muted-foreground">Tus clases</div>
                <div className="mt-1 text-2xl font-extrabold">{tokens}</div>
              </div>

              <div className="card p-3">
                <div className="text-xs text-muted-foreground">Cantidad a reservar</div>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    className="btn-outline h-9 px-3"
                    onClick={() => setQty((q) => Math.max(1, q - 1))}
                    disabled={qty <= 1 || busy}
                  >
                    −
                  </button>
                  <input
  type="number"
  min={1}
  max={max || 1}
  value={qty}
  disabled={isCorporate}
  onChange={(e) =>
    setQty(() => {
      const v = Number(e.target.value || 1);
      return Math.max(1, Math.min(max || 1, v));
    })
  }
  className="input h-9 w-20 text-center"
/>

                  <button
  className="btn-outline h-9 px-3"
  onClick={() => setQty((q) => Math.min(max, q + 1))}
  disabled={qty >= max || busy || isCorporate}
>
  +
</button>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  Máx. permitido por disponibilidad y saldo: <b>{max}</b>
                </div>
              </div>
              {isCorporate && (
  <div className="mt-2 text-xs text-muted-foreground">
    Usuarios Wellhub y TotalPass solo pueden reservar 1 lugar.
  </div>
)}

            </div>

            {err && <div className="mt-3 text-sm text-red-600">{err}</div>}

            <div className="mt-5 flex gap-2">
              <button className="btn-outline h-10 px-4" onClick={onClose} disabled={busy}>
                Cancelar
              </button>
              <button
                className="btn-primary h-10 px-4"
                onClick={confirm}
                disabled={!canConfirm}
              >
                {busy ? "Reservando..." : `Confirmar ${qty} reservación${qty > 1 ? "es" : ""}`}
              </button>
            </div>
          </>
        )}
      </motion.div>
    </div>,
    document.body
  );
}

// ---------- UI ----------
function SessionCard({
  s,
  onOpenReserve,
  onCancelBooking,
  isAdmin,
}: {
  s: Session;
  onOpenReserve: (s: Session) => void;
  onCancelBooking: (s: Session) => void;
  isAdmin: boolean;
}) {


  const statusEl = useMemo(() => {
    if (s.status === "FULL" || s.spots <= 0) {
      return (
        <span className="ml-auto rounded-full bg-[color:var(--color-muted)] px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
          FULL
        </span>
      );
    }
    if (s.status === "BOOK") {
      return (
        <span className="ml-auto rounded-full bg-[color:var(--color-primary-50)] px-2 py-0.5 text-[11px] font-semibold text-[color:hsl(201 45% 95%)]">
          BOOK YOUR MAT
        </span>
      );
    }
    return null;
  }, [s.status, s.spots]);

  const canBook =
  s.spots > 0 &&
  s.time !== "—" &&
  s.status !== "CANCELLED" &&
  !s.userHasBooking;

  const router = useRouter();

const handleCardClick = () => {
  if (!isAdmin) return;
  router.push(`/clases/${s.id}`);
};


  return (
    <motion.div
      variants={cardVariants}
      className={`card p-3 flex flex-col ${
        isAdmin ? "cursor-pointer hover:ring-2 hover:ring-primary/40" : ""
      }`}
      onClick={handleCardClick}
    >
      <div className="flex items-center gap-2">
        <h4 className="font-display text-sm font-bold truncate">{s.title}</h4>
        {statusEl}
      </div>

      {s.focus && (
        <div className="mt-0.5 text-xs text-muted-foreground truncate">
          {s.focus}
        </div>
      )}

      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-1 min-w-0">
          <FiClock className="icon" />
          <span className="truncate">{s.time}</span>
        </div>
        <div className="flex items-center gap-1 justify-end min-w-0">
          <FiUser className="icon" />
          <span className="truncate">{s.coach}</span>
        </div>
      </div>

      <div className="mt-1 text-[11px] text-muted-foreground flex items-center justify-between">
        <span>{s.duration}</span>
        <span className="font-semibold">
          Spots disponibles:{" "}
          <span className={s.spots <= 3 ? "text-[color:hsl(4_74%_45%)]" : ""}>
            {s.spots}
          </span>
        </span>
      </div>

      <div className="mt-auto pt-2">
       {s.userHasBooking ? (
  <div className="flex flex-col pb-2 gap-2">
    <button
      className="btn-outline h-9 w-full justify-center text-sm border-green-400 text-green-600"
      disabled
      onClick={(e) => e.stopPropagation()}
    >
      Ya reservado
    </button>

    <button
      className="btn-outline h-9 w-full  justify-center text-sm border-red-400 text-red-600"
      onClick={(e) => {
        e.stopPropagation();
        onCancelBooking(s);
      }}
    >
      Cancelar reserva
    </button>
  </div>
) : s.status === "CANCELLED" ? (
  <button
    className="btn-outline h-9 w-full justify-center text-sm border-red-400 text-red-600"
    disabled
    onClick={(e) => e.stopPropagation()}
  >
    Clase cancelada
  </button>
) : canBook ? (
  <button
    className="btn-primary h-9 w-full justify-center text-sm"
    onClick={(e) => {
      e.stopPropagation();
      onOpenReserve(s);
    }}
  >
    Reservar
  </button>
) : (
  <button
    className="btn-outline h-9 w-full justify-center text-sm"
    disabled
    onClick={(e) => e.stopPropagation()}
  >
    No disponible
  </button>
)}

      </div>
    </motion.div>
  );
}


function DayColumn({
  day,
  index,
  onOpenReserve,
  onCancelBooking,
}: {
  day: Day;
  index: number;
  onOpenReserve: (s: Session) => void;
  onCancelBooking: (s: Session) => void;
}) {


  const [isAdmin, setIsAdmin] = useState(false);

useEffect(() => {
  fetch("/api/admin/whoami", { credentials: "include" })
    .then((res) => {
      if (res.ok) setIsAdmin(true);
      else setIsAdmin(false);
    })
    .catch(() => setIsAdmin(false));
}, []);


  return (
    <motion.div
      custom={index}
      initial="hidden"
      animate="show"
      variants={colVariants}
      className="card overflow-hidden flex flex-col h-[560px] md:h-[580px] snap-start"
      style={{ minWidth: "17rem" }}
    >
      <div className="px-3 py-2 bg-[color:var(--color-primary-50)] text-center font-display text-sm font-bold text-[color:hsl(201 45% 95%)]">
        <div>{day.dow}</div>
        <div className="text-[11px] font-semibold opacity-80">{day.dateLabel}</div>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-3">
        {day.sessions.length ? (
          day.sessions.map((s) => (
            <SessionCard
  key={s.id}
  s={s}
  onOpenReserve={onOpenReserve}
  onCancelBooking={onCancelBooking}
  isAdmin={isAdmin}
/>

          ))
        ) : (
          <div className="grid h-full place-items-center text-sm text-muted-foreground">Sin clases</div>
        )}
      </div>
    </motion.div>
  );
}

export default function ClassesPage() {
  const [days, setDays] = useState<Day[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tokens, setTokens] = useState<number>(0);
  const [isAuthed, setIsAuthed] = useState<boolean>(false);
  const [showNoCredits, setShowNoCredits] = useState(false);
  const [affiliation, setAffiliation] = useState<string | null>(null);
  const [lateCancelSession, setLateCancelSession] = useState<Session | null>(null);

  // estado del modal
  const [reserveOpen, setReserveOpen] = useState(false);
  const [reserveSession, setReserveSession] = useState<Session | null>(null);

function openReserve(s: Session) {
  // 1️⃣ No logueado → login
  if (!isAuthed) {
    window.location.href = "/login";
    return;
  }

  // 2️⃣ Logueado pero sin créditos
  if (tokens <= 0) {
    setShowNoCredits(true);
    return;
  }

  // 3️⃣ Todo OK → abrir modal
  setReserveSession(s);
  setReserveOpen(true);
}

async function handleCancel(s: Session) {
  const start = new Date(s.startsAtISO);
  const minutesUntil =
    Math.floor((start.getTime() - Date.now()) / 60000);

  if (minutesUntil < 240) {
    setLateCancelSession(s);
    return;
  }

  await executeCancel(s);
}

async function executeCancel(s: Session) {
  console.log(s.bookingId)
  if (!s.bookingId) return;

  const res = await fetch(`/api/bookings/${s.bookingId}/cancel`, {
    method: "PATCH",
  });

  

  if (!res.ok) return;

  const data = await res.json();

  setDays((prev) =>
    prev?.map((day) => ({
      ...day,
      sessions: day.sessions.map((ses) => {
        if (ses.id !== s.id) return ses;

        const newBooked = Math.max(0, (ses.booked ?? 1) - 1);
        const cap = ses.capacity ?? 0;
        const newSpots = cap ? cap - newBooked : 0;

        return {
          ...ses,
          userHasBooking: false,
          bookingId: undefined,
          booked: newBooked,
          spots: newSpots,
        };
      }),
    })) ?? prev
  );

  if (!data.lateCancel) {
    setTokens((t) => t + 1);
  }
}

  



  useEffect(() => {
    // Rango de 14 días comenzando en HOY (medianoche MX real)
    const from = startOfTodayInMX();
    const to = addDays(from, 14);
    const fromISO = from.toISOString();
    const toISO = to.toISOString();

    async function load() {
      setError(null);
      const empty = buildEmptyDays(from, 14);
      setDays(empty);

      try {
        const [classesRes, tokensRes] = await Promise.all([
          fetch(
            `/api/classes?from=${encodeURIComponent(fromISO)}&to=${encodeURIComponent(toISO)}`,
            { method: "GET", headers: { "Content-Type": "application/json" }, cache: "no-store" }
          ),
          fetch(`/api/users/me/tokens`, { method: "GET", headers: { "Content-Type": "application/json" }, cache: "no-store", credentials: "include" }),
        ]);

        if (!classesRes.ok) throw new Error(`HTTP ${classesRes.status}`);
        const data: ApiSession[] = await classesRes.json();

        const grouped = new Map<string, Session[]>();
        for (const s of data) {
          const key = ymdKey(new Date(s.startsAt));
          const arr = grouped.get(key) ?? [];
          arr.push(toSession(s));
          grouped.set(key, arr);
        }
        for (const [k, arr] of grouped.entries()) {
          arr.sort((a, b) => new Date(a.startsAtISO).getTime() - new Date(b.startsAtISO).getTime());
          grouped.set(k, arr);
        }
        const hydrated = empty.map((d) => ({ ...d, sessions: grouped.get(d.dateKey) ?? [] }));
        setDays(hydrated);

      if (tokensRes.ok) {
  const tk = await tokensRes.json().catch(() => ({}));

  if (typeof tk.affiliation === "string") {
  setAffiliation(tk.affiliation);
}


  // ✅ auth real (no inferida por tokens)
  if (typeof tk.authenticated === "boolean") {
    setIsAuthed(tk.authenticated);
  } else {
    setIsAuthed(false);
  }

  // tokens (si vienen)
  if (typeof tk.tokens === "number") {
    setTokens(tk.tokens);
  } else {
    setTokens(0);
  }
} else {
  setIsAuthed(false);
  setTokens(0);
}



      } catch (e) {
        console.error(e);
        setError("No se pudieron cargar las clases.");
      }
    }

    load();
  }, []);

  function handleBooked(qty: number, bookingId: string) {
  setTokens((t) => Math.max(0, t - qty));

  if (!reserveSession) return;

  setDays((prev) =>
    prev?.map((day) => ({
      ...day,
      sessions: day.sessions.map((s) => {
        if (s.id !== reserveSession.id) return s;

        const newBooked = (s.booked ?? 0) + qty;
        const cap = s.capacity ?? 0;
        const newSpots = cap ? Math.max(0, cap - newBooked) : 0;

        return {
          ...s,
          booked: newBooked,
          spots: newSpots,
          userHasBooking: true,
          bookingId,
        };
      }),
    })) ?? prev
  );
}


  return (
    <section className="section">
      <div className="container-app">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } }}
          className="mx-auto max-w-2xl text-center"
        >
          <h1 className="font-display text-3xl font-extrabold md:text-4xl">Calendario de clases</h1>
          <p className="mt-2 text-muted-foreground">Elige tu sesión y reserva tu lugar.</p>

          {/* Resumen de tokens en el header */}
          <div className="mt-3 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm">
            <span className="opacity-70">Tus clases:</span>
            <span className="font-bold">{tokens}</span>
          </div>
        </motion.div>

        {error && <div className="mt-6 text-center text-sm text-red-600">{error} Inténtalo de nuevo más tarde.</div>}

        <div className="mt-8 grid grid-flow-col auto-cols-[minmax(17rem,1fr)] gap-4 overflow-x-auto pb-2 snap-x snap-mandatory">
          {days
            ? days.map((day, i) => (
                <DayColumn
  key={day.id}
  day={day}
  index={i}
  onOpenReserve={openReserve}
  onCancelBooking={handleCancel}
/>


              ))
            : Array.from({ length: 7 }).map((_, i) => (
                <div
                  key={`sk-${i}`}
                  className="card overflow-hidden flex flex-col h-[560px] md:h-[580px] snap-start animate-pulse"
                  style={{ minWidth: "17rem" }}
                >
                  <div className="px-3 py-2 bg-[color:var(--color-primary-50)]" />
                  <div className="flex-1 overflow-auto p-3 space-y-3">
                    {Array.from({ length: 3 }).map((__, j) => (
                      <div key={j} className="card h-40 md:h-44 p-3">
                        <div className="h-4 w-2/3 bg-muted rounded mb-2" />
                        <div className="h-3 w-1/2 bg-muted rounded mb-3" />
                        <div className="grid grid-cols-2 gap-2">
                          <div className="h-3 bg-muted rounded" />
                          <div className="h-3 bg-muted rounded" />
                        </div>
                        <div className="h-8 bg-muted rounded mt-3" />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Horarios sujetos a cambios. Reserva con anticipación para asegurar tu lugar.
        </p>
      </div>


              {showNoCredits && (
  <div className="fixed inset-0 z-40 flex items-end md:items-center justify-center">
    <div
      className="absolute inset-0 bg-black/40"
      onClick={() => setShowNoCredits(false)}
    />

    <motion.div
      initial={{ y: 30, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="relative w-full md:w-[420px] rounded-t-2xl md:rounded-2xl bg-[color:var(--color-card)] p-5 shadow-xl"
    >
      <h3 className="font-display text-lg font-bold">
        No tienes créditos
      </h3>

      <p className="mt-2 text-sm text-muted-foreground">
        Tienes <b>0 créditos</b>. Necesitas al menos <b>1 crédito</b> para
        reservar espacios en una clase.
      </p>

      <div className="mt-4 flex gap-2">
        <button
          className="btn-outline h-10 px-4"
          onClick={() => setShowNoCredits(false)}
        >
          Cerrar
        </button>

        <a
          href="/precios"
          className="btn-primary h-10 px-4 inline-flex items-center justify-center"
        >
          Obtener créditos
        </a>
      </div>
    </motion.div>
  </div>
)}

  {lateCancelSession && (
  <LateCancelModal
    session={lateCancelSession}
    onClose={() => setLateCancelSession(null)}
    onConfirm={async () => {
      await executeCancel(lateCancelSession);
      setLateCancelSession(null);
    }}
  />
)}


      <ReserveMenu
  open={reserveOpen}
  onClose={() => setReserveOpen(false)}
  session={reserveSession}
  tokens={tokens}
  affiliation={affiliation}
  onBooked={handleBooked}
/>

    </section>
  );
}

function LateCancelModal({
  session,
  onClose,
  onConfirm,
}: {
  session: Session;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="card w-full max-w-md p-6"
      >
        <h3 className="font-display text-xl font-bold">
          Cancelación tardía
        </h3>

        <p className="mt-4 text-sm text-red-600">
          Faltan menos de 4 horas.
          <br />
          No se te regresarán los créditos.
        </p>

        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onClose} className="btn-outline h-10">
            Volver
          </button>
          <button
            onClick={onConfirm}
            className="h-10 px-4 rounded-md bg-red-600 text-white hover:bg-red-700"
          >
            Confirmar cancelación
          </button>
        </div>
      </motion.div>
    </div>
  );
}
