// src/app/(marketing)/precios/page.tsx
"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { motion, cubicBezier } from "framer-motion";
import { FiCheck, FiZap } from "react-icons/fi";
import Link from "next/link";
import { useRouter } from "next/navigation";

const EASE = cubicBezier(0.22, 1, 0.36, 1);

type ApiPack = {
  id: string;
  name: string;
  classesLabel?: string | null;
  classesCount?: number | null;
  price: number;
  validity?: string | null;
  validityDays?: number | null;
  highlight?: "popular" | "best" | null;
  description?: string[] | null;

  oncePerUser?: boolean; // ✅ NUEVO
};

type Pack = {
  id: string;
  name: string;
  classesLabel: string;
  price: number;
  validity: string;
  highlight?: "popular" | "best";
  description?: string[];

oncePerUser: boolean; // ✅ NUEVO
};

type Me =
  | { id: string; name?: string | null; email?: string | null }
  | null;

const formatMXN = (n: number) =>
  n.toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  });

function toPack(p: ApiPack): Pack {
  const classesLabel =
    p.classesLabel ??
    (typeof p.classesCount === "number"
      ? `${p.classesCount} ${p.classesCount === 1 ? "clase" : "clases"}`
      : "—");

  const validity =
    p.validity ??
    (typeof p.validityDays === "number"
      ? `Vigencia de ${p.validityDays} días`
      : "Vigencia variable");

  return {
    id: p.id,
    name: p.name,
    classesLabel,
    price: p.price,
    validity,
    highlight: (p.highlight ?? undefined) as Pack["highlight"],
    description: p.description ?? undefined,

    oncePerUser: !!p.oncePerUser, // ✅
  };
}

