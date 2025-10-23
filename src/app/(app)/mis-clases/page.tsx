// src/app/mis-clases/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion, cubicBezier } from "framer-motion";
import { FiCalendar, FiClock, FiMapPin, FiUser, FiArrowLeft, FiXCircle } from "react-icons/fi";

const EASE = cubicBezier(0.22, 1, 0.36, 1);
const MX_TZ = "America/Mexico_City";
const CANCEL_WINDOW_MIN = 240; // 4h

type BookingStatus = "ACTIVE" | "CANCELED";

type Instructor = { id: string; name: string; };

type ClassLite = {
  id: string;
  title: string;
  focus: string;
  date: string;       // ISO
  durationMin: number;
  creditCost?: number; // opcional si tu API lo trae
  location?: string | null;
  instructor: Instructor;
};

type Booking = {
  id: string;
  status: BookingStatus;
  createdAt: string;  // ISO
  canceledAt?: string | null;
  quantity: number;   // <- NECESARIO: asegúrate que tu API lo retorna
  class: ClassLite;
};

export default function MyClassesPage() {
  const [items, setItems] = useState<Booking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Carga de reservas del usuario autenticado
  useEffect(() => {
    let mounted = true;
    (async () => {
      setError(null);
      try {
        const res = await fetch("/api/users/me/bookings", {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: Booking[] = await res.json();
        if (!mounted) return;
        setItems(data);
      } catch (e) {
        console.error(e);
        if (!mounted) return;
        setError("No se pudieron cargar tus reservas.");
        setItems([]); // evitar skeleton infinito
      }
    })();
    return () => { mounted = false; };
  }, []);

  const now = useMemo(() => new Date(), []);
  const { upcoming, past } = useMemo(() => {
    const base = { upcoming: [] as Booking[], past: [] as Booking[] };
    if (!items) return base;
    return items.reduce((acc, b) => {
      const start = new Date(b.class.date);
      const end = new Date(start.getTime() + b.class.durationMin * 60_000);
      if (end >= now && b.status !== "CANCELED") acc.upcoming.push(b);
      else acc.past.push(b);
      return acc;
    }, base);
  }, [items, now]);

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleString("es-MX", {
      timeZone: MX_TZ,
      weekday: "long",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const fmtDuration = (min: number) => {
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  };

  const minutesUntil = (d: Date) => Math.floor((d.getTime() - Date.now()) / 60000);

  const canCancel = (b: Booking) => {
    if (b.status === "CANCELED") return false;
    const start = new Date(b.class.date);
    return minutesUntil(start) >= CANCEL_WINDOW_MIN;
  };

  const cancelBooking = async (b: Booking) => {
    try {
      setBusyId(b.id);
      // endpoint de cancelación (ver backend más abajo)
      const res = await fetch(`/api/bookings/${b.id}/cancel`, { method: "PATCH" });
      if (!res.ok) {
        const { code, message } = await res.json().catch(() => ({}));
        const msg =
          code === "WINDOW_CLOSED"
            ? "La ventana de cancelación ya cerró (4 horas antes)."
            : message || "No se pudo cancelar la clase.";
        throw new Error(msg);
      }
      const updated: Booking = await res.json();
      // refrescar localmente
      setItems((cur) => (cur ? cur.map(x => (x.id === updated.id ? updated : x)) : cur));
    } catch (e: any) {
      alert(e?.message || "No se pudo cancelar la clase.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="section">
      <div className="container-app">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } }}
          className="mx-auto max-w-3xl"
        >
          <div className="mb-4">
            <Link href="/clases" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
              <FiArrowLeft className="icon" /> Volver al calendario
            </Link>
          </div>

          <h1 className="font-display text-3xl font-extrabold">Mis clases</h1>
          <p className="mt-2 text-muted-foreground">
            Aquí verás todas tus reservas activas y el historial de clases pasadas/canceladas.
          </p>

          {error && <div className="mt-6 text-sm text-red-600">{error} Inténtalo de nuevo más tarde.</div>}

          {/* SKELETON */}
          {!items && !error && (
            <div className="mt-8 space-y-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={`sk-${i}`} className="card p-5 animate-pulse">
                  <div className="h-5 w-2/3 bg-muted rounded" />
                  <div className="mt-2 h-4 w-1/3 bg-muted rounded" />
                  <div className="mt-4 h-3 w-1/2 bg-muted rounded" />
                </div>
              ))}
            </div>
          )}

          {/* CONTENIDO */}
          {items && (
            <>
              {/* Próximas */}
              <section className="mt-8">
                <h2 className="font-display text-xl font-bold">Próximas</h2>
                <div className="mt-4 grid gap-4">
                  {upcoming.length ? (
                    upcoming
                      .slice()
                      .sort((a, b) => new Date(a.class.date).getTime() - new Date(b.class.date).getTime())
                      .map((b, idx) => (
                        <BookingCard
                          key={b.id}
                          booking={b}
                          idx={idx}
                          muted={false}
                          canCancel={canCancel(b)}
                          onCancel={() => cancelBooking(b)}
                          busy={busyId === b.id}
                        />
                      ))
                  ) : (
                    <div className="card p-8 text-center text-muted-foreground">
                      No tienes reservas próximas. <Link className="underline" href="/clases">Reserva una clase</Link>.
                    </div>
                  )}
                </div>
              </section>

              {/* Historial (solo 5) */}
              <section className="mt-10">
                <h2 className="font-display text-xl font-bold">Historial</h2>
                <div className="mt-4 grid gap-4">
                  {past.length ? (
                    past
                      .slice()
                      .sort((a, b) => new Date(b.class.date).getTime() - new Date(a.class.date).getTime())
                      .slice(0, 5)
                      .map((b, idx) => (
                        <BookingCard
                          key={b.id}
                          booking={b}
                          idx={idx}
                          muted
                          canCancel={false}
                          onCancel={() => {}}
                        />
                      ))
                  ) : (
                    <div className="card p-8 text-center text-muted-foreground">
                      Aún no tienes historial de clases.
                    </div>
                  )}
                </div>
              </section>
            </>
          )}
        </motion.div>
      </div>
    </section>
  );

  // ---- Components ----

  function BookingCard({
    booking,
    idx,
    muted = false,
    canCancel = false,
    onCancel,
    busy = false,
  }: {
    booking: Booking;
    idx: number;
    muted?: boolean;
    canCancel?: boolean;
    onCancel?: () => void;
    busy?: boolean;
  }) {
    const cls = booking.class;
    const canceled = booking.status === "CANCELED";
    const spots = booking.quantity ?? 1;
    const cost = cls.creditCost ?? 1;
    const refundTokens = spots * cost;

    return (
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.45, delay: 0.04 * idx, ease: EASE } }}
        className={`card p-5 ${muted ? "opacity-80" : ""} ${canceled ? "ring-1 ring-red-200" : ""}`}
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="font-display text-lg font-bold flex items-center gap-2">
              {cls.title} <span className="text-muted-foreground font-normal">· {cls.focus}</span>
              {/* badge de spots */}
              <span className="ml-1 inline-flex items-center rounded-full border px-2 py-0.5 text-xs">
                {spots} {spots === 1 ? "spot" : "spots"}
              </span>
            </h3>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <FiCalendar className="icon" />
                {fmtDate(cls.date)}
              </span>
              <span className="inline-flex items-center gap-1">
                <FiClock className="icon" />
                {fmtDuration(cls.durationMin)}
              </span>
              {cls.location && (
                <span className="inline-flex items-center gap-1">
                  <FiMapPin className="icon" />
                  {cls.location}
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                <FiUser className="icon" />
                {cls.instructor.name}
              </span>
            </div>
          </div>

          <div className="mt-3 grid gap-2 sm:mt-0 sm:text-right">
            {canceled ? (
              <span className="text-xs font-semibold uppercase text-red-600">Cancelada</span>
            ) : canCancel ? (
              <button
                onClick={onCancel}
                disabled={busy}
                className="btn-outline h-10 inline-flex items-center justify-center gap-2"
                title={`Se reembolsarán ${refundTokens} token${refundTokens === 1 ? "" : "s"}.`}
              >
                <FiXCircle />
                {busy ? "Cancelando..." : `Cancelar (${refundTokens} tokens)`}
              </button>
            ) : (
              <span className="text-xs text-muted-foreground">
                Cancelación disponible hasta 4 h antes. {/* no botón en historial ni fuera de ventana */}
              </span>
            )}
          </div>
        </div>

        {canceled && booking.canceledAt && (
          <p className="mt-2 text-xs text-muted-foreground">
            Cancelada el {fmtDate(booking.canceledAt)}
          </p>
        )}
      </motion.div>
    );
  }
}
