"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { motion, cubicBezier, type Variants } from "framer-motion";
import { FiClock, FiUser } from "react-icons/fi";

const EASE = cubicBezier(0.22, 1, 0.36, 1);
const MX_TZ = "America/Mexico_City";
const MX_LOCALE: Intl.LocalesArgument = "es-MX";
type Affiliation = "NONE" | "WELLHUB" | "TOTALPASS";
type NoCreditsModalVariant = "reserve" | "waitlist";

type ApiSession = {
  id: string;
  title: string;
  focus?: string | null;
  coach: string;
  startsAt: string;
  durationMin: number;
  capacity?: number | null;
  booked?: number | null;
  isFull?: boolean | null;
  isCanceled?: boolean;
  userHasBooking?: boolean;
  bookingId?: string | null;
  userOnWaitlist?: boolean;
  waitlistEntryId?: string | null;
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
  spots: number;
  userHasBooking?: boolean;
  bookingId?: string;
  userOnWaitlist?: boolean;
  waitlistEntryId?: string | null;
};

type Day = {
  id: string;
  dow: "LUN" | "MAR" | "MIE" | "JUE" | "VIE" | "SAB" | "DOM";
  dateLabel: string;
  dateKey: string;
  sessions: Session[];
};

const colVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: (index: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, delay: 0.04 * index, ease: EASE },
  }),
};

const cardVariants: Variants = {
  hidden: { opacity: 0, scale: 0.98 },
  show: { opacity: 1, scale: 1, transition: { duration: 0.3, ease: EASE } },
};

function fmtTimeMX(iso: string) {
  return new Intl.DateTimeFormat(MX_LOCALE, {
    timeZone: MX_TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

function startOfTodayInMX(): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MX_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(new Date())
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type === "year" || part.type === "month" || part.type === "day") {
        acc[part.type] = part.value;
      }
      return acc;
    }, {});

  const tzName =
    new Intl.DateTimeFormat("en-US", {
      timeZone: MX_TZ,
      timeZoneName: "shortOffset",
      hour: "2-digit",
    })
      .formatToParts(new Date())
      .find((part) => part.type === "timeZoneName")?.value ?? "UTC-06";

  const match = tzName.match(/([+-]\d{1,2})/);
  const rawHours = match ? parseInt(match[1], 10) : -6;
  const sign = rawHours >= 0 ? "+" : "-";
  const hours = String(Math.abs(rawHours)).padStart(2, "0");
  const offset = `${sign}${hours}:00`;

  return new Date(
    `${parts.year}-${parts.month}-${parts.day}T00:00:00${offset}`
  );
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function getDOWAbbr(date: Date): Day["dow"] {
  const value = new Intl.DateTimeFormat("es", {
    weekday: "short",
    timeZone: MX_TZ,
  })
    .format(date)
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(".", "");

  const map: Record<string, Day["dow"]> = {
    LUN: "LUN",
    MAR: "MAR",
    MIE: "MIE",
    MIER: "MIE",
    JUE: "JUE",
    VIE: "VIE",
    SAB: "SAB",
    DOM: "DOM",
  };

  return map[value] ?? "DOM";
}

function fmtDayLabel(date: Date) {
  const day = new Intl.DateTimeFormat(MX_LOCALE, {
    timeZone: MX_TZ,
    day: "2-digit",
  }).format(date);

  const month = new Intl.DateTimeFormat(MX_LOCALE, {
    timeZone: MX_TZ,
    month: "short",
  })
    .format(date)
    .toUpperCase()
    .replace(".", "");

  return `${day} ${month}`;
}

function ymdKey(date: Date) {
  const [dd, mm, yyyy] = new Intl.DateTimeFormat("es-MX", {
    timeZone: MX_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
    .format(date)
    .split("/");

  return `${yyyy}-${mm}-${dd}`;
}

function buildEmptyDays(from: Date, count: number): Day[] {
  return Array.from({ length: count }).map((_, index) => {
    const date = addDays(from, index);
    return {
      id: ymdKey(date),
      dow: getDOWAbbr(date),
      dateLabel: fmtDayLabel(date),
      dateKey: ymdKey(date),
      sessions: [],
    };
  });
}

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
    status: isCancelled ? "CANCELLED" : full ? "FULL" : undefined,
    isCanceled: isCancelled,
    startsAtISO: api.startsAt,
    capacity,
    booked,
    spots,
    userHasBooking: api.userHasBooking ?? false,
    bookingId: api.bookingId ?? undefined,
    userOnWaitlist: api.userOnWaitlist ?? false,
    waitlistEntryId: api.waitlistEntryId ?? null,
  };
}

