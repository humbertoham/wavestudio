// src/app/(marketing)/acerca/page.tsx
"use client";

import { motion, cubicBezier } from "framer-motion";

const EASE = cubicBezier(0.22, 1, 0.36, 1);

export default function AboutPage() {
  return (
    <section className="section">
      <div className="container-app grid gap-10 md:grid-cols-2 md:items-center">
        {/* Columna texto */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
        >
          <h1 className="font-display text-3xl font-extrabold md:text-4xl">
            Sobre <span className="text-primary">WAVE Studio</span>
          </h1>

          <p className="mt-4 text-base text-muted-foreground md:text-lg leading-relaxed">
            WAVE Studio es un espacio que fomenta el empoderamiento de las mujeres
            a través del movimiento consciente al ritmo de la música.
          </p>

          <p className="mt-4 text-base text-muted-foreground md:text-lg leading-relaxed">
            Aquí formamos una comunidad en búsqueda de balance y bienestar, tanto físico como mental.
            Creemos en la fuerza que surge al elegirte primero, al dedicarte tiempo y
            energía para crecer en armonía con tu cuerpo y mente.
          </p>

          <p className="mt-4 text-base text-muted-foreground md:text-lg leading-relaxed font-semibold">
            ¡Te invitamos a descubrir lo poderoso que es priorizarte y elegirte a ti misma!
          </p>
        </motion.div>

        {/* Columna imagen (puedes cambiar la ruta de la imagen en /public/images/about.jpg) */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, ease: EASE }}
          className="order-first md:order-none"
        >
          <div className="card overflow-hidden">
            <img
              src="/images/about.jpg"
              alt="Mujeres entrenando en WAVE Studio"
              className="h-full w-full object-cover"
            />
          </div>
        </motion.div>
      </div>
    </section>
  );
}
