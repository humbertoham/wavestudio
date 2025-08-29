// src/components/marketing/CallToAction.tsx
"use client";

import Link from "next/link";
import { motion, cubicBezier, type Variants } from "framer-motion";

const EASE = cubicBezier(0.22, 1, 0.36, 1);

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, delay: 0.12 * i, ease: EASE },
  }),
};

export default function CallToAction() {
  return (
    <section className="section relative overflow-hidden">
      {/* Fondo con gradiente suave */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-gradient-to-br from-[color:var(--color-primary-50)] via-transparent to-transparent"
      />

      <div className="container-app text-center">
        <motion.h2
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
          variants={fadeUp}
          custom={0}
          className="font-display text-3xl font-extrabold md:text-4xl"
        >
          ¿Lista para priorizarte?
        </motion.h2>

        <motion.p
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
          variants={fadeUp}
          custom={1}
          className="mx-auto mt-3 max-w-2xl text-base text-muted-foreground md:text-lg"
        >
          Únete a WAVE Studio y descubre lo poderoso que es elegirte primero.
          Reserva tu primera clase hoy mismo.
        </motion.p>

        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
          variants={fadeUp}
          custom={2}
          className="mt-8 flex flex-wrap justify-center gap-4"
        >
          <Link href="/registro" className="btn-primary h-11 px-6">
            Reservar clase
          </Link>
          <Link href="/clases" className="btn-outline h-11 px-6">
            Ver calendario
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
