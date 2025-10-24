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
            En WaveStudio, nos apasiona ir más allá del ejercicio físico. Nos esforzamos por crear un espacio donde la fuerza, la resistencia, el balance y la conciencia se fusionen en una experiencia de entrenamiento única.
          </p>

          <p className="mt-4 text-base text-muted-foreground md:text-lg leading-relaxed">
            En cada sesión, nos enfocamos en conectar con nuestro cuerpo de manera profunda, explorando sus límites y liberando su potencial oculto.
          </p>

          
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, ease: EASE }}
          className=" md:order-none"
        >
          <div className="card overflow-hidden">
            <img
              src="/39.png"
              alt="Mujeres entrenando en WAVE Studio"
              className="h-full w-full object-cover"
            />
          </div>
        </motion.div>
      </div>
    </section>
  );
}
