// src/app/mis-clases/page.tsx
"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cubicBezier, motion } from "framer-motion";
import useSWR, { type SWRResponse } from "swr";
import {
  FiArrowLeft,
  FiCalendar,
  FiClock,
  FiMapPin,
  FiUser,
  FiXCircle,
} from "react-icons/fi";
import { MyClassesAccessState } from "@/components/my-classes/MyClassesAccessState";
import { SectionPagination } from "@/components/ui/SectionPagination";
import {
  parseMyClassesPage,
  type PaginatedResponse,
  updatePaginationSearchParams,
} from "@/lib/my-classes-pagination";
import { useSession } from "@/lib/useSession";

const EASE = cubicBezier(0.22, 1, 0.36, 1);
const MX_TZ = "America/Mexico_City";
const CANCEL_WINDOW_MIN = 240;

type BookingStatus = "ACTIVE" | "CANCELED";
type Affiliation = "NONE" | "WELLHUB" | "TOTALPASS";
type PageParam = "upcomingPage" | "historyPage" | "packagesPage";

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

async function fetchPaginated<T>(url: string): Promise<PaginatedResponse<T>> {
  const response = await fetch(url, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    credentials: "include",
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<PaginatedResponse<T>>;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("es-MX", {
    timeZone: MX_TZ,
    weekday: "long",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes
    ? `${hours}h ${remainingMinutes}m`
    : `${hours}h`;
}

function SectionSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="mt-4 space-y-3" aria-label="Cargando contenido">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="card animate-pulse p-5">
          <div className="h-5 w-2/3 rounded bg-muted" />
          <div className="mt-2 h-4 w-1/3 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

export default function MyClassesPage() {
  const { isAuthenticated, isLoading } = useSession();

  return (
    <MyClassesAccessState
      isAuthenticated={isAuthenticated}
      isLoading={isLoading}
    >
      <Suspense fallback={<SectionSkeleton rows={4} />}>
        <AuthenticatedMyClassesPage />
      </Suspense>
    </MyClassesAccessState>
  );
}

function AuthenticatedMyClassesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lateCancelBooking, setLateCancelBooking] = useState<Booking | null>(null);
  const [affiliation, setAffiliation] = useState<Affiliation>("NONE");

  const upcomingPage = parseMyClassesPage(searchParams.get("upcomingPage"));
  const historyPage = parseMyClassesPage(searchParams.get("historyPage"));
  const packagesPage = parseMyClassesPage(searchParams.get("packagesPage"));

  const upcoming = useSWR<PaginatedResponse<Booking>>(
    `/api/users/me/bookings?section=upcoming&page=${upcomingPage}`,
    fetchPaginated<Booking>,
    { keepPreviousData: true, shouldRetryOnError: false }
  );
  const history = useSWR<PaginatedResponse<Booking>>(
    `/api/users/me/bookings?section=history&page=${historyPage}`,
    fetchPaginated<Booking>,
    { keepPreviousData: true, shouldRetryOnError: false }
  );
  const packages = useSWR<PaginatedResponse<PackPurchase>>(
    `/api/users/me/packs?page=${packagesPage}`,
    fetchPaginated<PackPurchase>,
    { keepPreviousData: true, shouldRetryOnError: false }
  );

  const changePage = useCallback(
    (key: PageParam, page: number) => {
      const query = updatePaginationSearchParams(searchParams, key, page);
      router.push(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  useEffect(() => {
    const normalizedPages = [
      {
        key: "upcomingPage",
        requested: upcomingPage,
        actual:
          upcoming.error || upcoming.isValidating
            ? undefined
            : upcoming.data?.page,
      },
      {
        key: "historyPage",
        requested: historyPage,
        actual:
          history.error || history.isValidating ? undefined : history.data?.page,
      },
      {
        key: "packagesPage",
        requested: packagesPage,
        actual:
          packages.error || packages.isValidating
            ? undefined
            : packages.data?.page,
      },
    ] as const;
    let query = searchParams.toString();
    let changed = false;

    for (const { key, requested, actual } of normalizedPages) {
      if (actual != null && actual !== requested) {
        query = updatePaginationSearchParams(query, key, actual);
        changed = true;
      }
    }

    if (changed) {
      router.replace(`${pathname}${query ? `?${query}` : ""}`, {
        scroll: false,
      });
    }
  }, [
    history.data?.page,
    history.error,
    history.isValidating,
    historyPage,
    packages.data?.page,
    packages.error,
    packages.isValidating,
    packagesPage,
    pathname,
    router,
    searchParams,
    upcoming.data?.page,
    upcoming.error,
    upcoming.isValidating,
    upcomingPage,
  ]);

  useEffect(() => {
    let mounted = true;

    void (async () => {
      try {
        const response = await fetch("/api/users/me/tokens", {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          credentials: "include",
        });
        if (!response.ok) return;

        const data = (await response.json().catch(() => ({}))) as {
          affiliation?: Affiliation;
        };
        if (!mounted) return;

        if (
          data.affiliation === "NONE" ||
          data.affiliation === "WELLHUB" ||
          data.affiliation === "TOTALPASS"
        ) {
          setAffiliation(data.affiliation);
        }
      } catch (error) {
        console.error(error);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void upcoming.mutate();
      void history.mutate();
    }, 60_000);

    return () => window.clearInterval(intervalId);
  }, [history.mutate, upcoming.mutate]);

  const cancelBooking = async (booking: Booking) => {
    try {
      setBusyId(booking.id);
      const response = await fetch(`/api/bookings/${booking.id}/cancel`, {
        method: "PATCH",
      });
      if (!response.ok) {
        const { code, message } = await response.json().catch(() => ({}));
        const fallback =
          code === "WINDOW_CLOSED"
            ? "La ventana de cancelación ya cerró."
            : message || "No se pudo cancelar la clase.";
        throw new Error(fallback);
      }

      await response.json();
      await Promise.all([upcoming.mutate(), history.mutate()]);
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "No se pudo cancelar la clase."
      );
    } finally {
      setBusyId(null);
    }
  };

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

          <h1 className="font-display text-3xl font-extrabold">
            Mis clases y paquetes
          </h1>
          <p className="mt-2 text-muted-foreground">
            Aquí verás tus reservas y tus paquetes comprados.
          </p>

          <BookingSection
            className="mt-8"
            heading="Próximas"
            label="próximas reservas"
            emptyMessage="No tienes reservas próximas."
            errorMessage="No se pudieron cargar tus próximas reservas. Inténtalo de nuevo más tarde."
            resource={upcoming}
            affiliation={affiliation}
            busyId={busyId}
            onCancel={cancelBooking}
            onLateCancel={setLateCancelBooking}
            onPageChange={(page) => changePage("upcomingPage", page)}
          />

          <BookingSection
            className="mt-10"
            heading="Historial"
            label="historial"
            emptyMessage="Aún no tienes clases en tu historial."
            errorMessage="No se pudo cargar tu historial. Inténtalo de nuevo más tarde."
            resource={history}
            affiliation={affiliation}
            muted
            onPageChange={(page) => changePage("historyPage", page)}
          />

          <PackagesSection
            resource={packages}
            onPageChange={(page) => changePage("packagesPage", page)}
          />
        </motion.div>
      </div>

      {lateCancelBooking && (
        <LateCancelModal
          booking={lateCancelBooking}
          affiliation={affiliation}
          onClose={() => setLateCancelBooking(null)}
          onConfirm={async () => {
            await cancelBooking(lateCancelBooking);
            setLateCancelBooking(null);
          }}
        />
      )}
    </section>
  );
}

type BookingResource = SWRResponse<PaginatedResponse<Booking>, Error>;

function BookingSection({
  className,
  heading,
  label,
  emptyMessage,
  errorMessage,
  resource,
  affiliation,
  busyId,
  muted = false,
  onCancel,
  onLateCancel,
  onPageChange,
}: {
  className: string;
  heading: string;
  label: string;
  emptyMessage: string;
  errorMessage: string;
  resource: BookingResource;
  affiliation: Affiliation;
  busyId?: string | null;
  muted?: boolean;
  onCancel?: (booking: Booking) => void;
  onLateCancel?: (booking: Booking) => void;
  onPageChange: (page: number) => void;
}) {
  const headingId = `${label.replaceAll(" ", "-")}-heading`;

  return (
    <section className={className} aria-labelledby={headingId}>
      <SectionHeading
        id={headingId}
        title={heading}
        isUpdating={Boolean(resource.data && resource.isValidating)}
      />

      {!resource.data && !resource.error && <SectionSkeleton />}
      {resource.error && (
        <p className="mt-4 text-sm text-red-600" role="alert">
          {errorMessage}
        </p>
      )}
      {resource.data && (
        <>
          <div className="mt-4 grid gap-4">
            {resource.data.items.length ? (
              resource.data.items.map((booking, index) => (
                <BookingCard
                  key={booking.id}
                  booking={booking}
                  idx={index}
                  muted={muted}
                  affiliation={affiliation}
                  busy={busyId === booking.id}
                  onCancel={onCancel ? () => onCancel(booking) : undefined}
                  onLateCancel={
                    onLateCancel ? () => onLateCancel(booking) : undefined
                  }
                />
              ))
            ) : (
              <div className="card p-8 text-center text-muted-foreground">
                {emptyMessage}
              </div>
            )}
          </div>
          <SectionPagination
            label={label}
            page={resource.data.page}
            totalPages={resource.data.totalPages}
            isLoading={resource.isValidating}
            onPageChange={onPageChange}
          />
        </>
      )}
    </section>
  );
}

function PackagesSection({
  resource,
  onPageChange,
}: {
  resource: SWRResponse<PaginatedResponse<PackPurchase>, Error>;
  onPageChange: (page: number) => void;
}) {
  return (
    <section className="mt-10" aria-labelledby="packages-heading">
      <SectionHeading
        id="packages-heading"
        title="Paquetes comprados"
        isUpdating={Boolean(resource.data && resource.isValidating)}
      />

      {!resource.data && !resource.error && <SectionSkeleton />}
      {resource.error && (
        <p className="mt-4 text-sm text-red-600" role="alert">
          No se pudieron cargar tus paquetes. Inténtalo de nuevo más tarde.
        </p>
      )}
      {resource.data && (
        <>
          <div className="mt-4 grid gap-4">
            {resource.data.items.length ? (
              resource.data.items.map((purchase, index) => (
                <PackCard key={purchase.id} purchase={purchase} idx={index} />
              ))
            ) : (
              <div className="card p-8 text-center text-muted-foreground">
                Aún no has comprado paquetes.
              </div>
            )}
          </div>
          <SectionPagination
            label="paquetes comprados"
            page={resource.data.page}
            totalPages={resource.data.totalPages}
            isLoading={resource.isValidating}
            onPageChange={onPageChange}
          />
        </>
      )}
    </section>
  );
}

function SectionHeading({
  id,
  title,
  isUpdating,
}: {
  id: string;
  title: string;
  isUpdating: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 id={id} className="font-display text-xl font-bold">
        {title}
      </h2>
      {isUpdating && (
        <span className="text-xs text-muted-foreground" role="status">
          Actualizando…
        </span>
      )}
    </div>
  );
}

function PackCard({ purchase, idx }: { purchase: PackPurchase; idx: number }) {
  const expired = new Date(purchase.expiresAt).getTime() < Date.now();

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{
        opacity: 1,
        y: 0,
        transition: { delay: 0.04 * idx, ease: EASE },
      }}
      className={`card p-5 ${expired ? "opacity-70 ring-1 ring-muted" : ""}`}
    >
      <div className="flex justify-between gap-4">
        <div>
          <h3 className="font-display text-lg font-bold">
            {purchase.pack.name}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {purchase.pack.classesLabel ?? `${purchase.pack.classes} clases`} ·{" "}
            <span className="font-medium">
              {purchase.classesLeft} restantes
            </span>
          </p>
          <div className="mt-2 text-xs text-muted-foreground">
            Comprado: {formatDate(purchase.createdAt)}
            <br />
            Expira: {formatDate(purchase.expiresAt)}
          </div>
        </div>

        <span
          className={`text-xs font-semibold uppercase ${
            expired ? "text-red-600" : "text-emerald-600"
          }`}
        >
          {expired ? "Expirado" : "Activo"}
        </span>
      </div>
    </motion.div>
  );
}

function BookingCard({
  booking,
  idx,
  muted = false,
  busy = false,
  affiliation,
  onCancel,
  onLateCancel,
}: {
  booking: Booking;
  idx: number;
  muted?: boolean;
  busy?: boolean;
  affiliation: Affiliation;
  onCancel?: () => void;
  onLateCancel?: () => void;
}) {
  const classItem = booking.class;
  const canceled = booking.status === "CANCELED";
  const spots = booking.quantity ?? 1;
  const cost = classItem.creditCost ?? 1;
  const refundTokens = spots * cost;
  const minutesUntilStart = Math.floor(
    (new Date(classItem.date).getTime() - Date.now()) / 60_000
  );
  const lateCancel = minutesUntilStart < CANCEL_WINDOW_MIN;
  const hasPenalty = affiliation === "WELLHUB" || affiliation === "TOTALPASS";

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
            {classItem.title}{" "}
            <span className="font-normal text-muted-foreground">
              · {classItem.focus}
            </span>
          </h3>

          <div className="mt-1 flex flex-wrap gap-4 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <FiCalendar /> {formatDate(classItem.date)}
            </span>
            <span className="inline-flex items-center gap-1">
              <FiClock /> {formatDuration(classItem.durationMin)}
            </span>
            {classItem.location && (
              <span className="inline-flex items-center gap-1">
                <FiMapPin /> {classItem.location}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <FiUser /> {classItem.instructor.name}
            </span>
          </div>
        </div>

        <div className="mt-3 sm:mt-0 sm:text-right">
          {canceled ? (
            <span className="text-xs font-semibold uppercase text-red-600">
              Cancelada
            </span>
          ) : onCancel ? (
            <button
              type="button"
              onClick={() => (lateCancel ? onLateCancel?.() : onCancel())}
              disabled={busy}
              className="btn-outline inline-flex h-10 items-center gap-2"
            >
              <FiXCircle />
              {busy
                ? "Cancelando..."
                : lateCancel
                  ? hasPenalty
                    ? "Cancelar ($100 penalización)"
                    : "Cancelar (sin reembolso)"
                  : `Cancelar (${refundTokens})`}
            </button>
          ) : null}
        </div>
      </div>
    </motion.div>
  );
}

function LateCancelModal({
  booking,
  affiliation,
  onClose,
  onConfirm,
}: {
  booking: Booking;
  affiliation: Affiliation;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const hasPenalty = affiliation === "WELLHUB" || affiliation === "TOTALPASS";

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
        role="dialog"
        aria-modal="true"
        aria-labelledby="late-cancel-title"
      >
        <h3 id="late-cancel-title" className="font-display text-xl font-bold">
          Ups, estás fuera del tiempo de cancelación
        </h3>

        <p className="mt-3 text-sm text-muted-foreground">
          Estás cancelando la clase:
        </p>
        <p className="mt-1 font-semibold">
          {booking.class.title} · {booking.class.focus}
        </p>

        <p className="mt-4 text-sm text-red-600">
          Faltan menos de 4 horas para la clase.
          <br />
          {hasPenalty ? (
            <>
              Esta cancelación podría generar un cargo de $100 MXN por
              cancelación tardía.
              <br />
              Nuestro equipo se pondrá en contacto contigo para realizar el
              pago.
              <br />
              Mientras tanto, tu cuenta quedará temporalmente bloqueada para
              nuevas reservas.
            </>
          ) : (
            <>
              Este crédito no podrá recuperarse debido a la cancelación tardía.
            </>
          )}
          <br />
          ¡Gracias por ayudarnos a respetar los espacios de cada clase!
        </p>

        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="btn-outline h-10">
            Volver
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="h-10 rounded-md bg-red-600 px-4 text-white transition hover:bg-red-700"
          >
            Confirmar cancelación
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
