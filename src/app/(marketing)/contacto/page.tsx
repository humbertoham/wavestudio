// src/app/(marketing)/contacto/page.tsx
"use client";

import { useState } from "react";
import { motion, cubicBezier } from "framer-motion";
import Link from "next/link";
import { FiHelpCircle, FiInstagram, FiSend } from "react-icons/fi";

const EASE = cubicBezier(0.22, 1, 0.36, 1);

export default function ContactPage() {
  const [sent, setSent] = useState(false);

  return (
    <section className="section">
      <div className="container-app grid gap-10 lg:grid-cols-[1.1fr_.9fr]">
        {/* Intro / info compacta (sin repetir footer) */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } }}
        >
          <h1 className="font-display text-3xl font-extrabold md:text-4xl">
            Hablemos ✨
          </h1>
          <p className="mt-3 text-muted-foreground max-w-prose">
            Cuéntanos qué necesitas y te respondemos a la brevedad. Si es acerca de
            reservas, pagos o clases, deja el máximo contexto posible.
          </p>

          {/* Motivos frecuentes */}
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="card p-4">
              <h3 className="font-display text-sm font-bold">¿En qué podemos ayudarte?</h3>
              <ul className="mt-2 text-sm text-muted-foreground space-y-1">
                <li>• Dudas sobre paquetes o membresías</li>
                <li>• Problemas con tu reserva</li>
                <li>• Cambios o cancelaciones</li>
                <li>• Colaboraciones / prensa</li>
              </ul>
            </div>

            <div className="card p-4">
              <h3 className="font-display text-sm font-bold">Tiempos de respuesta</h3>
              <ul className="mt-2 text-sm text-muted-foreground space-y-1">
                <li>• Lunes a viernes: 10:00–18:00</li>
                <li>• Sábados: 10:00–14:00</li>
                <li>• Respondemos en &lt;24 h hábiles</li>
              </ul>
            </div>
          </div>

          {/* Enlaces útiles (sin duplicar info del footer) */}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link href="/faq" className="btn-outline">
              <FiHelpCircle className="icon" />
              <span className="ml-1">Ver preguntas frecuentes</span>
            </Link>
            <a
              href="https://www.instagram.com/wavestudio.mx/"
              target="_blank"
              rel="noreferrer"
              className="btn-ghost"
              aria-label="Instagram de WAVE Studio"
              title="Instagram"
            >
              <FiInstagram className="icon" />
              <span className="ml-1">Síguenos en Instagram</span>
            </a>
          </div>

          {/* Nota breve */}
          <p className="mt-3 text-xs text-muted-foreground">
            *La información de dirección, teléfono y mapa se encuentra en el footer.
          </p>
        </motion.div>

        {/* Formulario principal */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } }}
        >
          <div className="card p-6">
            <h2 className="font-display text-xl font-bold">Envíanos un mensaje</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Te contestaremos por correo electrónico.
            </p>

            {!sent ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  // Aquí integrarías tu backend o servicio (Resend, Formspree, EmailJS, etc.)
                  setSent(true);
                }}
                className="mt-6 space-y-4"
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium mb-1">Nombre</label>
                    <input
                      type="text"
                      name="name"
                      required
                      className="input"
                      placeholder="Tu nombre"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Correo</label>
                    <input
                      type="email"
                      name="email"
                      required
                      className="input"
                      placeholder="tu@email.com"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Asunto</label>
                  <input
                    type="text"
                    name="subject"
                    required
                    className="input"
                    placeholder="Tema del mensaje"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Mensaje</label>
                  <textarea
                    name="message"
                    rows={5}
                    required
                    className="input"
                    placeholder="Cuéntanos con detalle tu solicitud…"
                  />
                </div>

                <button type="submit" className="btn-primary w-full h-11">
                  <FiSend className="icon" />
                  <span className="ml-1">Enviar mensaje</span>
                </button>
              </form>
            ) : (
              <div className="mt-6 grid place-items-center text-center">
                <div className="rounded-2xl bg-[color:var(--color-primary-50)] px-4 py-3 text-[color:hsl(201_44%_36%)]">
                  ¡Gracias! Tu mensaje fue enviado.
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  Te responderemos en menos de 24 horas hábiles. Revisa tu bandeja de entrada y de spam.
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-3">
                  <Link href="/clases" className="btn-outline h-10">
                    Ver calendario
                  </Link>
                  <Link href="/precios" className="btn-primary h-10">
                    Ver paquetes
                  </Link>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