async function readErrorMessage(res: Response, fallback: string) {
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

function useIsomorphicLayoutEffect(effect: () => void, deps: unknown[]) {
  const useEff = typeof window !== "undefined" ? useEffect : () => undefined;
  // @ts-ignore
  return useEff(effect, deps);
}

type ReserveMenuProps = {
  open: boolean;
  onClose: () => void;
  session: Session | null;
  tokens: number;
  affiliation: string | null;
  onBooked: (qty: number, bookingId: string) => void;
};

function ReserveMenu({
  open,
  onClose,
  session,
  tokens,
  onBooked,
  affiliation,
}: ReserveMenuProps) {
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  const isCorporate =
    affiliation === "WELLHUB" || affiliation === "TOTALPASS";

  const maxBySpots = session?.spots ?? 0;
  const baseMax = Math.max(0, Math.min(maxBySpots, tokens));
  const max = isCorporate ? Math.min(1, baseMax) : baseMax;

  useIsomorphicLayoutEffect(() => {
    if (open) {
      setQty(Math.min(1, max));
      setErr(null);
    }
  }, [open, max]);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!open || !mounted) return null;

  const canConfirm = !!session && qty >= 1 && qty <= max && !busy;

  async function confirm() {
    if (!session || !canConfirm) return;

    try {
      setBusy(true);
      setErr(null);

      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId: session.id, quantity: qty }),
      });

      if (!res.ok) {
        throw new Error(
          await readErrorMessage(
            res,
            `No se pudo confirmar la reserva (HTTP ${res.status})`
          )
        );
      }

      const data = await res.json();
      onBooked(qty, data.bookingId);
      onClose();
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Error al reservar.");
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1, transition: { duration: 0.25, ease: EASE } }}
        className="relative w-full rounded-t-2xl bg-[color:var(--color-card)] p-4 shadow-xl md:w-[520px] md:rounded-2xl md:p-5"
      >
        <div className="flex items-center gap-2">
          <h3 className="font-display text-lg font-bold">Reservar</h3>
          <button className="btn-outline ml-auto h-8 px-3" onClick={onClose}>
            Cerrar
          </button>
        </div>

        {session && (
          <>
            <div className="mt-3 space-y-1">
              <div className="font-semibold">{session.title}</div>
              <div className="text-sm text-muted-foreground">
                {session.time} - {session.duration} - {session.coach}
              </div>
              <div className="text-sm">
                <span className="font-semibold">Spots disponibles:</span>{" "}
                {session.spots}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="card p-3">
                <div className="text-xs text-muted-foreground">Tus clases</div>
                <div className="mt-1 text-2xl font-extrabold">{tokens}</div>
              </div>

              <div className="card p-3">
                <div className="text-xs text-muted-foreground">
                  Cantidad a reservar
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    className="btn-outline h-9 px-3"
                    onClick={() => setQty((current) => Math.max(1, current - 1))}
                    disabled={qty <= 1 || busy}
                  >
                    -
                  </button>

                  <input
                    type="number"
                    min={1}
                    max={max || 1}
                    value={qty}
                    disabled={isCorporate}
                    onChange={(e) => {
                      const value = Number(e.target.value || 1);
                      setQty(Math.max(1, Math.min(max || 1, value)));
                    }}
                    className="input h-9 w-20 text-center"
                  />

                  <button
                    className="btn-outline h-9 px-3"
                    onClick={() => setQty((current) => Math.min(max, current + 1))}
                    disabled={qty >= max || busy || isCorporate}
                  >
                    +
                  </button>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  Max. permitido por disponibilidad y saldo: <b>{max}</b>
                </div>
              </div>

              {isCorporate && (
                <div className="text-xs text-muted-foreground md:col-span-2">
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
                {busy
                  ? "Reservando..."
                  : `Confirmar ${qty} reservacion${qty > 1 ? "es" : ""}`}
              </button>
            </div>
          </>
        )}
      </motion.div>
    </div>,
    document.body
  );
}

