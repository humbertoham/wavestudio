"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { motion, cubicBezier } from "framer-motion";
import {
  FiArrowLeft,
  FiTrash2,
  FiUserPlus,
  FiSlash,
  FiEdit2,
  FiX,
} from "react-icons/fi";

const EASE = cubicBezier(0.22, 1, 0.36, 1);
const MX_TZ = "America/Mexico_City";
const MX_LOCALE: Intl.LocalesArgument = "es-MX";

/* ======================
   Types
   ====================== */

type UserLite = {
  id: string;
  name: string;
  credits: number;
};

type InstructorLite = {
  id: string;
  name: string;
};

type ClassApi = {
  id: string;
  title: string;
  focus: string;
  date: string; // ISO (Class.date)
  durationMin: number;
  capacity: number;
  isCanceled: boolean;
  instructor: { id?: string; name: string };
  instructorId?: string;

  bookings: {
    id: string;
    quantity: number;
    status?: "ACTIVE" | "CANCELED";
    attended?: boolean; // <- si no existe en backend, vendrá undefined
    user: { id: string; name: string; email: string } | null; // null si invitado (solo si lo soportas)
    guestName?: string; // si manejas invitados sin user
  }[];
};

type AttendeeRow = {
  bookingId: string;
  name: string;
  email?: string;
  isGuest: boolean;
  attended: boolean;
  quantity: number;
};

