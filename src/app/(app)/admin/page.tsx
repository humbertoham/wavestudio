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
  return <div className="rounded-2xl border p-4 md:p-6 bg-white">{children}</div>;
}

type Instructor = { id: string; name: string; bio?: string | null };
type ClassItem = {
  id: string; title: string; focus: string; date: string; durationMin: number; capacity: number;
  instructorId: string; instructor?: { id: string; name: string }
};
type Pack = {
  id: string;
  name: string;
  classes: number;
  price: number;           // entero (pesos)
  validityDays: number;
  isActive: boolean;
  createdAt: string;

  classesLabel: string | null;
  highlight: "POPULAR" | "BEST" | null;
  description: string[] | null;
};
type User = { id: string; name: string | null; email: string; dateOfBirth?: string | null };

// ...
export default function AdminPage() {
  const [tab, setTab] = useState<"classes"|"instructors"|"packs"|"enroll"|"birthdays"|"revenue"|"manual">("classes");
  return (
    <main className="container-app py-8 space-y-6">
      <h1 className="text-2xl font-bold">Panel de administrador</h1>

      <div className="flex gap-2 flex-wrap">
        {[
          ["classes","Clases"],
          ["instructors","Instructores"],
          ["packs","Paquetes"],
          ["enroll","Inscribir a clase"],
          ["birthdays","Cumpleaños"],
          ["revenue","Ingresos"],
          ["manual","Venta manual"],           // ← NUEVA
        ].map(([value,label])=>(
          <button
            key={value}
            onClick={()=>setTab(value as any)}
            className={`px-3 py-1.5 rounded-xl border ${tab===value ? "bg-black text-white border-black" : "bg-white"}`}
          >{label}</button>
        ))}
      </div>

      {tab==="classes" && <ClassesSection/>}
      {tab==="instructors" && <InstructorsSection/>}
      {tab==="packs" && <PacksSection/>}
      {tab==="enroll" && <EnrollSection/>}
      {tab==="birthdays" && <BirthdaysSection/>}
      {tab==="revenue" && <RevenueSection/>}
      {tab==="manual" && <ManualSaleSection/>}   {/* ← NUEVO */}
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
    if (!q) return data.items;
    return data.items.filter(c =>
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
    date: item.date.slice(0,16),
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
                  title: item.title, focus: item.focus, date: item.date.slice(0,16),
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
      price: creating.price, // el API redondea a entero
      validityDays: creating.validityDays,
      isActive: !!creating.isActive,
      classesLabel: creating.classesLabel?.trim() || undefined,
      highlight: isHighlight(creating.highlight) ? creating.highlight : undefined, // ✅ type guard
      description: toLines(creating.descriptionText), // string[]
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
    classesLabel?: string | null;
    highlight?: "" | HighlightOpt | null; // "" = sin highlight
    descriptionText?: string; // textarea → string[]
  }>({
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


/* ---------------------------------------------------
   ENROLL — con filtros y reseteo tras inscripción
---------------------------------------------------- */
function EnrollSection() {
  const { data: classes } = useSWR<{ items: ClassItem[] }>("/api/admin/classes", fetcher);
  const { data: users } = useSWR<{ items: User[] }>("/api/admin/users", fetcher);

  const [userId, setUserId] = useState("");
  const [classId, setClassId] = useState("");

  const [userQuery, setUserQuery] = useState("");
  const [classQuery, setClassQuery] = useState("");

  const [msg, setMsg] = useState<string | null>(null);

  const filteredUsers = useMemo(() => {
    const q = userQuery.trim().toLowerCase();
    if (!users?.items) return [];
    if (!q) return users.items;
    return users.items.filter(u =>
      (u.name ?? "").toLowerCase().includes(q) ||
      (u.email ?? "").toLowerCase().includes(q)
    );
  }, [users, userQuery]);

  const filteredClasses = useMemo(() => {
    const q = classQuery.trim().toLowerCase();
    if (!classes?.items) return [];
    if (!q) return classes.items;
    return classes.items.filter(c => {
      const dateStr = new Date(c.date).toLocaleString();
      const instructor = c.instructor?.name ?? "";
      return (
        c.title.toLowerCase().includes(q) ||
        (c.focus ?? "").toLowerCase().includes(q) ||
        instructor.toLowerCase().includes(q) ||
        dateStr.toLowerCase().includes(q)
      );
    });
  }, [classes, classQuery]);

  async function enroll(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const r = await fetch("/api/admin/booking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, classId }),
    });
    if (r.ok) {
      // ✅ limpiar todo al inscribir correctamente
      setUserId("");
      setClassId("");
      setUserQuery("");
      setClassQuery("");
      setMsg("Usuario inscrito a la clase.");

      // (Opcional) limpiar mensaje después de unos segundos
      setTimeout(() => setMsg(null), 4000);
    } else {
      setMsg("No se pudo inscribir (quizá ya estaba o no hay cupo).");
    }
  }

  return (
    <Section>
      <h2 className="text-xl font-semibold mb-4">Inscribir usuario a clase</h2>

      <form onSubmit={enroll} className="grid gap-4">
        {/* Buscador + select de usuarios */}
        <div className="grid md:grid-cols-3 gap-3 items-start">
          <div className="md:col-span-1">
            <label className="block text-sm font-medium mb-1">Buscar usuario</label>
            <input
              className="input w-full"
              placeholder="Nombre o email…"
              value={userQuery}
              onChange={e => setUserQuery(e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">
              {filteredUsers.length} resultado{filteredUsers.length === 1 ? "" : "s"}
            </p>
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium mb-1">Selecciona usuario</label>
            <select
              className="input w-full"
              required
              value={userId}
              onChange={e => setUserId(e.target.value)}
            >
              <option value="">-- Usuario --</option>
              {filteredUsers.map(u => (
                <option key={u.id} value={u.id}>
                  {(u.name ?? u.email) + " — " + u.email}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Buscador + select de clases */}
        <div className="grid md:grid-cols-3 gap-3 items-start">
          <div className="md:col-span-1">
            <label className="block text-sm font-medium mb-1">Buscar clase</label>
            <input
              className="input w-full"
              placeholder="Título, enfoque, instructor o fecha…"
              value={classQuery}
              onChange={e => setClassQuery(e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">
              {filteredClasses.length} resultado{filteredClasses.length === 1 ? "" : "s"}
            </p>
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium mb-1">Selecciona clase</label>
            <select
              className="input w-full"
              required
              value={classId}
              onChange={e => setClassId(e.target.value)}
            >
              <option value="">-- Clase --</option>
              {filteredClasses.map(c => (
                <option key={c.id} value={c.id}>
                  {c.title} — {new Date(c.date).toLocaleString()}{" "}
                  {c.instructor?.name ? `— ${c.instructor.name}` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Acción */}
        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={!userId || !classId}>
            Inscribir
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setUserId("");
              setClassId("");
              setUserQuery("");
              setClassQuery("");
              setMsg(null);
            }}
          >
            Limpiar
          </button>
        </div>

        {msg && <p className="mt-2 text-sm">{msg}</p>}
      </form>
    </Section>
  );
}



/* ---------------------------------------------------
   CUMPLEAÑOS — igual que antes
---------------------------------------------------- */
function BirthdaysSection() {
  const { data, error, isLoading } = useSWR<{ today: User[]; upcoming: { user: User; date: string }[] }>(
    "/api/admin/birthdays?days=30",
    fetcher
  );
  return (
    <Section>
      <h2 className="text-xl font-semibold mb-4">Cumpleaños</h2>
      {isLoading && <p className="text-sm text-gray-500">Cargando…</p>}
      {error && <p className="text-sm text-red-600">Error cargando cumpleaños</p>}
      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <h3 className="font-medium mb-2">🎉 Hoy</h3>
          <ul className="space-y-1">
            {data?.today?.length ? data.today.map(u=>(
              <li key={u.id}>{u.name ?? u.email} — {u.email}</li>
            )) : <li className="text-sm text-gray-500">Nadie cumple hoy</li>}
          </ul>
        </div>
        <div>
          <h3 className="font-medium mb-2">Próximos 30 días</h3>
          <ul className="space-y-1">
            {data?.upcoming?.length ? data.upcoming.map(({user,date})=>(
              <li key={user.id}>{new Date(date).toLocaleDateString()} — {user.name ?? user.email} ({user.email})</li>
            )) : <li className="text-sm text-gray-500">Sin próximos</li>}
          </ul>
        </div>
      </div>
    </Section>
  );
}

/* GANANCIAS DEL MES
*/
function RevenueSection() {
  // rango por defecto: últimos 30 días
  const toISO = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,16);
  const [to, setTo] = useState<string>(() => toISO(new Date()));
  const [from, setFrom] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return toISO(d);
  });

  const params = new URLSearchParams({ from: new Date(from).toISOString(), to: new Date(to).toISOString() });
  const { data, error, isLoading, mutate } = useSWR<{
    total: number;
    count: number;
    average: number;
    daily: { date: string; total: number }[];
  }>(`/api/admin/revenue?${params.toString()}`, fetcher);

  const fmtMoney = (n?: number) =>
    typeof n === "number" ? n.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }) : "—";

  return (
    <Section>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <h2 className="text-xl font-semibold">Ingresos</h2>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">De</label>
          <input className="input" type="datetime-local" value={from} onChange={e=>setFrom(e.target.value)} />
          <label className="text-sm text-gray-600">a</label>
          <input className="input" type="datetime-local" value={to} onChange={e=>setTo(e.target.value)} />
          <button className="btn-outline" onClick={()=>mutate()}>Actualizar</button>
          <button className="btn-ghost" onClick={()=>{
            const now = new Date();
            const d = new Date(); d.setDate(d.getDate()-30);
            setFrom(toISO(d)); setTo(toISO(now));
            // mutate después de setState para que el SWR re-evalúe con la nueva URL
            setTimeout(()=>mutate(), 0);
          }}>Últimos 30 días</button>
        </div>
      </div>

      {isLoading && <p className="text-sm text-gray-500">Calculando…</p>}
      {error && <p className="text-sm text-red-600">Error cargando ingresos</p>}

      {data && (
        <>
          {/* KPIs */}
          <div className="grid md:grid-cols-3 gap-3 mb-6">
            <div className="rounded-xl border p-4">
              <div className="text-sm text-gray-600">Total aprobado</div>
              <div className="text-2xl font-semibold">{fmtMoney(data.total)}</div>
            </div>
            <div className="rounded-xl border p-4">
              <div className="text-sm text-gray-600"># Pagos</div>
              <div className="text-2xl font-semibold">{data.count}</div>
            </div>
            <div className="rounded-xl border p-4">
              <div className="text-sm text-gray-600">Ticket promedio</div>
              <div className="text-2xl font-semibold">{fmtMoney(data.average)}</div>
            </div>
          </div>

          {/* Mini serie (día a día) */}
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left border-b">
                <tr><th>Fecha</th><th className="text-right">Total del día</th></tr>
              </thead>
              <tbody>
                {data.daily.map((d)=>(
                  <tr key={d.date} className="border-b">
                    <td className="py-2">{new Date(d.date).toLocaleDateString()}</td>
                    <td className="py-2 text-right">{fmtMoney(d.total)}</td>
                  </tr>
                ))}
                {data.daily.length===0 && (
                  <tr><td colSpan={2} className="py-3 text-center text-gray-500">Sin pagos aprobados en el rango</td></tr>
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
COMPRA DE PAQUETES MANUALMENTE
*/
function ManualSaleSection() {
  const { data: users } = useSWR<{ items: User[] }>("/api/admin/users", fetcher);
  const { data: packs } = useSWR<{ items: Pack[] }>("/api/admin/packs", fetcher);

  const [userQuery, setUserQuery] = useState("");
  const [packQuery, setPackQuery] = useState("");

  const [userId, setUserId] = useState("");
  const [packId, setPackId] = useState("");
  const [note, setNote] = useState("");

  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const filteredUsers = useMemo(() => {
    const q = userQuery.trim().toLowerCase();
    return (users?.items ?? []).filter(u =>
      (u.name ?? "").toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    );
  }, [users, userQuery]);

  const filteredPacks = useMemo(() => {
    const q = packQuery.trim().toLowerCase();
    return (packs?.items ?? []).filter(p =>
      p.isActive && (
        p.name.toLowerCase().includes(q) ||
        String(p.price).includes(q) ||
        String(p.classes).includes(q)
      )
    );
  }, [packs, packQuery]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setSaving(true);
    const r = await fetch("/api/admin/manual-purchases", {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ userId, packId, note }),
    });
    setSaving(false);
    if (r.ok) {
      setUserId(""); setPackId(""); setNote(""); setUserQuery(""); setPackQuery("");
      const d = await r.json();
      setMsg(`✅ Venta registrada. Payment ${d.paymentId}. Ticket: $${d.amount}. Expira: ${new Date(d.expiresAt).toLocaleDateString()}`);
    } else {
      const err = await r.json().catch(()=> ({}));
      setMsg(`❌ Error: ${err.error ?? r.status}`);
    }
  }

  return (
    <Section>
      <h2 className="text-xl font-semibold mb-4">Venta manual de paquete</h2>

      <form onSubmit={submit} className="grid gap-4">
        {/* Usuario */}
        <div className="grid md:grid-cols-3 gap-3 items-start">
          <div>
            <label className="block text-sm font-medium mb-1">Buscar usuario</label>
            <input className="input w-full" placeholder="Nombre o email…" value={userQuery} onChange={e=>setUserQuery(e.target.value)} />
            <p className="text-xs text-muted-foreground mt-1">{filteredUsers.length} resultado{filteredUsers.length===1?"":"s"}</p>
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium mb-1">Selecciona usuario</label>
            <select className="input w-full" required value={userId} onChange={e=>setUserId(e.target.value)}>
              <option value="">-- Usuario --</option>
              {filteredUsers.map(u=>(
                <option key={u.id} value={u.id}>{(u.name ?? u.email)} — {u.email}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Paquete */}
        <div className="grid md:grid-cols-3 gap-3 items-start">
          <div>
            <label className="block text-sm font-medium mb-1">Buscar paquete</label>
            <input className="input w-full" placeholder="Nombre, precio o #clases…" value={packQuery} onChange={e=>setPackQuery(e.target.value)} />
            <p className="text-xs text-muted-foreground mt-1">{filteredPacks.length} resultado{filteredPacks.length===1?"":"s"}</p>
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium mb-1">Selecciona paquete</label>
            <select className="input w-full" required value={packId} onChange={e=>setPackId(e.target.value)}>
              <option value="">-- Paquete --</option>
              {filteredPacks.map(p=>(
                <option key={p.id} value={p.id}>
                  {p.name} — {p.classes} clases — ${p.price} — {p.validityDays} días
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Nota opcional */}
        <div>
          <label className="block text-sm font-medium mb-1">Nota (opcional)</label>
          <input className="input w-full" placeholder="Ej. Venta en recepción / efectivo / ajuste" value={note} onChange={e=>setNote(e.target.value)} />
        </div>

        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={!userId || !packId || saving}>
            {saving ? "Guardando…" : "Acreditar paquete"}
          </button>
          <button type="button" className="btn-secondary" onClick={()=>{
            setUserId(""); setPackId(""); setUserQuery(""); setPackQuery(""); setNote(""); setMsg(null);
          }}>Limpiar</button>
        </div>

        {msg && <p className="mt-2 text-sm">{msg}</p>}
      </form>
    </Section>
  );
}
