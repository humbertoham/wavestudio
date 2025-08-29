// src/app/(marketing)/clases/page.tsx
"use client";

import { motion, cubicBezier, type Variants } from "framer-motion";
import { FiClock, FiUser } from "react-icons/fi";
import { useMemo } from "react";

const EASE = cubicBezier(0.22, 1, 0.36, 1);

type Session = {
  id: string;
  title: string;
  focus?: string;
  time: string;
  coach: string;
  duration: string;
  status?: "BOOK" | "FULL";
};

type Day = {
  id: string;
  dow: "LUN" | "MAR" | "MIÉ" | "JUE" | "VIE" | "SÁB" | "DOM";
  dateLabel: string;
  sessions: Session[];
};

// --- MOCK basado en tu formato ---
const WEEK: Day[] = [
  {
    id: "d1",
    dow: "LUN",
    dateLabel: "01 ABR",
    sessions: [
      { id: "1", title: "BOOK YOUR MAT", time: "—", coach: "—", duration: "—", status: "BOOK" },
      { id: "2", title: "FULL BODY", time: "5:30 AM", coach: "KARLA", duration: "60MIN" },
    ],
  },
  {
    id: "d2",
    dow: "MAR",
    dateLabel: "02 ABR",
    sessions: [
      { id: "3", title: "LOWER BODY", time: "5:30 AM", coach: "KARLA", duration: "60MIN" },
      { id: "4", title: "PULL", focus: "UPPER BODY", time: "5:30 AM", coach: "KARLA", duration: "60MIN" },
      { id: "5", title: "FULL BODY", time: "10:30 AM", coach: "KARLA", duration: "60MIN" },
    ],
  },
  {
    id: "d3",
    dow: "MIÉ",
    dateLabel: "03 ABR",
    sessions: [
      { id: "6", title: "PUSH", focus: "UPPER BODY", time: "5:30 AM", coach: "KARLA", duration: "60MIN" },
      { id: "7", title: "LOWER BODY", focus: "GLUTE & HAM", time: "5:30 AM", coach: "KARLA", duration: "60MIN" },
    ],
  },
  {
    id: "d4",
    dow: "JUE",
    dateLabel: "04 ABR",
    sessions: [
      { id: "8", title: "FULL BODY", time: "5:30 AM", coach: "KARLA", duration: "60MIN" },
      { id: "9", title: "FULL BODY", time: "10:30 AM", coach: "KARLA", duration: "60MIN" },
    ],
  },
  {
    id: "d5",
    dow: "VIE",
    dateLabel: "05 ABR",
    sessions: [
      { id: "10", title: "LOWER BODY", time: "5:30 AM", coach: "KARLA", duration: "60MIN" },
      { id: "11", title: "PULL", focus: "UPPER BODY", time: "5:30 AM", coach: "KARLA", duration: "60MIN" },
    ],
  },
  {
    id: "d6",
    dow: "SÁB",
    dateLabel: "06 ABR",
    sessions: [
      { id: "12", title: "PUSH", focus: "UPPER BODY", time: "5:30 AM", coach: "KARLA", duration: "60MIN" },
      { id: "13", title: "LOWER BODY", focus: "GLUTE & HAM", time: "5:30 AM", coach: "KARLA", duration: "60MIN" },
      { id: "14", title: "FULL BODY", time: "10:30 AM", coach: "KARLA", duration: "60MIN", status: "FULL" },
    ],
  },
  {
    id: "d7",
    dow: "DOM",
    dateLabel: "07 ABR",
    sessions: [{ id: "15", title: "FULL BODY", time: "10:30 AM", coach: "KARLA", duration: "60MIN" }],
  },
];

const colVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, delay: 0.04 * i, ease: EASE },
  }),
};

const cardVariants: Variants = {
  hidden: { opacity: 0, scale: 0.98 },
  show: { opacity: 1, scale: 1, transition: { duration: 0.3, ease: EASE } },
};

function SessionCard({ s }: { s: Session }) {
  const statusEl = useMemo(() => {
    if (s.status === "FULL") {
      return (
        <span className="ml-auto rounded-full bg-[color:var(--color-muted)] px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
          FULL
        </span>
      );
    }
    if (s.status === "BOOK") {
      return (
        <span className="ml-auto rounded-full bg-[color:var(--color-primary-50)] px-2 py-0.5 text-[11px] font-semibold text-[color:hsl(201_44%_36%)]">
          BOOK YOUR MAT
        </span>
      );
    }
    return null;
  }, [s.status]);

  const canBook = s.status !== "FULL" && s.time !== "—";

  return (
    <motion.div variants={cardVariants} className="card p-3 h-36 md:h-40 flex flex-col">
      {/* Título y estado — más compacto */}
      <div className="flex items-center gap-2">
        <h4 className="font-display text-sm font-bold truncate">{s.title}</h4>
        {statusEl}
      </div>
      {s.focus && <div className="mt-0.5 text-xs text-muted-foreground truncate">{s.focus}</div>}

      {/* Meta compacta */}
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-1 min-w-0">
          <FiClock className="icon" />
          <span className="truncate">{s.time}</span>
        </div>
        <div className="flex items-center gap-1 justify-end min-w-0">
          <FiUser className="icon" />
          <span className="truncate">{s.coach}</span>
        </div>
      </div>

      <div className="mt-1 text-[11px] text-muted-foreground">{s.duration}</div>

      {/* Botón fijo abajo */}
      <div className="mt-auto pt-2">
        {canBook ? (
          <button className="btn-primary h-9 w-full justify-center text-sm">Reservar</button>
        ) : (
          <button className="btn-outline h-9 w-full justify-center text-sm" disabled>
            No disponible
          </button>
        )}
      </div>
    </motion.div>
  );
}

function DayColumn({ day, index }: { day: Day; index: number }) {
  return (
    <motion.div
      custom={index}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-80px" }}
      variants={colVariants}
      className="card overflow-hidden flex flex-col h-[540px] md:h-[560px] snap-start"
      style={{ minWidth: "17rem" }} // ≈272px — columnas más anchas
    >
      {/* Header del día */}
      <div className="px-3 py-2 bg-[color:var(--color-primary-50)] text-center font-display text-sm font-bold text-[color:hsl(201_44%_36%)]">
        <div>{day.dow}</div>
        <div className="text-[11px] font-semibold opacity-80">{day.dateLabel}</div>
      </div>

      {/* Lista con scroll interno */}
      <div className="flex-1 overflow-auto p-3 space-y-3">
        {day.sessions.length ? (
          day.sessions.map((s) => <SessionCard key={s.id} s={s} />)
        ) : (
          <div className="grid h-full place-items-center text-sm text-muted-foreground">Sin clases</div>
        )}
      </div>
    </motion.div>
  );
}

export default function ClassesPage() {
  return (
    <section className="section">
      <div className="container-app">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } }}
          className="mx-auto max-w-2xl text-center"
        >
          <h1 className="font-display text-3xl font-extrabold md:text-4xl">Calendario de clases</h1>
          <p className="mt-2 text-muted-foreground">
          Elige tu sesión y reserva tu lugar.
          </p>
        </motion.div>

        {/* 📌 Grid en flujo de columnas con ancho mínimo y scroll horizontal */}
        <div className="mt-8 grid grid-flow-col auto-cols-[minmax(17rem,1fr)] gap-4 overflow-x-auto pb-2 snap-x snap-mandatory">
          {WEEK.map((day, i) => (
            <DayColumn key={day.id} day={day} index={i} />
          ))}
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Horarios sujetos a cambios. Reserva con anticipación para asegurar tu lugar.
        </p>
      </div>
    </section>
  );
}
