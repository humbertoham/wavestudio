// src/app/mis-clases/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion, cubicBezier } from "framer-motion";
import {
  FiCalendar,
  FiClock,
  FiMapPin,
  FiUser,
  FiArrowLeft,
  FiXCircle,
} from "react-icons/fi";

const EASE = cubicBezier(0.22, 1, 0.36, 1);
const MX_TZ = "America/Mexico_City";
const CANCEL_WINDOW_MIN = 240; // 4h

type BookingStatus = "ACTIVE" | "CANCELED";

type Instructor = {
  id: string;
  name: string;
};

type ClassLite = {
  id: string;
  title: string;
  focus: string;
  date: string;
  durationMin: number;
  creditCost?: number;
  location?: string | null;
  instructor: Instructor;
};

type Booking = {
  id: string;
  status: BookingStatus;
  createdAt: string;
  canceledAt?: string | null;
  quantity: number;
  class: ClassLite;
};

/**
 * =========================
 * Paquetes
 * =========================
 */

type PackLite = {
  id: string;
  name: string;
  classes: number;
  price: number;
  classesLabel?: string | null;
};

type PackPurchase = {
  id: string;
  createdAt: string;
  expiresAt: string;
  classesLeft: number;
  pack: PackLite;
};

export default function MyClassesPage() {
  const [items, setItems] = useState<Booking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lateCancelBooking, setLateCancelBooking] = useState<Booking | null>(null);

  const [packs, setPacks] = useState<PackPurchase[] | null>(null);
  const [packsError, setPacksError] = useState<string | null>(null);

  /**
   * =========================
   * Fetch bookings
   * =========================
   */
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
        setItems([]);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  /**
   * =========================
   * Fetch packs (API pendiente)
   * =========================
   */
  useEffect(() => {
    let mounted = true;
    (async () => {
      setPacksError(null);
      try {
        const res = await fetch("/api/users/me/packs", {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: PackPurchase[] = await res.json();
        if (!mounted) return;
        setPacks(data.slice(0, 5));
      } catch (e) {
        console.error(e);
        if (!mounted) return;
        setPacksError("No se pudieron cargar tus paquetes.");
        setPacks([]);
      }
    })();
    return () => {
      mounted = false;
    };
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

  const minutesUntil = (d: Date) =>
    Math.floor((d.getTime() - Date.now()) / 60000);

  const canCancel = (b: Booking) => {
    if (b.status === "CANCELED") return false;
    const start = new Date(b.class.date);
    return minutesUntil(start) >= CANCEL_WINDOW_MIN;
  };

  const cancelBooking = async (b: Booking) => {
    try {
      setBusyId(b.id);
      const res = await fetch(`/api/bookings/${b.id}/cancel`, {
        method: "PATCH",
      });
      if (!res.ok) {
        const { code, message } = await res.json().catch(() => ({}));
        const msg =
          code === "WINDOW_CLOSED"
            ? "La ventana de cancelación ya cerró."
            : message || "No se pudo cancelar la clase.";
        throw new Error(msg);
      }
      const updated: Booking = await res.json();
      setItems((cur) =>
        cur ? cur.map((x) => (x.id === updated.id ? updated : x)) : cur
      );
    } catch (e: any) {
      alert(e?.message || "No se pudo cancelar la clase.");
    } finally {
      setBusyId(null);
    }
  };

  const isExpired = (p: PackPurchase) =>
    new Date(p.expiresAt).getTime() < Date.now();

  return (
    <section className="section">
      <div className="container-app">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{
            opacity: 1,
            y: 0,
            transition: { duration: 0.6, ease: EASE },
          }}
          className="mx-auto max-w-3xl"
        >
          <div className="mb-4">
            <Link
              href="/clases"
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <FiArrowLeft /> Volver al calendario
            </Link>
          </div>

          <h1 className="font-display text-3xl font-extrabold">Mis clases y paquetes</h1>
          <p className="mt-2 text-muted-foreground">
            Aquí verás tus reservas y tus paquetes comprados.
          </p>

          {error && (
            <div className="mt-6 text-sm text-red-600">
              {error} Inténtalo de nuevo más tarde.
            </div>
          )}

          {!items && !error && (
            <div className="mt-8 space-y-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="card p-5 animate-pulse">
                  <div className="h-5 w-2/3 bg-muted rounded" />
                  <div className="mt-2 h-4 w-1/3 bg-muted rounded" />
                </div>
              ))}
            </div>
          )}

          {items && (
            <>
              {/* Próximas */}
              <section className="mt-8">
                <h2 className="font-display text-xl font-bold">Próximas</h2>
                <div className="mt-4 grid gap-4">
                  {upcoming.length ? (
                    upcoming.map((b, idx) => (
                      <BookingCard
                        key={b.id}
                        booking={b}
                        idx={idx}
                        onCancel={() => cancelBooking(b)}
                        busy={busyId === b.id}
                      />
                    ))
                  ) : (
                    <div className="card p-8 text-center text-muted-foreground">
                      No tienes reservas próximas.
                    </div>
                  )}
                </div>
              </section>

              {/* Historial */}
              <section className="mt-10">
                <h2 className="font-display text-xl font-bold">Historial</h2>
                <div className="mt-4 grid gap-4">
                  {past.slice(0, 5).map((b, idx) => (
                    <BookingCard
                      key={b.id}
                      booking={b}
                      idx={idx}
                      muted
                    />
                  ))}
                </div>
              </section>

              {/* Paquetes */}
              <section className="mt-10">
                <h2 className="font-display text-xl font-bold">
                  Últimos paquetes comprados
                </h2>

                {!packs && !packsError && (
                  <div className="mt-4 space-y-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="card p-5 animate-pulse">
                        <div className="h-5 w-1/2 bg-muted rounded" />
                        <div className="mt-2 h-4 w-1/3 bg-muted rounded" />
                      </div>
                    ))}
                  </div>
                )}

                {packsError && (
                  <p className="mt-4 text-sm text-red-600">{packsError}</p>
                )}

                {packs && (
                  <div className="mt-4 grid gap-4">
                    {packs.length ? (
                      packs.map((p, idx) => {
                        const expired = isExpired(p);
                        return (
                          <motion.div
                            key={p.id}
                            initial={{ opacity: 0, y: 14 }}
                            animate={{
                              opacity: 1,
                              y: 0,
                              transition: {
                                delay: 0.04 * idx,
                                ease: EASE,
                              },
                            }}
                            className={`card p-5 ${
                              expired ? "opacity-70 ring-1 ring-muted" : ""
                            }`}
                          >
                            <div className="flex justify-between gap-4">
                              <div>
                                <h3 className="font-display text-lg font-bold">
                                  {p.pack.name}
                                </h3>
                                <p className="mt-1 text-sm text-muted-foreground">
                                  {p.pack.classesLabel ??
                                    `${p.pack.classes} clases`}{" "}
                                  ·{" "}
                                  <span className="font-medium">
                                    {p.classesLeft} restantes
                                  </span>
                                </p>
                                <div className="mt-2 text-xs text-muted-foreground">
                                  Comprado: {fmtDate(p.createdAt)}
                                  <br />
                                  Expira: {fmtDate(p.expiresAt)}
                                </div>
                              </div>

                              <span
                                className={`text-xs font-semibold uppercase ${
                                  expired
                                    ? "text-red-600"
                                    : "text-emerald-600"
                                }`}
                              >
                                {expired ? "Expirado" : "Activo"}
                              </span>
                            </div>
                          </motion.div>
                        );
                      })
                    ) : (
                      <div className="card p-8 text-center text-muted-foreground">
                        Aún no has comprado paquetes.
                      </div>
                    )}
                  </div>
                )}
              </section>
            </>
          )}
        </motion.div>
      </div>
      {lateCancelBooking && (
  <LateCancelModal
    booking={lateCancelBooking}
    onClose={() => setLateCancelBooking(null)}
    onConfirm={async () => {
      await cancelBooking(lateCancelBooking);
      setLateCancelBooking(null);
    }}
  />
)}

    </section>
  );

  /**
   * =========================
   * Booking Card
   * =========================
   */
  function BookingCard({
    booking,
    idx,
    muted = false,
    onCancel,
    busy = false,
  }: {
    booking: Booking;
    idx: number;
    muted?: boolean;
    onCancel?: () => void;
    busy?: boolean;
  }) {
    const cls = booking.class;
    const canceled = booking.status === "CANCELED";
    const spots = booking.quantity ?? 1;
    const cost = cls.creditCost ?? 1;
    const refundTokens = spots * cost;
    const start = new Date(cls.date);
    const lateCancel = minutesUntil(start) < CANCEL_WINDOW_MIN;
    return (
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{
          opacity: 1,
          y: 0,
          scale: 1,
          transition: { duration: 0.45, delay: 0.04 * idx, ease: EASE },
        }}
        className={`card p-5 ${muted ? "opacity-80" : ""} ${
          canceled ? "ring-1 ring-red-200" : ""
        }`}
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
          <div>
            <h3 className="font-display text-lg font-bold">
              {cls.title}{" "}
              <span className="text-muted-foreground font-normal">
                · {cls.focus}
              </span>
            </h3>

            <div className="mt-1 flex flex-wrap gap-4 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <FiCalendar /> {fmtDate(cls.date)}
              </span>
              <span className="inline-flex items-center gap-1">
                <FiClock /> {fmtDuration(cls.durationMin)}
              </span>
              {cls.location && (
                <span className="inline-flex items-center gap-1">
                  <FiMapPin /> {cls.location}
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                <FiUser /> {cls.instructor.name}
              </span>
            </div>
          </div>

          <div className="mt-3 sm:mt-0 sm:text-right">
            {canceled ? (
  <span className="text-xs font-semibold uppercase text-red-600">
    Cancelada
  </span>
) : (
  <button
    onClick={() => {
  if (lateCancel) {
    setLateCancelBooking(booking);
  } else {
    onCancel?.();
  }
}}

    disabled={busy}
    className="btn-outline h-10 inline-flex items-center gap-2"
  >
    <FiXCircle />
    {busy
  ? "Cancelando..."
  : lateCancel
  ? "Cancelar (sin reembolso)"
  : `Cancelar (${refundTokens})`}

  </button>
)}

          </div>
        </div>
      </motion.div>
    );
  }
}

function LateCancelModal({
  booking,
  onClose,
  onConfirm,
}: {
  booking: Booking;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.95, y: 20, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        transition={{ duration: 0.25 }}
        className="card w-full max-w-md p-6"
      >
        <h3 className="font-display text-xl font-bold">
          Cancelación tardía
        </h3>

        <p className="mt-3 text-sm text-muted-foreground">
          Estás cancelando la clase:
        </p>

        <p className="mt-1 font-semibold">
          {booking.class.title} · {booking.class.focus}
        </p>

        <p className="mt-4 text-sm text-red-600">
          Esta cancelación es con menos de 4 horas de anticipación.
          <br />
          No se te regresarán los créditos.
        </p>

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="btn-outline h-10"
          >
            Volver
          </button>

          <button
            onClick={onConfirm}
            className="h-10 px-4 rounded-md bg-red-600 text-white hover:bg-red-700 transition"
          >
            Confirmar cancelación
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}