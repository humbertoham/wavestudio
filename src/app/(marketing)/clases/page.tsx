// src/app/(marketing)/clases/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, cubicBezier, type Variants } from "framer-motion";
import { FiClock, FiUser } from "react-icons/fi";

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
};

type Session = {
  id: string;
  title: string;
  focus?: string;
  time: string;
  coach: string;
  duration: string;
  status?: "BOOK" | "FULL";
  startsAtISO: string;
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
  //    Ej: "2025-09-27T00:00:00-06:00"
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
  const full =
    !!api.isFull || (!!api.capacity && typeof api.booked === "number" && api.booked >= api.capacity);
  return {
    id: api.id,
    title: api.title,
    focus: api.focus ?? undefined,
    coach: api.coach,
    time: fmtTimeMX(api.startsAt),
    duration: `${api.durationMin}MIN`,
    status: full ? "FULL" : undefined,
    startsAtISO: api.startsAt,
  };
}

// ---------- UI ----------
function SessionCard({ s }: { s: Session }) {
  const statusEl = useMemo(() => {
    if (s.status === "FULL") {
      return (
        <span className="ml-auto rounded-full bg-[color:var(--color-muted)] px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
          FULL
        </span>
      );
    }
    if (s.status === "BOOK") {
      return (
        <span className="ml-auto rounded-full bg-[color:var(--color-primary-50)] px-2 py-0.5 text-[11px] font-semibold text-[color:hsl(201_44%_36%)]">
          BOOK YOUR MAT
        </span>
      );
    }
    return null;
  }, [s.status]);

  const canBook = s.status !== "FULL" && s.time !== "—";

  return (
    <motion.div variants={cardVariants} className="card p-3 h-36 md:h-40 flex flex-col">
      <div className="flex items-center gap-2">
        <h4 className="font-display text-sm font-bold truncate">{s.title}</h4>
        {statusEl}
      </div>
      {s.focus && <div className="mt-0.5 text-xs text-muted-foreground truncate">{s.focus}</div>}

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

      <div className="mt-1 text-[11px] text-muted-foreground">{s.duration}</div>

      <div className="mt-auto pt-2">
        {canBook ? (
          <button className="btn-primary h-9 w-full justify-center text-sm">Reservar</button>
        ) : (
          <button className="btn-outline h-9 w-full justify-center text-sm" disabled>
            No disponible
          </button>
        )}
      </div>
    </motion.div>
  );
}

function DayColumn({ day, index }: { day: Day; index: number }) {
  return (
    <motion.div
      custom={index}
      initial="hidden"
      animate="show" // ← anima al montar (no depende de whileInView)
      variants={colVariants}
      className="card overflow-hidden flex flex-col h-[540px] md:h-[560px] snap-start"
      style={{ minWidth: "17rem" }}
    >
      <div className="px-3 py-2 bg-[color:var(--color-primary-50)] text-center font-display text-sm font-bold text-[color:hsl(201_44%_36%)]">
        <div>{day.dow}</div>
        <div className="text-[11px] font-semibold opacity-80">{day.dateLabel}</div>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-3">
        {day.sessions.length ? (
          day.sessions.map((s) => <SessionCard key={s.id} s={s} />)
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
        const res = await fetch(`/api/classes?from=${encodeURIComponent(fromISO)}&to=${encodeURIComponent(toISO)}`, {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: ApiSession[] = await res.json();

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
      } catch (e) {
        console.error(e);
        setError("No se pudieron cargar las clases.");
      }
    }

    load();
  }, []);

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
        </motion.div>

        {error && <div className="mt-6 text-center text-sm text-red-600">{error} Inténtalo de nuevo más tarde.</div>}

        <div className="mt-8 grid grid-flow-col auto-cols-[minmax(17rem,1fr)] gap-4 overflow-x-auto pb-2 snap-x snap-mandatory">
          {days
            ? days.map((day, i) => <DayColumn key={day.id} day={day} index={i} />)
            : Array.from({ length: 7 }).map((_, i) => (
                <div
                  key={`sk-${i}`}
                  className="card overflow-hidden flex flex-col h-[540px] md:h-[560px] snap-start animate-pulse"
                  style={{ minWidth: "17rem" }}
                >
                  <div className="px-3 py-2 bg-[color:var(--color-primary-50)]" />
                  <div className="flex-1 overflow-auto p-3 space-y-3">
                    {Array.from({ length: 3 }).map((__, j) => (
                      <div key={j} className="card h-36 md:h-40 p-3">
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
    </section>
  );
}
