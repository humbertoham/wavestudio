"use client";

import { useState } from "react";
import { motion, AnimatePresence, cubicBezier } from "framer-motion";
import { FiChevronDown } from "react-icons/fi";

const EASE = cubicBezier(0.22, 1, 0.36, 1);

const FAQS = [
  {
    q: "¿Necesito experiencia previa para tomar clases?",
    a: "No. Todas las clases están diseñadas para adaptarse a diferentes niveles. Puedes empezar desde cero y avanzar a tu ritmo.",
  },
  {
    q: "¿Cómo puedo reservar mi lugar?",
    a: "Al crear tu cuenta podrás reservar y pagar directamente desde la plataforma en línea, de forma rápida y segura.",
  },
  {
    q: "¿Los paquetes tienen vigencia?",
    a: "Sí. Los paquetes de 1 y 4 clases tienen vigencia de 14 días, mientras que los de 10, 15 y Unlimited son válidos por 30 días.",
  },
  {
    q: "¿Qué necesito llevar a clase?",
    a: "Ropa cómoda, tenis o calcetas antideslizantes según la clase, y tu botella de agua. El resto del material lo ponemos nosotras.",
  },
  {
    q: "¿Puedo cancelar o reagendar una clase?",
    a: "Sí, siempre que lo hagas con al menos 12 horas de anticipación. Así liberamos tu lugar para otra persona de la comunidad.",
  },
];

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-left font-medium"
        aria-expanded={open}
      >
        <span>{q}</span>
        <FiChevronDown
          className={`icon transition-transform duration-300 ${
            open ? "rotate-180 text-primary" : "rotate-0"
          }`}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1, transition: { ease: EASE, duration: 0.4 } }}
            exit={{ height: 0, opacity: 0, transition: { ease: EASE, duration: 0.3 } }}
            className="px-4 pb-4 text-sm text-muted-foreground"
          >
            {a}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function FAQ() {
  return (
    <section className="section">
      <div className="container-app max-w-3xl">
        <h2 className="font-display text-3xl font-extrabold text-center md:text-4xl">
          Preguntas frecuentes
        </h2>
        <p className="mt-2 text-center text-muted-foreground">
          Resolvemos las dudas más comunes sobre WAVE Studio.
        </p>

        <div className="mt-8 grid gap-3">
          {FAQS.map((faq) => (
            <FAQItem key={faq.q} q={faq.q} a={faq.a} />
          ))}
        </div>
      </div>
    </section>
  );
}
