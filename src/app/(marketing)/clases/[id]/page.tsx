"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useParams } from "next/navigation";
import Link from "next/link";
import { motion, cubicBezier } from "framer-motion";
import {
  FiArrowLeft,
  FiEdit2,
  FiMessageCircle,
  FiSlash,
  FiTrash2,
  FiUserPlus,
  FiX,
} from "react-icons/fi";

const EASE = cubicBezier(0.22, 1, 0.36, 1);
const MX_TZ = "America/Mexico_City";
const MX_LOCALE: Intl.LocalesArgument = "es-MX";
const CANCEL_WINDOW_MIN = 240;

type Affiliation = "NONE" | "WELLHUB" | "TOTALPASS";

type UserLite = {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  affiliation?: Affiliation;
};

type InstructorLite = {
  id: string;
  name: string;
};

type ClassApi = {
  id: string;
  title: string;
  focus: string;
  date: string;
  durationMin: number;
  capacity: number;
  isCanceled: boolean;
  instructor: { id?: string; name: string };
  instructorId?: string;
  bookings: {
    id: string;
    quantity: number;
    status?: "ACTIVE" | "CANCELED";
    attended?: boolean;
    canceledAt?: string | null;
    user: {
      id: string;
      name: string;
      email: string;
      phone?: string | null;
      affiliation?: Affiliation;
    } | null;
    guestName?: string | null;
  }[];
  waitlist: {
    id: string;
    position: number;
    user: {
      id: string;
      name: string;
      email: string;
      phone?: string | null;
      affiliation?: Affiliation;
    };
  }[];
};

type AttendeeRow = {
  bookingId: string;
  name: string;
  email?: string;
  isGuest: boolean;
  attended: boolean;
  quantity: number;
  affiliation: Affiliation;
};

type CanceledRow = {
  bookingId: string;
  name: string;
  email?: string;
  phone?: string | null;
  affiliation: Affiliation;
  canceledAt?: string | null;
};

type WaitlistRow = {
  entryId: string;
  userId: string;
  name: string;
  email?: string;
  phone?: string | null;
  affiliation: Affiliation;
  position: number;
};

