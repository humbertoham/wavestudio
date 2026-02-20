"use client";

import { useId, useState } from "react";
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
    a: "Sí, cada paquete tiene un período de vigencia específico. Consulta en cada paquete cuántos días tienes para usar tus clases.",
  },
  {
    q: "¿Qué necesito llevar a clase?",
    a: "Ropa cómoda, calcetas o calcetines antiderrapantes, y tu botella de agua. El resto del material lo ponemos nosotros.",
  },
  {
    q: "¿Puedo cancelar o reagendar una clase?",
    a: "Sí, siempre que lo hagas con al menos 4 horas de anticipación, así liberamos tu lugar para alguien más de la comunidad.\n\nSi necesitas cancelar con menos de 4 horas, te pedimos por favor que nos avises por Instagram. Y si eres usuario de Wellhub o TotalPass, es muy importante que también canceles o nos contactes en caso de no poder asistir.",
  },
];

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  const contentId = useId();

  return (
    <motion.div
      layout
      transition={{ ease: EASE, duration: 0.35 }}
      className="card overflow-hidden rounded-2xl border bg-background/60 backdrop-blur"
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left font-medium"
        aria-expanded={open}
        aria-controls={contentId}
      >
        <span className="pr-4">{q}</span>
        <FiChevronDown
          className={`shrink-0 transition-transform duration-300 ${
            open ? "rotate-180 text-primary" : "rotate-0"
          }`}
          aria-hidden="true"
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            id={contentId}
            layout
            initial={{ height: 0, opacity: 0 }}
            animate={{
              height: "auto",
              opacity: 1,
              transition: { ease: EASE, duration: 0.35 },
            }}
            exit={{
              height: 0,
              opacity: 0,
              transition: { ease: EASE, duration: 0.28 },
            }}
            style={{ willChange: "height, opacity" }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 text-sm leading-relaxed text-muted-foreground whitespace-pre-line">
              {a}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function FAQ() {
  return (
    <motion.section layout className="section"  id="faq">
      <div className="container-app max-w-3xl">
        <h2 className="font-display text-3xl font-extrabold text-center md:text-4xl">
          Preguntas frecuentes
        </h2>
        <p className="mt-2 text-center text-muted-foreground">
          Resolvemos las dudas más comunes sobre WAVE Studio.
        </p>

        <motion.div
          layout
          className="mt-8 grid gap-3"
          transition={{ ease: EASE, duration: 0.35 }}
        >
          {FAQS.map((faq) => (
            <FAQItem key={faq.q} q={faq.q} a={faq.a} />
          ))}
        </motion.div>
      </div>
    </motion.section>
  );
}
