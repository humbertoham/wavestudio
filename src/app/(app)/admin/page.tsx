"use client";

import useSWR from "swr";
import { useMemo, useState } from "react";

// --- helpers ---
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

type Instructor = { id: string; name: string; bio?: string | null };
type ClassItem = {
  id: string; title: string; focus: string; date: string; durationMin: number; capacity: number;
  instructorId: string; instructor?: { id: string; name: string };
  isCanceled?: boolean; // ← agregar
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
  dateOfBirth?: string | null;
  bookingBlocked?: boolean;
};
type UserDetails = {
  user: {
    id: string;
    name: string | null;
    email: string;
    dateOfBirth?: string | null;
    phone?: string | null;
    emergencyPhone?: string | null;
    affiliation: "NONE" | "WELLHUB" | "TOTALPASS";
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
  const [tab, setTab] = useState<
    "classes" | "instructors" | "packs" | "revenue" | "users"
  >("classes");

  const tabs: Array<[value: typeof tab, label: string]> = [
    ["classes", "Clases"],
    ["instructors", "Instructores"],
    ["packs", "Paquetes"],
    ["revenue", "Ingresos"],
     ["users", "Usuarios"],
  ];

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
              onClick={() => setTab(value)}
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
    </main>
  );
}

/* ---------------------------------------------------
   CLASES — listar / crear / editar por fila / eliminar
---------------------------------------------------- */
function ClassesSection() {
  const { data, error, isLoading, mutate } = useSWR<{items: ClassItem[]}>("/api/admin/classes", fetcher);
  const { data: instructors } = useSWR<{items: Instructor[]}>("/api/admin/instructors", fetcher);

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
            <tr><th>Título</th><th>Enfoque</th><th>Fecha</th><th>Dur.</th><th>Cupo</th><th>Instructor</th><th className="text-right">Acciones</th></tr>
          </thead>
          <tbody>
            {filtered.map(c=>(
              <EditableClassRow
                key={c.id}
                item={c}
                instructors={instructors?.items ?? []}
                onDeleted={()=>deleteClass(c.id)}
                onSaved={()=>mutate()}
              />
            ))}
            {!isLoading && filtered.length===0 && (
              <tr><td colSpan={7} className="py-3 text-center text-gray-500">Sin resultados</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Section>
  );
}


function EditableClassRow({
  item, instructors, onDeleted, onSaved
}: {
  item: ClassItem; instructors: Instructor[];
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
  const [pauseDaysById, setPauseDaysById] = useState<Record<string, number>>({});
  const [pausingPackId, setPausingPackId] = useState<string | null>(null);

  // 1️⃣ últimos usuarios
  const { data: latestUsers, isLoading: loadingLatest } = useSWR<{ items: User[] }>(
    q.trim() ? null : "/api/admin/users",
    fetcher
  );

  // 2️⃣ búsqueda
  const { data: searchData, isLoading: searching } = useSWR<{ items: User[] }>(
    q.trim() ? `/api/admin/users?q=${encodeURIComponent(q.trim())}` : null,
    fetcher
  );

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

  const list = q.trim() ? searchData?.items : latestUsers?.items;
  const loadingList = q.trim() ? searching : loadingLatest;

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
            onChange={(e) => setQ(e.target.value)}
          />

          {loadingList && (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          )}

          <div className="border rounded-[var(--radius)] overflow-hidden">
            <ul className="divide-y">
              {(list ?? []).map((u) => (
                <li key={u.id}>
                  <button
                    className={`w-full text-left p-3 hover:bg-[--color-muted] ${
                      selectedId === u.id ? "bg-[--color-muted]" : ""
                    }`}
                    onClick={() => {
                      setSelectedId(u.id);
                      setFeedback(null);
                      setTokenDelta(0);
                    }}
                  >
                    <div className="flex items-center gap-2 font-medium">
                      <span>{u.name ?? "—"}</span>
                      {u.bookingBlocked && (
                        <span className="rounded bg-red-100 px-2 py-0.5 text-[11px] text-red-700">
                          Bloqueado
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {u.email}
                    </div>
                  </button>
                </li>
              ))}

              {!loadingList && (list?.length ?? 0) === 0 && (
                <li className="p-3 text-sm text-muted-foreground">
                  {q.trim() ? "Sin resultados" : "No hay usuarios"}
                </li>
              )}
            </ul>
          </div>

          {!q.trim() && !loadingList && (
            <p className="text-xs text-muted-foreground text-center">
              Últimos usuarios registrados
            </p>
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

                    <dt className="text-muted-foreground">Afiliación</dt>
                    <dd className="col-span-2">{details.user.affiliation}</dd>

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