function fmtDateTimeMX(iso: string) {
  const date = new Date(iso);
  return {
    date: new Intl.DateTimeFormat(MX_LOCALE, {
      timeZone: MX_TZ,
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "2-digit",
    })
      .format(date)
      .replace(".", ""),
    time: new Intl.DateTimeFormat(MX_LOCALE, {
      timeZone: MX_TZ,
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).format(date),
  };
}

function hhmmFromISOInMX(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: MX_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function fmtTimeMX(iso: string) {
  return new Intl.DateTimeFormat(MX_LOCALE, {
    timeZone: MX_TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

function isLateCanceledBooking(classDateIso: string, canceledAt?: string | null) {
  if (!canceledAt) return false;

  const classTime = new Date(classDateIso).getTime();
  const canceledTime = new Date(canceledAt).getTime();

  if (Number.isNaN(classTime) || Number.isNaN(canceledTime)) return false;

  const minutesBeforeClass = Math.floor((classTime - canceledTime) / 60000);
  return minutesBeforeClass < CANCEL_WINDOW_MIN;
}

function getErrorMessage(payload: unknown, fallback: string) {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "message" in payload &&
    typeof (payload as { message?: unknown }).message === "string"
  ) {
    return (payload as { message: string }).message;
  }

  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof (payload as { error?: unknown }).error === "string"
  ) {
    return (payload as { error: string }).error;
  }

  return fallback;
}

async function readErrorMessage(res: Response, fallback: string) {
  const payload = await res.json().catch(() => null);
  return getErrorMessage(payload, fallback);
}

function affiliationBadgeClasses(affiliation: Affiliation) {
  if (affiliation === "WELLHUB") return "bg-pink-100 text-pink-700";
  if (affiliation === "TOTALPASS") return "bg-green-100 text-green-700";
  return "";
}

function AffiliationBadge({ affiliation }: { affiliation: Affiliation }) {
  if (affiliation === "NONE") return null;

  return (
    <span
      className={`rounded px-2 py-0.5 text-xs ${affiliationBadgeClasses(
        affiliation
      )}`}
    >
      {affiliation}
    </span>
  );
}

function formatPhoneLabel(phone?: string | null) {
  return phone?.trim() || "Sin telefono";
}

function toWhatsAppHref(phone?: string | null) {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return null;

  const normalized = digits.startsWith("00") ? digits.slice(2) : digits;
  const withCountryCode =
    normalized.length === 10 ? `52${normalized}` : normalized;

  if (withCountryCode.length < 11) return null;

  return `https://wa.me/${withCountryCode}`;
}

type EditModalProps = {
  open: boolean;
  onClose: () => void;
  cls: ClassApi;
  instructors: InstructorLite[];
  onSaved: () => Promise<void> | void;
};

function EditClassModal({
  open,
  onClose,
  cls,
  instructors,
  onSaved,
}: EditModalProps) {
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [title, setTitle] = useState(cls.title);
  const [focus, setFocus] = useState(cls.focus);
  const [instructorId, setInstructorId] = useState(
    cls.instructorId || cls.instructor?.id || ""
  );
  const [timeHHMM, setTimeHHMM] = useState(hhmmFromISOInMX(cls.date));
  const [durationMin, setDurationMin] = useState(cls.durationMin);
  const [capacity, setCapacity] = useState(cls.capacity);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setTitle(cls.title);
    setFocus(cls.focus);
    setInstructorId(cls.instructorId || cls.instructor?.id || "");
    setTimeHHMM(hhmmFromISOInMX(cls.date));
    setDurationMin(cls.durationMin);
    setCapacity(cls.capacity);
  }, [open, cls]);

  if (!open || !mounted) return null;

  async function save() {
    try {
      setBusy(true);
      setErr(null);

      const res = await fetch(`/api/admin/classes/${cls.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title: title.trim(),
          focus: focus.trim(),
          instructorId: instructorId || null,
          time: timeHHMM,
          durationMin,
          capacity,
        }),
      });

      if (!res.ok) {
        throw new Error(await readErrorMessage(res, "No se pudo guardar."));
      }

      await onSaved();
      onClose();
    } catch (error: unknown) {
      setErr(error instanceof Error ? error.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1, transition: { duration: 0.2, ease: EASE } }}
        className="relative w-full rounded-t-2xl bg-[color:var(--color-card)] p-5 shadow-xl md:w-[640px] md:rounded-2xl"
      >
        <div className="flex items-center gap-2">
          <h3 className="font-display text-lg font-bold">Modificar clase</h3>
          <button className="btn-outline ml-auto h-9 px-3" onClick={onClose}>
            <FiX /> Cerrar
          </button>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label className="text-sm font-semibold">Titulo</label>
            <input
              className="input mt-2"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Titulo de la clase"
            />
          </div>

          <div>
            <label className="text-sm font-semibold">Descripcion / Focus</label>
            <input
              className="input mt-2"
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              placeholder="Descripcion"
            />
          </div>

          <div>
            <label className="text-sm font-semibold">Coach</label>
            <select
              className="input mt-2"
              value={instructorId}
              onChange={(e) => setInstructorId(e.target.value)}
            >
              <option value="">Selecciona coach</option>
              {instructors.map((instructor) => (
                <option key={instructor.id} value={instructor.id}>
                  {instructor.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              Esto cambia el coach de la clase.
            </p>
          </div>

          <div>
            <label className="text-sm font-semibold">Hora (MX)</label>
            <input
              className="input mt-2"
              type="time"
              value={timeHHMM}
              onChange={(e) => setTimeHHMM(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Solo cambia la hora, no la fecha.
            </p>
          </div>

          <div>
            <label className="text-sm font-semibold">Duracion (minutos)</label>
            <input
              type="number"
              min={15}
              step={5}
              className="input mt-2"
              value={durationMin}
              onChange={(e) => setDurationMin(Number(e.target.value))}
            />
          </div>

          <div>
            <label className="text-sm font-semibold">Cupo maximo</label>
            <input
              type="number"
              min={1}
              className="input mt-2"
              value={capacity}
              onChange={(e) => setCapacity(Number(e.target.value))}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              No puede ser menor a los lugares ya ocupados.
            </p>
          </div>
        </div>

        {err && <div className="mt-4 text-sm text-red-600">{err}</div>}

        <div className="mt-6 flex justify-end gap-2">
          <button className="btn-primary h-10 px-4" onClick={save} disabled={busy}>
            {busy ? "Guardando..." : "Guardar cambios"}
          </button>
        </div>
      </motion.div>
    </div>,
    document.body
  );
}

export default function ClassAdminPage() {
  const { id } = useParams<{ id: string }>();

  const [cls, setCls] = useState<ClassApi | null>(null);
  const [instructors, setInstructors] = useState<InstructorLite[]>([]);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [searchResults, setSearchResults] = useState<UserLite[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserLite | null>(null);
  const [guestName, setGuestName] = useState("");
  const [editOpen, setEditOpen] = useState(false);

  async function reload() {
    if (!id) return;

    const res = await fetch(`/api/classes/${id}`, {
      credentials: "include",
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(await readErrorMessage(res, "No se pudo cargar la clase."));
    }

    setCls((await res.json()) as ClassApi);
  }

  useEffect(() => {
    if (!id) return;

    (async () => {
      try {
        await reload();

        const instructorsRes = await fetch("/api/admin/instructors", {
          credentials: "include",
        });

        if (instructorsRes.ok) {
          const payload = await instructorsRes.json().catch(() => ({}));
          setInstructors(payload.items ?? payload);
        }
      } catch (error) {
        alert(error instanceof Error ? error.message : "No se pudo cargar la clase.");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  useEffect(() => {
    if (!userDropdownOpen) return;

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        setSearchLoading(true);
        setSearchError(null);

        const params = new URLSearchParams({
          q: userSearch.trim(),
          limit: "20",
        });

        const res = await fetch(`/api/admin/users/search?${params.toString()}`, {
          credentials: "include",
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error(await readErrorMessage(res, "No se pudo buscar usuarios."));
        }

        const payload = (await res.json().catch(() => ({ items: [] }))) as {
          items?: UserLite[];
        };

        setSearchResults(payload.items ?? []);
      } catch (error) {
        if (controller.signal.aborted) return;
        setSearchResults([]);
        setSearchError(
          error instanceof Error ? error.message : "No se pudo buscar usuarios."
        );
      } finally {
        if (!controller.signal.aborted) {
          setSearchLoading(false);
        }
      }
    }, 300);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [userDropdownOpen, userSearch]);

  const attendees = useMemo<AttendeeRow[]>(() => {
    const bookings = cls?.bookings ?? [];

    return bookings
      .filter((booking) => (booking.status ?? "ACTIVE") === "ACTIVE")
      .map((booking) => ({
        bookingId: booking.id,
        name: booking.user?.name ?? booking.guestName ?? "Invitado",
        email: booking.user?.email,
        isGuest: !booking.user,
        attended: !!booking.attended,
        quantity: booking.quantity ?? 1,
        affiliation: booking.user?.affiliation ?? "NONE",
      }));
  }, [cls]);

  const canceledBookings = useMemo<CanceledRow[]>(() => {
    const bookings = cls?.bookings ?? [];

    return bookings
      .filter((booking) => booking.status === "CANCELED")
      .map((booking) => ({
        bookingId: booking.id,
        name: booking.user?.name ?? booking.guestName ?? "Invitado",
        email: booking.user?.email,
        phone: booking.user?.phone ?? null,
        affiliation: booking.user?.affiliation ?? "NONE",
        canceledAt: booking.canceledAt ?? null,
      }));
  }, [cls]);

  const waitlistEntries = useMemo<WaitlistRow[]>(() => {
    const waitlist = cls?.waitlist ?? [];

    return waitlist.map((entry) => ({
      entryId: entry.id,
      userId: entry.user.id,
      name: entry.user.name,
      email: entry.user.email,
      phone: entry.user.phone ?? null,
      affiliation: entry.user.affiliation ?? "NONE",
      position: entry.position,
    }));
  }, [cls]);

  const usedSpots = useMemo(
    () => attendees.reduce((sum, attendee) => sum + (attendee.quantity || 1), 0),
    [attendees]
  );

  const spotsLeft = useMemo(() => {
    if (!cls) return 0;
    return Math.max(0, cls.capacity - usedSpots);
  }, [cls, usedSpots]);

  const dateInfo = useMemo(() => (cls ? fmtDateTimeMX(cls.date) : null), [cls]);

  async function toggleAttendance(attendee: AttendeeRow) {
    setBusy(attendee.bookingId);

    try {
      const res = await fetch(`/api/admin/bookings/${attendee.bookingId}/attendance`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ attended: !attendee.attended }),
      });

      if (!res.ok) {
        throw new Error(await readErrorMessage(res, "No se pudo marcar asistencia."));
      }

      setCls((prev) =>
        prev
          ? {
              ...prev,
              bookings: prev.bookings.map((booking) =>
                booking.id === attendee.bookingId
                  ? { ...booking, attended: !attendee.attended }
                  : booking
              ),
            }
          : prev
      );
    } catch (error) {
      alert(
        error instanceof Error ? error.message : "No se pudo marcar asistencia."
      );
    } finally {
      setBusy(null);
    }
  }

  async function removeAttendee(attendee: AttendeeRow) {
    if (!confirm("Eliminar usuario de la clase?")) return;

    setBusy(attendee.bookingId);

    try {
      const res = await fetch(`/api/admin/bookings/${attendee.bookingId}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!res.ok) {
        throw new Error(await readErrorMessage(res, "No se pudo eliminar."));
      }

      await reload();
    } catch (error) {
      alert(error instanceof Error ? error.message : "No se pudo eliminar.");
    } finally {
      setBusy(null);
    }
  }

  async function addUser() {
    if (!selectedUserId) return;
    if (spotsLeft <= 0) {
      alert("No hay lugares disponibles.");
      return;
    }

    setBusy("ADD_USER");

    try {
      const res = await fetch(`/api/admin/classes/${id}/add-user`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ userId: selectedUserId }),
      });

      if (!res.ok) {
        throw new Error(await readErrorMessage(res, "No se pudo agregar el usuario."));
      }

      setSelectedUserId("");
      setSelectedUser(null);
      setUserSearch("");
      await reload();
    } catch (error) {
      alert(
        error instanceof Error ? error.message : "No se pudo agregar el usuario."
      );
    } finally {
      setBusy(null);
    }
  }

  async function addGuest() {
    if (!guestName.trim()) return;
    if (spotsLeft <= 0) {
      alert("No hay lugares disponibles.");
      return;
    }

    setBusy("ADD_GUEST");

    try {
      const res = await fetch(`/api/admin/classes/${id}/add-guest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: guestName.trim() }),
      });

      if (!res.ok) {
        throw new Error(await readErrorMessage(res, "No se pudo agregar invitado."));
      }

      setGuestName("");
      await reload();
    } catch (error) {
      alert(error instanceof Error ? error.message : "No se pudo agregar invitado.");
    } finally {
      setBusy(null);
    }
  }

  async function promoteWaitlist(entry: WaitlistRow) {
    if (spotsLeft <= 0) {
      alert("No hay lugares disponibles.");
      return;
    }

    setBusy(`PROMOTE_${entry.entryId}`);

    try {
      const res = await fetch(
        `/api/admin/classes/${id}/waitlist/${entry.entryId}/promote`,
        {
          method: "POST",
          credentials: "include",
        }
      );

      if (!res.ok) {
        throw new Error(
          await readErrorMessage(
            res,
            "No se pudo agregar el usuario desde la lista de espera."
          )
        );
      }

      await reload();
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "No se pudo agregar el usuario desde la lista de espera."
      );
    } finally {
      setBusy(null);
    }
  }

  async function cancelClass() {
    if (!cls) return;

    if (attendees.length > 0) {
      alert("Debes eliminar primero a los usuarios inscritos.");
      return;
    }

    if (!confirm("Cancelar esta clase?")) return;

    setBusy("CANCEL");

    try {
      const res = await fetch(`/api/admin/classes/${id}/cancel`, {
        method: "PATCH",
        credentials: "include",
      });

      if (!res.ok) {
        throw new Error(await readErrorMessage(res, "No se pudo cancelar."));
      }

      await reload();
    } catch (error) {
      alert(error instanceof Error ? error.message : "No se pudo cancelar.");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return <div className="section container-app">Cargando...</div>;
  }

  if (!cls) return null;

  return (
    <section className="section">
      <div className="container-app max-w-4xl">
        <Link
          href="/clases"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <FiArrowLeft /> Volver
        </Link>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE } }}
          className="mt-6 card p-6"
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h1 className="font-display text-2xl font-bold">
                {cls.title}
                {cls.isCanceled && (
                  <span className="ml-2 text-sm text-red-600">(Cancelada)</span>
                )}
              </h1>

              <p className="text-muted-foreground">
                {cls.focus} - Coach: {cls.instructor?.name}
              </p>

              {dateInfo && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {dateInfo.date} - {dateInfo.time} - {cls.durationMin} min
                </p>
              )}

              <p className="mt-1 text-sm">
                Cupo: {usedSpots}/{cls.capacity} -{" "}
                <span className="font-semibold">{spotsLeft} disponibles</span>
              </p>
            </div>

            <div className="flex gap-2">
              <button
                className="btn-outline h-10 px-4"
                onClick={() => setEditOpen(true)}
                disabled={busy !== null}
              >
                <FiEdit2 /> Modificar
              </button>

              <button
                className="btn-outline h-10 px-4 text-red-600"
                onClick={cancelClass}
                title={
                  attendees.length > 0
                    ? "Elimina primero a los usuarios inscritos"
                    : cls.isCanceled
                    ? "Ya esta cancelada"
                    : "Cancelar clase"
                }
              >
                <FiSlash /> Cancelar clase
              </button>
            </div>
          </div>
        </motion.div>

        <section className="mt-8">
          <h2 className="mb-4 font-display text-xl font-bold">Usuarios en clase</h2>

          <div className="grid gap-3">
            {attendees.map((attendee) => (
              <div
                key={attendee.bookingId}
                className="card flex items-center justify-between gap-4 p-4"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 truncate font-semibold">
                    {attendee.name}
                    {attendee.isGuest && (
                      <span className="rounded bg-gray-200 px-2 py-0.5 text-xs">
                        Invitado
                      </span>
                    )}
                    <AffiliationBadge affiliation={attendee.affiliation} />
                  </p>

                  {attendee.email && (
                    <p className="truncate text-xs text-muted-foreground">
                      {attendee.email}
                    </p>
                  )}

                  {attendee.quantity > 1 && (
                    <p className="text-xs text-muted-foreground">
                      Plazas: {attendee.quantity}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={attendee.attended}
                      onChange={() => toggleAttendance(attendee)}
                      disabled={busy === attendee.bookingId}
                      className="h-5 w-5 accent-green-600"
                      title="Marcar asistencia"
                    />
                    <span
                      className={
                        attendee.attended
                          ? "font-semibold text-green-600"
                          : "text-muted-foreground"
                      }
                    >
                      {attendee.attended ? "Asistio" : "No asistio"}
                    </span>
                  </label>

                  <button
                    onClick={() => removeAttendee(attendee)}
                    className="icon-btn text-red-600"
                    disabled={busy === attendee.bookingId}
                    title="Eliminar de clase"
                  >
                    <FiTrash2 />
                  </button>
                </div>
              </div>
            ))}

            {!attendees.length && (
              <div className="card p-6 text-center text-muted-foreground">
                No hay usuarios inscritos.
              </div>
            )}
          </div>
        </section>

        <section className="mt-8">
          <h2 className="mb-4 font-display text-xl font-bold">
            Usuarios que cancelaron
          </h2>

          <div className="grid gap-3">
            {canceledBookings.map((booking) => {
              const whatsappHref = toWhatsAppHref(booking.phone);
              const hasPenalty =
                (booking.affiliation === "WELLHUB" ||
                  booking.affiliation === "TOTALPASS") &&
                isLateCanceledBooking(cls.date, booking.canceledAt);
              const canceledTime = booking.canceledAt
                ? fmtTimeMX(booking.canceledAt)
                : null;

              return (
                <div
                  key={booking.bookingId}
                  className="card flex flex-col justify-between gap-4 p-4 md:flex-row md:items-center"
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-semibold">
                      <span className="truncate">{booking.name}</span>
                      <AffiliationBadge affiliation={booking.affiliation} />
                    </p>

                    {booking.email && (
                      <p className="truncate text-xs text-muted-foreground">
                        {booking.email}
                      </p>
                    )}

                    {canceledTime && (
                      <p className="text-xs text-muted-foreground">
                        {"Cancel\u00F3:"} {canceledTime}
                      </p>
                    )}

                    {hasPenalty && (
                      <p className="text-xs font-semibold text-red-600">
                        {"Debe $100 de penalizaci\u00F3n"}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn-outline h-10 px-4"
                      disabled={!whatsappHref || busy !== null}
                      onClick={() => {
                        if (whatsappHref) {
                          window.open(whatsappHref, "_blank", "noopener,noreferrer");
                        }
                      }}
                    >
                      <FiMessageCircle /> WhatsApp
                    </button>
                  </div>
                </div>
              );
            })}

            {!canceledBookings.length && (
              <div className="card p-6 text-center text-muted-foreground">
                No hay usuarios que cancelaron.
              </div>
            )}
          </div>
        </section>

        <section className="mt-8">
          <h2 className="mb-4 font-display text-xl font-bold">Lista de espera</h2>

          <div className="grid gap-3">
            {waitlistEntries.map((entry) => {
              const whatsappHref = toWhatsAppHref(entry.phone);
              const isPromoting = busy === `PROMOTE_${entry.entryId}`;

              return (
                <div
                  key={entry.entryId}
                  className="card flex flex-col justify-between gap-4 p-4 md:flex-row md:items-center"
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-semibold">
                      <span>#{entry.position}</span>
                      <span className="truncate">{entry.name}</span>
                      <span className="text-sm font-normal text-muted-foreground">
                        {formatPhoneLabel(entry.phone)}
                      </span>
                      <AffiliationBadge affiliation={entry.affiliation} />
                    </p>

                    {entry.email && (
                      <p className="truncate text-xs text-muted-foreground">
                        {entry.email}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn-outline h-10 px-4"
                      disabled={!whatsappHref || busy !== null}
                      onClick={() => {
                        if (whatsappHref) {
                          window.open(whatsappHref, "_blank", "noopener,noreferrer");
                        }
                      }}
                    >
                      <FiMessageCircle /> WhatsApp
                    </button>

                    <button
                      type="button"
                      className="btn-primary h-10 px-4"
                      disabled={
                        cls.isCanceled || spotsLeft <= 0 || (busy !== null && !isPromoting)
                      }
                      onClick={() => promoteWaitlist(entry)}
                    >
                      <FiUserPlus />
                      {isPromoting ? " Agregando..." : " Agregar a clase"}
                    </button>
                  </div>
                </div>
              );
            })}

            {!waitlistEntries.length && (
              <div className="card p-6 text-center text-muted-foreground">
                No hay usuarios en lista de espera.
              </div>
            )}
          </div>
        </section>

        <section className="mt-10">
          <h2 className="mb-4 font-display text-xl font-bold">Agregar usuario</h2>

          <div className="card grid gap-4 p-5 sm:grid-cols-2">
            <div className="relative">
              <p className="mb-2 font-semibold">Usuario registrado</p>

              <button
                type="button"
                onClick={() => setUserDropdownOpen((open) => !open)}
                disabled={cls.isCanceled || spotsLeft <= 0 || busy !== null}
                className="input flex w-full items-center justify-between"
              >
                <span className="min-w-0 text-left">
                  {selectedUser ? (
                    <span className="block">
                      <span className="block truncate font-medium">
                        {selectedUser.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {selectedUser.email}
                        {selectedUser.phone ? ` - ${selectedUser.phone}` : ""}
                      </span>
                    </span>
                  ) : (
                    "Seleccionar usuario"
                  )}
                </span>
                <span className="ml-3 text-xs opacity-60">v</span>
              </button>

              {userDropdownOpen && (
                <div className="absolute z-20 mt-2 w-full rounded-xl border bg-[color:var(--color-card)] shadow-lg">
                  <div className="p-2">
                    <input
                      className="input"
                      placeholder="Buscar por nombre, correo o telefono"
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      autoFocus
                    />
                    <p className="mt-2 text-xs text-muted-foreground">
                      Se muestran hasta 20 resultados.
                    </p>
                  </div>

                  <div className="max-h-64 overflow-y-auto border-t">
                    {searchLoading && (
                      <div className="px-3 py-2 text-sm text-muted-foreground">
                        Buscando...
                      </div>
                    )}

                    {!searchLoading && searchError && (
                      <div className="px-3 py-2 text-sm text-red-600">
                        {searchError}
                      </div>
                    )}

                    {!searchLoading && !searchError && searchResults.length === 0 && (
                      <div className="px-3 py-2 text-sm text-muted-foreground">
                        Sin resultados
                      </div>
                    )}

                    {!searchLoading &&
                      !searchError &&
                      searchResults.map((user) => (
                        <button
                          key={user.id}
                          type="button"
                          className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-[color:var(--color-muted)]"
                          onClick={() => {
                            setSelectedUserId(user.id);
                            setSelectedUser(user);
                            setUserSearch("");
                            setUserDropdownOpen(false);
                          }}
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-medium">
                              {user.name}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {user.email}
                              {user.phone ? ` - ${user.phone}` : ""}
                            </span>
                          </span>
                          <AffiliationBadge affiliation={user.affiliation ?? "NONE"} />
                        </button>
                      ))}
                  </div>
                </div>
              )}

              <button
                className="btn-primary mt-3 w-full"
                onClick={addUser}
                disabled={
                  !selectedUserId || cls.isCanceled || spotsLeft <= 0 || busy !== null
                }
              >
                <FiUserPlus /> Agregar
              </button>
            </div>

            <div>
              <p className="mb-2 font-semibold">Invitado</p>
              <input
                className="input"
                placeholder="Nombre del invitado"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                disabled={cls.isCanceled || spotsLeft <= 0 || busy !== null}
              />
              <button
                className="btn-outline mt-3 w-full"
                onClick={addGuest}
                disabled={
                  !guestName.trim() || cls.isCanceled || spotsLeft <= 0 || busy !== null
                }
              >
                <FiUserPlus /> Agregar invitado
              </button>
            </div>
          </div>
        </section>
      </div>

      {cls && (
        <EditClassModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          cls={cls}
          instructors={instructors}
          onSaved={reload}
        />
      )}
    </section>
  );
}
