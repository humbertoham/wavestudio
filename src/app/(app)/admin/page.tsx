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
type User = { id: string; name: string | null; email: string; dateOfBirth?: string | null };
type UserDetails = {
  user: {
    id: string;
    name: string | null;
    email: string;
    dateOfBirth?: string | null;
    phone?: string | null;
    emergencyPhone?: string | null;
    affiliation: "NONE" | "WELLHUB" | "TOTALPASS";
    createdAt: string;
  };
  tokenBalance: number;
  purchases: Array<{
    id: string;
    createdAt: string;
    expiresAt: string;
    classesLeft: number;
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
    if (!res.ok) mutate(prev); else mutate();
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
        <label className="md:col-span-2 inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={!!creating.repeatNextMonth}
            onChange={e=>setCreating(f=>({...f, repeatNextMonth: e.target.checked}))}
          />
          Repetir todo el mes siguiente (mismo día de la semana y hora)
        </label>

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

        <select
          className="input"
          value={creating.highlight ?? ""}
          onChange={(e) =>
            setCreating((f) => ({
              ...f,
              highlight: e.target.value === "" ? "" : (e.target.value as HighlightOpt),
            }))
          }
        >
          <option value="">Sin highlight</option>
          <option value="popular">Popular</option>
          <option value="best">Best</option>
        </select>

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
                  Highlight
                </label>
                <select
                  className="input w-full"
                  value={draft.highlight ?? ""}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      highlight:
                        e.target.value === "" ? "" : (e.target.value as HighlightOpt),
                    }))
                  }
                >
                  <option value="">Sin highlight</option>
                  <option value="popular">Popular</option>
                  <option value="best">Best</option>
                </select>
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



/* GANANCIAS DEL MES
*/
function RevenueSection() {
  // rango por defecto: últimos 30 días
  const toISO = (d: Date) =>
    new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);

  const [to, setTo] = useState<string>(() => toISO(new Date()));
  const [from, setFrom] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return toISO(d);
  });

  const params = new URLSearchParams({
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
  });

  const { data, error, isLoading, mutate } = useSWR<{
    total: number;
    count: number;
    average: number;
    daily: { date: string; total: number }[];
  }>(`/api/admin/revenue?${params.toString()}`, fetcher);

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
      {/* HEADER + FILTROS RESPONSIVE */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
        <h2 className="text-xl font-semibold">Ingresos</h2>

        <div className="flex flex-col sm:flex-row flex-wrap gap-3 w-full md:w-auto">
          {/* FROM */}
          <div className="flex flex-col text-sm">
            <label className="text-gray-600 mb-1">De</label>
            <input
              className="input w-full sm:w-auto"
              type="datetime-local"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>

          {/* TO */}
          <div className="flex flex-col text-sm">
            <label className="text-gray-600 mb-1">a</label>
            <input
              className="input w-full sm:w-auto"
              type="datetime-local"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>

          {/* BOTONES */}
          <div className="flex gap-2 mt-1 sm:mt-6">
            <button
              className="btn-outline w-full sm:w-auto"
              onClick={() => mutate()}
            >
              Actualizar
            </button>

            <button
              className="btn-ghost w-full sm:w-auto"
              onClick={() => {
                const now = new Date();
                const d = new Date();
                d.setDate(d.getDate() - 30);
                setFrom(toISO(d));
                setTo(toISO(now));
                setTimeout(() => mutate(), 0);
              }}
            >
              Últimos 30 días
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
          {/* KPIs RESPONSIVE */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 mb-6">
            <div className="rounded-xl border p-4">
              <div className="text-sm text-gray-600">
                Total aprobado
              </div>
              <div className="text-2xl font-semibold">
                {fmtMoney(data.total)}
              </div>
            </div>

            <div className="rounded-xl border p-4">
              <div className="text-sm text-gray-600">
                # Pagos
              </div>
              <div className="text-2xl font-semibold">
                {data.count}
              </div>
            </div>

            <div className="rounded-xl border p-4">
              <div className="text-sm text-gray-600">
                Ticket promedio
              </div>
              <div className="text-2xl font-semibold">
                {fmtMoney(data.average)}
              </div>
            </div>
          </div>

          {/* TABLA RESPONSIVE */}
          <div className="overflow-x-auto">
            <table className="min-w-[500px] w-full text-sm border-collapse">
              <thead className="text-left border-b border-[var(--color-border)]">
                <tr>
                  <th>Fecha</th>
                  <th className="text-right">Total del día</th>
                </tr>
              </thead>
              <tbody>
                {data.daily.map((d) => (
                  <tr
                    key={d.date}
                    className="border-b border-[var(--color-border)]"
                  >
                    <td className="py-2 whitespace-nowrap">
                      {new Date(d.date).toLocaleDateString()}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {fmtMoney(d.total)}
                    </td>
                  </tr>
                ))}

                {data.daily.length === 0 && (
                  <tr>
                    <td
                      colSpan={2}
                      className="py-3 text-center text-gray-500"
                    >
                      Sin pagos aprobados en el rango
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
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
                    onClick={() => setSelectedId(u.id)}
                  >
                    <div className="font-medium">{u.name ?? "—"}</div>
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
    <table className="min-w-[600px] w-full text-sm border-collapse">
      <thead className="border-b border-[var(--color-border)] text-left">
        <tr>
          <th>Paquete</th>
          <th>Restantes</th>
          <th>Vence</th>
        </tr>
      </thead>
      <tbody>
        {details.purchases.map((p) => (
          <tr key={p.id} className="border-b border-[var(--color-border)]">
            <td className="py-2">{p.pack.name}</td>
            <td className="py-2">{p.classesLeft}</td>
            <td className="py-2">
              <span className="whitespace-nowrap">
                {new Date(p.expiresAt).toLocaleDateString()}
              </span>
            </td>
          </tr>
        ))}

        {details.purchases.length === 0 && (
          <tr>
            <td
              colSpan={3}
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
