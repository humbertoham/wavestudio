// src/app/(marketing)/precios/page.tsx
"use client";

import { motion, cubicBezier } from "framer-motion";
import { FiCheck, FiZap } from "react-icons/fi";
import Link from "next/link";

type Pack = {
  name: string;
  classesLabel: string;
  price: number; // en MXN
  validity: string;
  highlight?: "popular" | "best";
  description?: string[];
};

const EASE = cubicBezier(0.22, 1, 0.36, 1);

const PACKS: Pack[] = [
  {
    name: "1 Clase",
    classesLabel: "1 clase",
    price: 180,
    validity: "Vigencia de 14 días",
    description: ["Ideal para probar WAVE", "Acceso a cualquier clase"],
  },
  {
    name: "4 Clases",
    classesLabel: "4 clases",
    price: 720, // 4 x 180
    validity: "Vigencia de 14 días",
    highlight: "popular",
    description: ["Flexibilidad en tu semana", "Reserva fácil desde tu cuenta"],
  },
  {
    name: "10 Clases",
    classesLabel: "10 clases",
    price: 1600,
    validity: "Vigencia de 30 días",
    description: ["Mejor costo por clase", "Perfecto para constancia"],
  },
  {
    name: "15 Clases",
    classesLabel: "15 clases",
    price: 2100,
    validity: "Vigencia de 30 días",
    description: ["Entrena 3–4 veces por semana", "Ahorro adicional"],
  },
  {
    name: "UNLIMITED",
    classesLabel: "Acceso ilimitado",
    price: 2900,
    validity: "Vigencia de 30 días",
    highlight: "best",
    description: ["Todas las clases del mes", "Prioridad en reservaciones"],
  },
];

const formatMXN = (n: number) =>
  n.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });

export default function PricingPage() {
  return (
    <section className="section">
      <div className="container-app">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } }}
          className="mx-auto max-w-2xl text-center"
        >
          <h1 className="font-display text-3xl font-extrabold md:text-4xl">Paquetes de entrenamiento</h1>
          <p className="mt-3 text-muted-foreground">
            Elige el plan que mejor se adapte a tu ritmo. Todos pueden reservar desde la plataforma.
          </p>
        </motion.div>

        {/* Grid de precios */}
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PACKS.map((p, idx) => (
            <motion.div
              key={p.name}
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, delay: 0.06 * idx, ease: EASE } }}
              className={`card relative p-6 ${p.highlight ? "ring-1 ring-primary/30" : ""}`}
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

              <h3 className="font-display text-xl font-bold">{p.name}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{p.classesLabel}</p>

              <div className="mt-4">
                <div className="flex items-baseline gap-1">
                  <span className="font-display text-3xl font-extrabold">
                    {formatMXN(p.price)}
                  </span>
                  <span className="text-xs text-muted-foreground">/ paquete</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{p.validity}</p>
              </div>

              {/* Bullets opcionales */}
              {p.description && (
                <ul className="mt-4 space-y-2 text-sm">
                  {p.description.map((d) => (
                    <li key={d} className="flex items-start gap-2 text-muted-foreground">
                      <FiCheck className="icon mt-0.5" />
                      <span>{d}</span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-6 grid gap-2">
                <Link href="/registro" className="btn-primary h-11 justify-center">
                  Elegir paquete
                </Link>
                <Link href="/clases" className="btn-outline h-11 justify-center">
                  Ver calendario
                </Link>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Nota legal / aclaración */}
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Precios en MXN. Sujeto a cambios sin previo aviso. Aplican términos y políticas de cancelación.
        </p>
      </div>
    </section>
  );
}