function fmtDateTimeMX(iso: string) {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat(MX_LOCALE, {
    timeZone: MX_TZ,
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "2-digit",
  })
    .format(d)
    .replace(".", "");
  const time = new Intl.DateTimeFormat(MX_LOCALE, {
    timeZone: MX_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(d);
  return { date, time };
}

function hhmmFromISOInMX(iso: string) {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: MX_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return parts; // "HH:MM"
}

/* ======================
   Edit Modal
   ====================== */

type EditModalProps = {
  open: boolean;
  onClose: () => void;
  cls: ClassApi;
  instructors: InstructorLite[];
  onSaved: (next: ClassApi) => void;
};

function EditClassModal({ open, onClose, cls, instructors, onSaved }: EditModalProps) {
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
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }

      // esperamos que el backend regrese la clase actualizada
      const next = (await res.json().catch(() => null)) as ClassApi | null;
      if (next) onSaved(next);
      onClose();
    } catch (e: any) {
      setErr(e?.message || "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1, transition: { duration: 0.2, ease: EASE } }}
        className="relative w-full md:w-[640px] rounded-t-2xl md:rounded-2xl bg-[color:var(--color-card)] p-5 shadow-xl"
      >
        <div className="flex items-center gap-2">
          <h3 className="font-display text-lg font-bold">Modificar clase</h3>
          <button className="ml-auto btn-outline h-9 px-3" onClick={onClose}>
            <FiX /> Cerrar
          </button>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label className="text-sm font-semibold">Título</label>
            <input
              className="input mt-2"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Título de la clase"
            />
          </div>

          <div>
            <label className="text-sm font-semibold">Descripción / Focus</label>
            <input
              className="input mt-2"
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              placeholder="Descripción"
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
              {instructors.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              Esto cambia el coach (instructor) de la clase.
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
              Restricción: no cambia la fecha, solo la hora.
            </p>
          </div>
          <div>
  <label className="text-sm font-semibold">Duración (minutos)</label>
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
  <label className="text-sm font-semibold">Cupo máximo</label>
  <input
    type="number"
    min={1}
    className="input mt-2"
    value={capacity}
    onChange={(e) => setCapacity(Number(e.target.value))}
  />
  <p className="mt-1 text-xs text-muted-foreground">
    No puede ser menor a los spots ya ocupados.
  </p>
</div>

        </div>

        {err && <div className="mt-4 text-sm text-red-600">{err}</div>}

        <div className="mt-6 flex gap-2 justify-end">
         
          <button className="btn-primary h-10 px-4" onClick={save} disabled={busy}>
            {busy ? "Guardando..." : "Guardar cambios"}
          </button>
        </div>
      </motion.div>
    </div>,
    document.body
  );
}

/* ======================
   Page
   ====================== */

export default function ClassAdminPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [cls, setCls] = useState<ClassApi | null>(null);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [instructors, setInstructors] = useState<InstructorLite[]>([]);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const [selectedUserId, setSelectedUserId] = useState("");
  const [guestName, setGuestName] = useState("");

  const [editOpen, setEditOpen] = useState(false);

  /* ======================
     Load data
     ====================== */
  async function reload() {
    if (!id) return;
    const res = await fetch(`/api/classes/${id}`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!res.ok) throw new Error("CLASS_LOAD_FAILED");
    const data = (await res.json()) as ClassApi;
    setCls(data);
  }

  useEffect(() => {
    if (!id) return;

    (async () => {
      try {
        await reload();

        const [u, ins] = await Promise.all([
          fetch("/api/admin/users", { credentials: "include" }),
          fetch("/api/admin/instructors", { credentials: "include" }),
        ]);

        if (u.ok) {
          const j = await u.json().catch(() => ({}));
          setUsers(j.items ?? j);
        }
        if (ins.ok) {
          const j = await ins.json().catch(() => ({}));
          setInstructors(j.items ?? j);
        }
      } catch (e) {
        alert("No se pudo cargar la clase.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /* ======================
     Derived
     ====================== */
  const attendees: AttendeeRow[] = useMemo(() => {
    if (!cls) return [];
    const active = cls.bookings.filter((b) => (b.status ?? "ACTIVE") === "ACTIVE");

    return active.map((b) => ({
      bookingId: b.id,
      name: b.user?.name ?? b.guestName ?? "Invitado",
      email: b.user?.email,
      isGuest: !b.user,
      attended: !!b.attended,
      quantity: b.quantity ?? 1,
    }));
  }, [cls]);

  const usedSpots = useMemo(() => {
    return attendees.reduce((acc, a) => acc + (a.quantity || 1), 0);
  }, [attendees]);

  const spotsLeft = useMemo(() => {
    if (!cls) return 0;
    return Math.max(0, cls.capacity - usedSpots);
  }, [cls, usedSpots]);

  const dateInfo = useMemo(() => (cls ? fmtDateTimeMX(cls.date) : null), [cls]);

  /* ======================
     Actions
     ====================== */

  async function toggleAttendance(a: AttendeeRow) {
    // ⚠️ requiere soporte backend (campo attended o tabla)
    setBusy(a.bookingId);
    try {
      const res = await fetch(`/api/admin/bookings/${a.bookingId}/attendance`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ attended: !a.attended }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }

      setCls((prev) =>
        prev
          ? {
              ...prev,
              bookings: prev.bookings.map((b) =>
                b.id === a.bookingId ? { ...b, attended: !a.attended } : b
              ),
            }
          : prev
      );
    } catch (e: any) {
      alert(e?.message || "No se pudo marcar asistencia.");
    } finally {
      setBusy(null);
    }
  }

  async function removeAttendee(a: AttendeeRow) {
    if (!confirm("¿Eliminar usuario de la clase?")) return;

    setBusy(a.bookingId);
    try {
      // ✅ este endpoint debe: eliminar booking + reembolsar 1 crédito (si aplica)
      const res = await fetch(`/api/admin/bookings/${a.bookingId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }

      // update optimista
      setCls((prev) =>
        prev
          ? { ...prev, bookings: prev.bookings.filter((b) => b.id !== a.bookingId) }
          : prev
      );
    } catch (e: any) {
      alert(e?.message || "No se pudo eliminar.");
    } finally {
      setBusy(null);
    }
  }

  async function addUser() {
    if (!selectedUserId) return;
    if (spotsLeft <= 0) return alert("No hay spots disponibles.");

    setBusy("ADD_USER");
    try {
      const res = await fetch(`/api/admin/classes/${id}/add-user`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ userId: selectedUserId }),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        // tu backend debería devolver "NO_CREDITS" si no tiene créditos
        throw new Error(j?.error || `HTTP ${res.status}`);
      }

      setSelectedUserId("");
      await reload();
    } catch (e: any) {
      alert(e?.message || "No se pudo agregar el usuario.");
    } finally {
      setBusy(null);
    }
  }

  async function addGuest() {
    // ⚠️ requiere soporte backend para invitados (schema actual no lo permite con Booking.userId requerido)
    if (!guestName.trim()) return;
    if (spotsLeft <= 0) return alert("No hay spots disponibles.");

    setBusy("ADD_GUEST");
    try {
      const res = await fetch(`/api/admin/classes/${id}/add-guest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: guestName.trim() }),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }

      setGuestName("");
      await reload();
    } catch (e: any) {
      alert(e?.message || "No se pudo agregar invitado.");
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
    if (!confirm("¿Cancelar esta clase?")) return;

    setBusy("CANCEL");
    try {
      const res = await fetch(`/api/admin/classes/${id}/cancel`, {
        method: "PATCH",
        credentials: "include",
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }

      await reload();
    } catch (e: any) {
      alert(e?.message || "No se pudo cancelar.");
    } finally {
      setBusy(null);
    }
  }

  /* ======================
     Render
     ====================== */
  if (loading) return <div className="section container-app">Cargando…</div>;
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

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE } }}
          className="mt-6 card p-6"
        >
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl font-bold">
                {cls.title}
                {cls.isCanceled && (
                  <span className="ml-2 text-sm text-red-600">(Cancelada)</span>
                )}
              </h1>

              <p className="text-muted-foreground">
                {cls.focus} · Coach: {cls.instructor?.name}
              </p>

              {dateInfo && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {dateInfo.date} · {dateInfo.time} · {cls.durationMin} min
                </p>
              )}

              <p className="mt-1 text-sm">
                Cupo: {usedSpots}/{cls.capacity} ·{" "}
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
                disabled={false}
                title={
                  attendees.length > 0
                    ? "Elimina primero a los usuarios inscritos"
                    : cls.isCanceled
                    ? "Ya está cancelada"
                    : "Cancelar clase"
                }
              >
                <FiSlash /> Cancelar clase
              </button>
            </div>
          </div>
        </motion.div>

        {/* Attendees */}
        <section className="mt-8">
          <h2 className="font-display text-xl font-bold mb-4">Usuarios en clase</h2>

          <div className="grid gap-3">
            {attendees.map((a) => (
              <div key={a.bookingId} className="card p-4 flex justify-between items-center">
                <div className="min-w-0">
                  <p className="font-semibold truncate">
                    {a.name}
                    {a.isGuest && <span className="ml-2 text-xs badge">Invitado</span>}
                  </p>
                  {a.email && <p className="text-xs text-muted-foreground truncate">{a.email}</p>}
                  {a.quantity > 1 && (
                    <p className="text-xs text-muted-foreground">Plazas: {a.quantity}</p>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  {/* Asistencia */}
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={a.attended}
                      onChange={() => toggleAttendance(a)}
                      disabled={busy === a.bookingId}
                      className="h-5 w-5 accent-green-600"
                      title="Marcar asistencia"
                    />
                    <span className={a.attended ? "text-green-600 font-semibold" : "text-muted-foreground"}>
                      {a.attended ? "Asistió" : "No asistió"}
                    </span>
                  </label>

                  {/* Eliminar */}
                  <button
                    onClick={() => removeAttendee(a)}
                    className="icon-btn text-red-600"
                    disabled={busy === a.bookingId}
                    title="Eliminar de clase (reembolsa 1 crédito)"
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

        {/* Add users */}
        <section className="mt-10">
          <h2 className="font-display text-xl font-bold mb-4">Agregar usuario</h2>

          <div className="card p-5 grid gap-4 sm:grid-cols-2">
            {/* Usuario registrado */}
            <div>
              <p className="font-semibold mb-2">Usuario registrado</p>
              <select
                className="input"
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                disabled={cls.isCanceled || spotsLeft <= 0 || busy !== null}
                title={cls.isCanceled ? "Clase cancelada" : undefined}
              >
                <option value="">Selecciona usuario</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id} disabled={u.credits < 1}>
                    {u.name} ({u.credits} créditos)
                  </option>
                ))}
              </select>

              <button
                className="btn-primary mt-3 w-full"
                onClick={addUser}
                disabled={
                  !selectedUserId || cls.isCanceled || spotsLeft <= 0 || busy !== null
                }
              >
                <FiUserPlus /> Agregar 
              </button>

              {spotsLeft <= 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  No hay spots disponibles.
                </p>
              )}
            </div>

            {/* Invitado */}
            <div>
              <p className="font-semibold mb-2">Invitado</p>
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
                disabled={!guestName.trim() || cls.isCanceled || spotsLeft <= 0 || busy !== null}
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
          onSaved={(next) => setCls(next)}
        />
      )}
    </section>
  );
}