type SessionCardProps = {
  s: Session;
  onOpenReserve: (session: Session) => void;
  onCancelBooking: (session: Session) => void;
  onOpenWaitlistConfirm: (session: Session) => void;
  onLeaveWaitlist: (session: Session) => void;
  cancelBusyId: string | null;
  waitlistBusyId: string | null;
  isAdmin: boolean;
};

function SessionCard({
  s,
  onOpenReserve,
  onCancelBooking,
  onOpenWaitlistConfirm,
  onLeaveWaitlist,
  cancelBusyId,
  waitlistBusyId,
  isAdmin,
}: SessionCardProps) {
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

  const isPast = new Date(s.startsAtISO).getTime() < Date.now();
  const isCancelBusy = cancelBusyId === s.id;
  const isWaitlistBusy = waitlistBusyId === s.id;

  const canBook =
    !isPast &&
    s.spots > 0 &&
    s.time !== "-" &&
    s.status !== "CANCELLED" &&
    !s.userHasBooking;

  const canJoinWaitlist =
    !isPast &&
    s.spots <= 0 &&
    s.status !== "CANCELLED" &&
    !s.userHasBooking &&
    !s.userOnWaitlist;

  const router = useRouter();

  const handleCardClick = () => {
    if (!isAdmin) return;
    router.push(`/clases/${s.id}`);
  };

  return (
    <motion.div
      variants={cardVariants}
      className={`card flex flex-col p-3 ${
        isAdmin ? "cursor-pointer hover:ring-2 hover:ring-primary/40" : ""
      }`}
      onClick={handleCardClick}
    >
      <div className="flex items-center gap-2">
        <h4 className="font-display truncate text-sm font-bold">{s.title}</h4>
        {statusEl}
      </div>

      {s.focus && (
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {s.focus}
        </div>
      )}

      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        <div className="flex min-w-0 items-center gap-1">
          <FiClock className="icon" />
          <span className="truncate">{s.time}</span>
        </div>
        <div className="flex min-w-0 items-center justify-end gap-1">
          <FiUser className="icon" />
          <span className="truncate">{s.coach}</span>
        </div>
      </div>

      <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
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
          <div className="flex flex-col gap-2 pb-2">
            <button
              className="btn-outline h-9 w-full justify-center border-green-400 text-sm text-green-600"
              disabled
              onClick={(e) => e.stopPropagation()}
            >
              Ya reservado
            </button>

            <button
              className="btn-outline h-9 w-full justify-center border-red-400 text-sm text-red-600"
              disabled={isCancelBusy}
              onClick={(e) => {
                e.stopPropagation();
                onCancelBooking(s);
              }}
            >
              {isCancelBusy ? "Cancelando..." : "Cancelar reserva"}
            </button>
          </div>
        ) : s.status === "CANCELLED" ? (
          <button
            className="btn-outline h-9 w-full justify-center border-red-400 text-sm text-red-600"
            disabled
            onClick={(e) => e.stopPropagation()}
          >
            Clase cancelada
          </button>
        ) : isPast ? (
          <button
            className="btn-outline h-9 w-full justify-center text-sm"
            disabled
            onClick={(e) => e.stopPropagation()}
          >
            No disponible
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
        ) : s.spots <= 0 ? (
          <div className="flex flex-col gap-2">
            <div className="text-center text-[11px] font-semibold text-muted-foreground">
              Clase llena
            </div>

            {s.userOnWaitlist ? (
              <>
                <button
                  className="btn-outline h-9 w-full justify-center border-green-400 text-sm text-green-600"
                  disabled
                  onClick={(e) => e.stopPropagation()}
                >
                  Ya estas en la lista de espera
                </button>

                <button
                  className="btn-outline h-9 w-full justify-center border-red-400 text-sm text-red-600"
                  disabled={isWaitlistBusy}
                  onClick={(e) => {
                    e.stopPropagation();
                    onLeaveWaitlist(s);
                  }}
                >
                  {isWaitlistBusy ? "Saliendo..." : "Salir de la lista de espera"}
                </button>
              </>
            ) : (
              <button
                className="btn-outline h-9 w-full justify-center text-sm"
                disabled={!canJoinWaitlist || isWaitlistBusy}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenWaitlistConfirm(s);
                }}
              >
                {isWaitlistBusy ? "Agregando..." : "Entrar a lista de espera"}
              </button>
            )}
          </div>
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

