// src/components/marketing/Hero.tsx
"use client";

import Link from "next/link";
import { motion, cubicBezier, type Variants } from "framer-motion";

const EASE = cubicBezier(0.22, 1, 0.36, 1);

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, delay: 0.12 * i, ease: EASE },
  }),
};

export default function Hero() {
  return (
    <section className="section relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60rem 60rem at 80% -10%, color-mix(in oklab, var(--color-primary) 18%, transparent), transparent 60%), radial-gradient(50rem 50rem at -10% 30%, color-mix(in oklab, var(--color-primary) 12%, transparent), transparent 55%)",
        }}
      />

      <div className="container-app grid gap-10 md:grid-cols-2 md:items-center">
        <div>
          <motion.p
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-80px" }}
            variants={fadeUp}
            custom={0}
            className="inline-flex items-center gap-2 rounded-full bg-[color:var(--color-primary-50)] px-3 py-1 text-xs font-semibold text-[color:hsl(201_44%_36%)]"
          >
            Bienestar • Comunidad • Movimiento
          </motion.p>

          <motion.h1
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-80px" }}
            variants={fadeUp}
            custom={1}
            className="mt-4 font-display text-4xl font-extrabold leading-tight md:text-6xl"
          >
            Elige tu poder primero en <span className="text-primary">WAVE Studio</span>
          </motion.h1>

          <motion.p
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-80px" }}
            variants={fadeUp}
            custom={2}
            className="mt-4 max-w-prose text-base text-muted-foreground md:text-lg"
          >
            Un espacio que fomenta el empoderamiento de las mujeres a través del
            movimiento consciente al ritmo de la música. Formamos una comunidad
            que busca balance y salud física y mental.
          </motion.p>

          <motion.div
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-80px" }}
            variants={fadeUp}
            custom={3}
            className="mt-8 flex flex-wrap items-center gap-3"
          >
            <Link href="/registro" className="btn-primary h-11 px-5">
              Reservar clase
            </Link>
            <Link href="/clases" className="btn-outline h-11 px-5">
              Ver clases
            </Link>
          </motion.div>

          <motion.ul
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-80px" }}
            variants={fadeUp}
            custom={4}
            className="mt-6 grid gap-2 text-sm text-muted-foreground"
          >
            <li>• Calendario semanal con cupo limitado</li>
            <li>• Reservas y compras desde tu cuenta</li>
            <li>• Comunidad segura y empática</li>
          </motion.ul>
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          whileInView={{ opacity: 1, scale: 1, transition: { duration: 0.8, ease: EASE } }}
          viewport={{ once: true, margin: "-80px" }}
          className="relative order-first aspect-[4/3] w-full overflow-hidden rounded-2xl border border-border shadow-soft md:order-none"
        >
          <img
            src="/images/hero.jpg"
            alt="Movimiento consciente en WAVE Studio"
            className="h-full w-full object-cover"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg, transparent, color-mix(in oklab, black 6%, transparent))",
            }}
          />
        </motion.div>
      </div>
    </section>
  );
}