export default function PricingPage() {
  const router = useRouter();
  const [packs, setPacks] = useState<Pack[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Sesión actual
  const [me, setMe] = useState<Me>(null);
  const [checkingMe, setCheckingMe] = useState(true);
  const [myPackIds, setMyPackIds] = useState<Set<string>>(new Set());
  const [pendingPackId, setPendingPackId] = useState<string | null>(null);

  // Cargar packs y usuario
  useEffect(() => {
    let mounted = true;

    async function loadPacks() {
      try {
        const res = await fetch("/api/packs", {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: ApiPack[] = await res.json();
        if (!mounted) return;
        setPacks(data.map(toPack));
      } catch (e) {
        console.error(e);
        if (!mounted) return;
        setError("No se pudieron cargar los paquetes.");
        setPacks([]);
      }
    }

    async function loadMe() {
      try {
        setCheckingMe(true);
        const r = await fetch("/api/auth/me", { cache: "no-store" });
        if (r.ok) {
          const user = await r.json();
          setMe(user ?? null);
        } else if (r.status === 401) {
          setMe(null);
        } else {
          setMe(null);
        }
      } catch {
        setMe(null);
      } finally {
        setCheckingMe(false);
      }
    }
     async function loadMyPacks() {
  if (!me?.id) return;

  try {
    const r = await fetch("/api/me/packs", { cache: "no-store" });
    if (!r.ok) return;

    const items: { packId: string }[] = await r.json();
    setMyPackIds(new Set(items.map(i => i.packId)));
  } catch {
    /* noop */
  }
}

    loadPacks();
    loadMe();
    loadMyPacks();

    return () => {
      mounted = false;
    };

 





  }, []);

  const visiblePacks = useMemo(() => {
  if (!packs) return null;

  return packs.filter(p => {
    if (!p.oncePerUser) return true;
    if (!me) return true; // no logueado → sí se muestra
    return !myPackIds.has(p.id); // logueado y ya lo tuvo → ocultar
  });
}, [packs, me, myPackIds]);


  const ordered = useMemo(() => {
  if (!visiblePacks) return null;
  const score = (h?: Pack["highlight"]) =>
    h === "best" ? 2 : h === "popular" ? 1 : 0;
  return [...visiblePacks].sort((a, b) => score(b.highlight) - score(a.highlight));
}, [visiblePacks]);


  const goLogin = useCallback(() => {
    const next = encodeURIComponent("/precios");
    router.push(`/login?next=${next}`);
  }, [router]);

  const handleBuy = useCallback(
    async (pack: Pack) => {
      if (checkingMe) return;

      if (!me) {
        goLogin();
        return;
      }

      try {
        setPendingPackId(pack.id);

        const res = await fetch("/api/checkout-links", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    packId: pack.id,
    userId: me?.id,   // 👈 AQUÍ LA CLAVE
  }),
});

        // 🔑 Leer el body solo una vez
        const raw = await res.text();
        let data: any = null;
        try {
          data = raw ? JSON.parse(raw) : null;
        } catch {
          /* cuerpo no JSON */
        }

        if (!res.ok) {
          console.error("checkout-links error:", data ?? raw);
          throw new Error(
            `No se pudo crear el enlace de pago (HTTP ${res.status})`
          );
        }

        const checkoutUrl: string | undefined =
          data?.checkoutUrl ?? data?.initPoint;
        if (!checkoutUrl) {
          console.error("Respuesta sin checkoutUrl:", data ?? raw);
          throw new Error("La API no devolvió checkoutUrl");
        }

        window.location.href = checkoutUrl;
      } catch (e) {
        console.error(e);
        alert("No se pudo iniciar la compra. Inténtalo de nuevo en unos minutos.");
      } finally {
        setPendingPackId(null);
      }
    },
    [me, checkingMe, goLogin]
  );

  return (
    <section className="section">
      <div className="container-app">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } }}
          className="mx-auto max-w-2xl text-center"
        >
          <h1 className="font-display text-3xl font-extrabold md:text-4xl">
            Paquetes de entrenamiento
          </h1>
          <p className="mt-3 text-muted-foreground">
            Elige el plan que mejor se adapte a tu ritmo. Todos pueden reservar desde la plataforma.
          </p>
        </motion.div>

        {error && (
          <div className="mt-6 text-center text-sm text-red-600">
            {error} Inténtalo de nuevo más tarde.
          </div>
        )}

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ordered
            ? ordered.length > 0
              ? ordered.map((p, idx) => {
                  const isPending = pendingPackId === p.id;
                  return (
                    <motion.div
                      key={p.id}
                      initial={{ opacity: 0, y: 18, scale: 0.98 }}
                      animate={{
                        opacity: 1,
                        y: 0,
                        scale: 1,
                        transition: {
                          duration: 0.5,
                          delay: 0.06 * idx,
                          ease: EASE,
                        },
                      }}
                      className={`card relative p-6 ${
                        p.highlight ? "ring-1 ring-primary/30" : ""
                      }`}
                    >
                      {p.highlight && (
                        <span
                          className={`absolute right-4 top-4 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ${
                            p.highlight === "best"
                              ? "bg-primary text-white"
                              : "bg-[color:var(--color-primary-50)] text-primary"
                          }`}
                        >
                          <FiZap className="icon" />
                          {p.highlight === "best" ? "Mejor valor" : "Popular"}
                        </span>
                      )}

                      <h3 className="font-display text-xl font-bold">
                        {p.name}
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {p.classesLabel}
                      </p>

                      <div className="mt-4">
                        <div className="flex items-baseline gap-1">
                          <span className="font-display text-3xl font-extrabold">
                            {formatMXN(p.price)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            / paquete
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {p.validity}
                        </p>
                      </div>

                      {p.description && p.description.length > 0 && (
                        <ul className="mt-4 space-y-2 text-sm">
                          {p.description.map((d, i) => (
                            <li
                              key={`${p.id}-desc-${i}`}
                              className="flex items-start gap-2 text-muted-foreground"
                            >
                              <FiCheck className="icon mt-0.5" />
                              <span>{d}</span>
                            </li>
                            
                          ))}
                          <li>
                                   {p.oncePerUser && (
  <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ${
                            p.highlight === "best"
                              ? "bg-primary text-white"
                              : "bg-[color:var(--color-primary-50)] text-primary"
                          }`}
                        >
                          Compra única
                        </span>
)}
                          </li>
                        </ul>
                      )}
               


                      <div className="mt-6 grid gap-2">
                        <button
                          className="btn-primary h-11 justify-center disabled:opacity-60"
                          onClick={() => handleBuy(p)}
                          disabled={isPending}
                        >
                          {isPending
                            ? "Creando enlace..."
                            : me
                            ? "Elegir paquete"
                            : "Inicia sesión para comprar"}
                        </button>

                        <Link
                          href="/clases"
                          className="btn-outline h-11 justify-center"
                        >
                          Ver calendario
                        </Link>
                      </div>
                    </motion.div>
                  );
                })
              : (
                <div className="col-span-full">
                  <div className="card p-10 text-center text-muted-foreground">
                    Sin paquetes por ahora
                  </div>
                </div>
              )
            : Array.from({ length: 6 }).map((_, idx) => (
                <div key={`sk-${idx}`} className="card p-6 animate-pulse">
                  <div className="h-5 w-1/2 bg-muted rounded" />
                  <div className="mt-2 h-4 w-1/3 bg-muted rounded" />
                  <div className="mt-4 h-9 w-2/3 bg-muted rounded" />
                  <div className="mt-2 h-3 w-1/4 bg-muted rounded" />
                  <div className="mt-4 space-y-2">
                    <div className="h-3 w-5/6 bg-muted rounded" />
                    <div className="h-3 w-4/6 bg-muted rounded" />
                  </div>
                  <div className="mt-6 grid gap-2">
                    <div className="h-11 bg-muted rounded" />
                    <div className="h-11 bg-muted rounded" />
                  </div>
                </div>
              ))}
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Precios en MXN. Sujeto a cambios sin previo aviso. Aplican términos y políticas de cancelación.
        </p>
      </div>
    </section>
  );
}