type DayColumnProps = {
  day: Day;
  index: number;
  onOpenReserve: (session: Session) => void;
  onCancelBooking: (session: Session) => void;
  onOpenWaitlistConfirm: (session: Session) => void;
  onLeaveWaitlist: (session: Session) => void;
  cancelBusyId: string | null;
  waitlistBusyId: string | null;
};

function DayColumn({
  day,
  index,
  onOpenReserve,
  onCancelBooking,
  onOpenWaitlistConfirm,
  onLeaveWaitlist,
  cancelBusyId,
  waitlistBusyId,
}: DayColumnProps) {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    fetch("/api/admin/whoami", { credentials: "include" })
      .then((res) => setIsAdmin(res.ok))
      .catch(() => setIsAdmin(false));
  }, []);

  return (
    <motion.div
      custom={index}
      initial="hidden"
      animate="show"
      variants={colVariants}
      className="card flex h-[560px] snap-start flex-col overflow-hidden md:h-[580px]"
      style={{ minWidth: "17rem" }}
    >
      <div className="bg-[color:var(--color-primary-50)] px-3 py-2 text-center font-display text-sm font-bold text-[color:hsl(201 45% 95%)]">
        <div>{day.dow}</div>
        <div className="text-[11px] font-semibold opacity-80">{day.dateLabel}</div>
      </div>

      <div className="flex-1 space-y-3 overflow-auto p-3">
        {day.sessions.length ? (
          day.sessions.map((session) => (
            <SessionCard
              key={session.id}
              s={session}
              onOpenReserve={onOpenReserve}
              onCancelBooking={onCancelBooking}
              onOpenWaitlistConfirm={onOpenWaitlistConfirm}
              onLeaveWaitlist={onLeaveWaitlist}
              cancelBusyId={cancelBusyId}
              waitlistBusyId={waitlistBusyId}
              isAdmin={isAdmin}
            />
          ))
        ) : (
          <div className="grid h-full place-items-center text-sm text-muted-foreground">
            Sin clases
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default function ClassesPage() {
  const [days, setDays] = useState<Day[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tokens, setTokens] = useState(0);
  const [isAuthed, setIsAuthed] = useState(false);
  const [showNoCredits, setShowNoCredits] = useState(false);
  const [noCreditsModalVariant, setNoCreditsModalVariant] =
    useState<NoCreditsModalVariant>("reserve");
  const [affiliation, setAffiliation] = useState<Affiliation | null>(null);
  const [lateCancelSession, setLateCancelSession] = useState<Session | null>(null);
  const [reserveOpen, setReserveOpen] = useState(false);
  const [reserveSession, setReserveSession] = useState<Session | null>(null);
  const [cancelBusyId, setCancelBusyId] = useState<string | null>(null);
  const [waitlistBusyId, setWaitlistBusyId] = useState<string | null>(null);
  const [waitlistConfirmSession, setWaitlistConfirmSession] =
    useState<Session | null>(null);

  function openNoCreditsModal(variant: NoCreditsModalVariant) {
    setNoCreditsModalVariant(variant);
    setShowNoCredits(true);
  }

  function closeNoCreditsModal() {
    setShowNoCredits(false);
    setNoCreditsModalVariant("reserve");
  }

  function openReserve(session: Session) {
    if (!isAuthed) {
      window.location.href = "/login";
      return;
    }

    if (tokens <= 0) {
      openNoCreditsModal("reserve");
      return;
    }

    setReserveSession(session);
    setReserveOpen(true);
  }

  function openWaitlistConfirm(session: Session) {
    if (!isAuthed) {
      window.location.href = "/login";
      return;
    }

    if (tokens <= 0) {
      openNoCreditsModal("waitlist");
      return;
    }

    setWaitlistConfirmSession(session);
  }

  async function joinWaitlist(session: Session) {
    if (!isAuthed) {
      window.location.href = "/login";
      return false;
    }

    if (tokens <= 0) {
      openNoCreditsModal("waitlist");
      return false;
    }

    setWaitlistBusyId(session.id);

    try {
      const res = await fetch(`/api/classes/${session.id}/waitlist`, {
        method: "POST",
        credentials: "include",
      });

      if (!res.ok) {
        throw new Error(
          await readErrorMessage(res, "No se pudo agregar a la lista de espera.")
        );
      }

      const data = await res.json().catch(() => ({}));

      setDays((prev) =>
        prev?.map((day) => ({
          ...day,
          sessions: day.sessions.map((item) =>
            item.id === session.id
              ? {
                  ...item,
                  userOnWaitlist: true,
                  waitlistEntryId:
                    typeof data.entryId === "string" ? data.entryId : item.waitlistEntryId,
                }
              : item
          ),
        })) ?? prev
      );
      return true;
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "No se pudo agregar a la lista de espera."
      );
      return false;
    } finally {
      setWaitlistBusyId(null);
    }
  }

  async function leaveWaitlist(session: Session) {
    if (!isAuthed) {
      window.location.href = "/login";
      return;
    }

    setWaitlistBusyId(session.id);

    try {
      const res = await fetch(`/api/classes/${session.id}/waitlist`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!res.ok) {
        throw new Error(
          await readErrorMessage(res, "No se pudo salir de la lista de espera.")
        );
      }

      setDays((prev) =>
        prev?.map((day) => ({
          ...day,
          sessions: day.sessions.map((item) =>
            item.id === session.id
              ? {
                  ...item,
                  userOnWaitlist: false,
                  waitlistEntryId: null,
                }
              : item
          ),
        })) ?? prev
      );
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "No se pudo salir de la lista de espera."
      );
    } finally {
      setWaitlistBusyId(null);
    }
  }

  async function handleCancel(session: Session) {
    if (cancelBusyId === session.id) return;

    const start = new Date(session.startsAtISO);
    const minutesUntil = Math.floor((start.getTime() - Date.now()) / 60000);

    if (minutesUntil < 240) {
      setLateCancelSession(session);
      return;
    }

    await executeCancel(session);
  }

  async function executeCancel(session: Session) {
    if (!session.bookingId || cancelBusyId === session.id) return false;

    setCancelBusyId(session.id);
    let shouldResetBusy = true;

    try {
      const res = await fetch(`/api/bookings/${session.bookingId}/cancel`, {
        method: "PATCH",
      });

      if (!res.ok) return false;

      const data = await res.json();

      setDays((prev) =>
        prev?.map((day) => ({
          ...day,
          sessions: day.sessions.map((item) => {
            if (item.id !== session.id) return item;

            const newBooked = Math.max(0, (item.booked ?? 1) - 1);
            const cap = item.capacity ?? 0;
            const newSpots = cap ? cap - newBooked : 0;

            return {
              ...item,
              userHasBooking: false,
              bookingId: undefined,
              booked: newBooked,
              spots: newSpots,
            };
          }),
        })) ?? prev
      );

      if (!data.lateCancel) {
        setTokens((current) => current + 1);
      }

      shouldResetBusy = false;
      window.location.reload();
      return true;
    } finally {
      if (shouldResetBusy) {
        setCancelBusyId(null);
      }
    }
  }

  useEffect(() => {
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
            {
              method: "GET",
              headers: { "Content-Type": "application/json" },
              cache: "no-store",
            }
          ),
          fetch("/api/users/me/tokens", {
            method: "GET",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
            credentials: "include",
          }),
        ]);

        if (!classesRes.ok) throw new Error(`HTTP ${classesRes.status}`);
        const data: ApiSession[] = await classesRes.json();

        const grouped = new Map<string, Session[]>();
        for (const session of data) {
          const key = ymdKey(new Date(session.startsAt));
          const list = grouped.get(key) ?? [];
          list.push(toSession(session));
          grouped.set(key, list);
        }

        for (const [key, list] of grouped.entries()) {
          list.sort(
            (a, b) =>
              new Date(a.startsAtISO).getTime() - new Date(b.startsAtISO).getTime()
          );
          grouped.set(key, list);
        }

        setDays(empty.map((day) => ({ ...day, sessions: grouped.get(day.dateKey) ?? [] })));

        if (tokensRes.ok) {
          const tk = await tokensRes.json().catch(() => ({}));

          if (typeof tk.affiliation === "string") {
            setAffiliation(tk.affiliation);
          }

          setIsAuthed(typeof tk.authenticated === "boolean" ? tk.authenticated : false);
          setTokens(typeof tk.tokens === "number" ? tk.tokens : 0);
        } else {
          setIsAuthed(false);
          setTokens(0);
        }
      } catch (err) {
        console.error(err);
        setError("No se pudieron cargar las clases.");
      }
    }

    load();
  }, []);

  function handleBooked(qty: number, bookingId: string) {
    setTokens((current) => Math.max(0, current - qty));

    if (!reserveSession) return;

    setDays((prev) =>
      prev?.map((day) => ({
        ...day,
        sessions: day.sessions.map((session) => {
          if (session.id !== reserveSession.id) return session;

          const newBooked = (session.booked ?? 0) + qty;
          const cap = session.capacity ?? 0;
          const newSpots = cap ? Math.max(0, cap - newBooked) : 0;

          return {
            ...session,
            booked: newBooked,
            spots: newSpots,
            userHasBooking: true,
            bookingId,
            userOnWaitlist: false,
            waitlistEntryId: null,
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
          <h1 className="font-display text-3xl font-extrabold md:text-4xl">
            Calendario de clases
          </h1>
          <p className="mt-2 text-muted-foreground">
            Elige tu sesion y reserva tu lugar.
          </p>

          <div className="mt-3 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm">
            <span className="opacity-70">Tus clases:</span>
            <span className="font-bold">{tokens}</span>
          </div>
        </motion.div>

        {error && (
          <div className="mt-6 text-center text-sm text-red-600">
            {error} Intentalo de nuevo mas tarde.
          </div>
        )}

        <div className="mt-8 grid auto-cols-[minmax(17rem,1fr)] grid-flow-col gap-4 overflow-x-auto pb-2 snap-x snap-mandatory">
          {days
            ? days.map((day, index) => (
                <DayColumn
                  key={day.id}
                  day={day}
                  index={index}
                  onOpenReserve={openReserve}
                  onCancelBooking={handleCancel}
                  onOpenWaitlistConfirm={openWaitlistConfirm}
                  onLeaveWaitlist={leaveWaitlist}
                  cancelBusyId={cancelBusyId}
                  waitlistBusyId={waitlistBusyId}
                />
              ))
            : Array.from({ length: 7 }).map((_, index) => (
                <div
                  key={`sk-${index}`}
                  className="card flex h-[560px] snap-start flex-col overflow-hidden animate-pulse md:h-[580px]"
                  style={{ minWidth: "17rem" }}
                >
                  <div className="bg-[color:var(--color-primary-50)] px-3 py-2" />
                  <div className="flex-1 space-y-3 overflow-auto p-3">
                    {Array.from({ length: 3 }).map((__, itemIndex) => (
                      <div key={itemIndex} className="card h-40 p-3 md:h-44">
                        <div className="mb-2 h-4 w-2/3 rounded bg-muted" />
                        <div className="mb-3 h-3 w-1/2 rounded bg-muted" />
                        <div className="grid grid-cols-2 gap-2">
                          <div className="h-3 rounded bg-muted" />
                          <div className="h-3 rounded bg-muted" />
                        </div>
                        <div className="mt-3 h-8 rounded bg-muted" />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Horarios sujetos a cambios. Reserva con anticipacion para asegurar tu lugar.
        </p>
      </div>

      {showNoCredits && (
        <div className="fixed inset-0 z-40 flex items-end justify-center md:items-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={closeNoCreditsModal}
          />

          <motion.div
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="relative w-full rounded-t-2xl bg-[color:var(--color-card)] p-5 shadow-xl md:w-[420px] md:rounded-2xl"
          >
            <h3 className="font-display text-lg font-bold">
              {noCreditsModalVariant === "waitlist"
                ? "Créditos insuficientes"
                : "No tienes creditos"}
            </h3>

            <p className="mt-2 text-sm text-muted-foreground">
              {noCreditsModalVariant === "waitlist" ? (
                "Créditos insuficientes para unirte a la lista de espera"
              ) : (
                <>
                  Tienes <b>0 creditos</b>. Necesitas al menos <b>1 credito</b> para
                  reservar espacios en una clase.
                </>
              )}
            </p>

            <div className="mt-4 flex gap-2">
              <button
                className="btn-outline h-10 px-4"
                onClick={closeNoCreditsModal}
              >
                Cerrar
              </button>

              <a
                href="/precios"
                className="btn-primary inline-flex h-10 items-center justify-center px-4"
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
          busy={cancelBusyId === lateCancelSession.id}
          affiliation={affiliation}
          onClose={() => setLateCancelSession(null)}
          onConfirm={async () => {
            await executeCancel(lateCancelSession);
            setLateCancelSession(null);
          }}
        />
      )}

      {waitlistConfirmSession && (
        <WaitlistConfirmModal
          busy={waitlistBusyId === waitlistConfirmSession.id}
          onClose={() => {
            if (waitlistBusyId !== waitlistConfirmSession.id) {
              setWaitlistConfirmSession(null);
            }
          }}
          onConfirm={async () => {
            const joined = await joinWaitlist(waitlistConfirmSession);
            if (joined) {
              setWaitlistConfirmSession((current) =>
                current?.id === waitlistConfirmSession.id ? null : current
              );
            }
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

function WaitlistConfirmModal({
  busy,
  onClose,
  onConfirm,
}: {
  busy: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="waitlist-modal-title"
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1, transition: { duration: 0.25, ease: EASE } }}
        className="relative w-full rounded-t-2xl bg-[color:var(--color-card)] p-5 shadow-xl md:w-[520px] md:rounded-2xl"
      >
        <h3 id="waitlist-modal-title" className="font-display text-lg font-bold">
          ¿Clase llena? Únete a la waitlist
        </h3>

        <p className="mt-3 whitespace-pre-line text-sm text-muted-foreground">
          {"Si se libera un lugar, se asignará automáticamente en orden de lista.\nEs importante estar pendiente, ya que al asignarse tu lugar quedará confirmado.\nPuedes salirte de la waitlist en cualquier momento."}
        </p>

        <div className="mt-5 flex gap-2">
          <button
            className="btn-primary h-10 px-4"
            onClick={onConfirm}
            disabled={busy}
            autoFocus
          >
            {busy ? "Agregando..." : "Aceptar"}
          </button>
          <button className="btn-outline h-10 px-4" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function LateCancelModalLegacy({
  session,
  affiliation,
  onClose,
  onConfirm,
}: {
  session: Session;
  affiliation: Affiliation | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const hasPenalty =
    affiliation === "WELLHUB" || affiliation === "TOTALPASS";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="card w-full max-w-md p-6"
      >
        <h3 className="font-display text-xl font-bold">Cancelacion tardia</h3>

        <p className="mt-4 text-sm text-red-600">
          Faltan menos de 4 horas.
          <br />
          {hasPenalty
            ? "Si cancelas esta clase se te cobrará una penalización de $100 pesos."
            : "Si cancelas tu clase no se te regresaran los creditos por nuestras politicas de cancelacion."}
        </p>

        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onClose} className="btn-outline h-10">
            Volver
          </button>
          <button
            onClick={onConfirm}
            className="h-10 rounded-md bg-red-600 px-4 text-white hover:bg-red-700"
          >
            Confirmar cancelacion
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function LateCancelModal({
  session,
  busy,
  affiliation,
  onClose,
  onConfirm,
}: {
  session: Session;
  busy: boolean;
  affiliation: Affiliation | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const hasPenalty =
    affiliation === "WELLHUB" || affiliation === "TOTALPASS";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="card w-full max-w-md p-6"
      >
        <h3 className="font-display text-xl font-bold">
          Ups, estás fuera del tiempo de cancelación 
        </h3>


        <p className="mt-4 text-sm text-red-600">
          Faltan menos de 4 horas para la clase.
          <br />
          {hasPenalty
            ? "Esta reserva genera un cargo de $100 por cancelación tardía."
            : "Este crédito no podrá recuperarse debido a la cancelación tardía."}
            <br/>
            Gracias por ayudarnos a respetar los espacios de cada clase!
        </p>

        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onClose} className="btn-outline h-10" disabled={busy}>
            Volver
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="h-10 rounded-md bg-red-600 px-4 text-white hover:bg-red-700"
          >
            {busy ? "Cancelando..." : "Confirmar cancelacion"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
