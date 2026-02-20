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
  oncePerUser?: boolean;
};

type Pack = {
  id: string;
  name: string;
  classesLabel: string;
  price: number;
  validity: string;
  highlight?: "popular" | "best";
  description?: string[];
  oncePerUser: boolean;
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
    oncePerUser: !!p.oncePerUser,
  };
}

export default function PricingPage() {
  const router = useRouter();

  const [packs, setPacks] = useState<Pack[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [me, setMe] = useState<Me>(null);
  const [checkingMe, setCheckingMe] = useState(true);
  const [myPackIds, setMyPackIds] = useState<Set<string>>(new Set());
  const [pendingPackId, setPendingPackId] = useState<string | null>(null);

  /* =========================
     1️⃣ Cargar packs y usuario
     ========================= */
  useEffect(() => {
    let mounted = true;

    async function loadPacks() {
      try {
        const res = await fetch("/api/packs", { cache: "no-store" });
        if (!res.ok) throw new Error();
        const data: ApiPack[] = await res.json();
        if (!mounted) return;
        setPacks(data.map(toPack));
      } catch {
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
        } else {
          setMe(null);
        }
      } finally {
        setCheckingMe(false);
      }
    }

    loadPacks();
    loadMe();

    return () => {
      mounted = false;
    };
  }, []);

  /* =========================
     2️⃣ Cargar packs del usuario
     ========================= */
  useEffect(() => {
  async function loadOncePerUser() {
    if (!me?.id) {
      setMyPackIds(new Set());
      return;
    }

    try {
      const r = await fetch("/api/users/me/onceperuser", {
        cache: "no-store",
      });

      if (!r.ok) return;

      const packIds: string[] = await r.json();
      setMyPackIds(new Set(packIds));
    } catch {
      /* noop */
    }
  }

  loadOncePerUser();
}, [me]);
  /* =========================
     3️⃣ Filtrar oncePerUser
     ========================= */
  const visiblePacks = useMemo(() => {
    if (!packs) return null;

    return packs.filter(p => {
      if (!p.oncePerUser) return true;
      if (!me) return true;
      return !myPackIds.has(p.id);
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
            userId: me.id,
          }),
        });

        const raw = await res.text();
        let data: any = null;
        try {
          data = raw ? JSON.parse(raw) : null;
        } catch {}

        if (!res.ok) {
          console.error(data ?? raw);
          throw new Error();
        }

        const checkoutUrl: string | undefined =
          data?.checkoutUrl ?? data?.initPoint;

        if (!checkoutUrl) {
          throw new Error("La API no devolvió checkoutUrl");
        }

        window.location.href = checkoutUrl;
      } catch {
        alert("No se pudo iniciar la compra. Inténtalo de nuevo.");
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
            Elige el plan que mejor se adapte a tu ritmo.
          </p>
        </motion.div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 items-stretch">
          {ordered?.map((p, idx) => {
            const isPending = pendingPackId === p.id;

            return (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 18 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  transition: { duration: 0.5, delay: 0.06 * idx, ease: EASE },
                }}
                className="card relative p-6 flex flex-col h-full"
              >
              
                <div className="flex-1 flex flex-col">
                  <h3 className="font-display text-xl font-bold">{p.name}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {p.classesLabel}
                  </p>

                  <div className="mt-4">
                    <span className="font-display text-3xl font-extrabold">
                      {formatMXN(p.price)}
                    </span>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {p.validity}
                    </p>
                  </div>

                  {p.description && (
                    <ul className="mt-4 space-y-2 text-sm">
                      {p.description.map((d, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <FiCheck className="icon mt-0.5" />
                          <span>{d}</span>
                        </li>
                      ))}
                      {p.oncePerUser && (
                        <li className="text-xs font-semibold text-primary">
                          Compra única
                        </li>
                      )}
                    </ul>
                  )}
                </div>

                <div className="mt-auto pt-6 grid gap-2">
                  <button
                    className="btn-primary h-11"
                    onClick={() => handleBuy(p)}
                    disabled={isPending}
                  >
                    {isPending
                      ? "Creando enlace..."
                      : me
                      ? "Elegir paquete"
                      : "Inicia sesión para comprar"}
                  </button>

                  <Link href="/clases" className="btn-outline h-11">
                    Ver calendario
                  </Link>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
