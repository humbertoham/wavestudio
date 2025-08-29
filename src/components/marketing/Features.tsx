// src/components/marketing/Features.tsx
"use client";

import { motion, cubicBezier, type Variants } from "framer-motion";
import {
  FiCalendar,
  FiShield,
  FiUsers,
  FiMapPin,
  FiActivity,
  FiAward,
} from "react-icons/fi";

const EASE = cubicBezier(0.22, 1, 0.36, 1);

const container: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08, ease: EASE },
  },
};

const item: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
};

const FEATURES = [
  {
    icon: FiActivity,
    title: "Clases variadas",
    desc: "Yoga flow, dance energy y más, para todos los niveles.",
  },
  {
    icon: FiCalendar,
    title: "Cupo limitado & reservas",
    desc: "Agenda tu lugar en segundos desde tu cuenta.",
  },
  {
    icon: FiShield,
    title: "Pagos seguros",
    desc: "Proceso de compra claro y confiable.",
  },
  {
    icon: FiUsers,
    title: "Comunidad & bienestar",
    desc: "Espacio seguro para priorizarte y crecer en tribu.",
  },
  {
    icon: FiAward,
    title: "Instructores certificados",
    desc: "Acompañamiento profesional y cercano.",
  },
  {
    icon: FiMapPin,
    title: "Ubicación conveniente",
    desc: "Vista Hermosa, Monterrey — fácil acceso y estacionamiento.",
  },
];

export default function Features() {
  return (
    <section className="section">
      <div className="container-app">
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
          variants={container}
          className="mx-auto max-w-2xl text-center"
        >
          <motion.h2 variants={item} className="font-display text-3xl md:text-4xl font-extrabold">
            Diseñado para tu bienestar
          </motion.h2>
          <motion.p variants={item} className="mt-3 text-muted-foreground">
            Empodérate con movimiento consciente, comunidad y una experiencia clara de reserva y compra.
          </motion.p>
        </motion.div>

        <motion.ul
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
          variants={container}
          className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {FEATURES.map(({ icon: Icon, title, desc }) => (
            <motion.li key={title} variants={item} className="card p-5">
              <div className="flex items-start gap-4">
                <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[color:var(--color-primary-50)] text-primary">
                  <Icon className="icon" />
                </span>
                <div>
                  <h3 className="font-display text-lg font-bold">{title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
                </div>
              </div>
            </motion.li>
          ))}
        </motion.ul>
      </div>
    </section>
  );
}
