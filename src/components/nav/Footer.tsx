// src/components/nav/Footer.tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { FiInstagram, FiPhone, FiMail, FiMapPin } from "react-icons/fi";

/** Hook: detecta si el sitio está en dark
 * - Prioriza la clase en <html>. Si hay 'dark', usa dark.
 * - Si NO hay override manual, cae al prefers-color-scheme del SO.
 */
function useIsDark() {
  const [isDark, setIsDark] = useState<boolean>(false);

  useEffect(() => {
    const root = document.documentElement;

    const compute = () => {
      const hasDark = root.classList.contains("dark");
      const hasLight = root.classList.contains("light"); // por si alguien usa esta clase
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      // Si hay override en clases, gana la clase. Si no, usa prefers.
      return hasDark ? true : hasLight ? false : prefersDark;
    };

    setIsDark(compute());

    // Observa cambios en la clase del <html>
    const obs = new MutationObserver(() => setIsDark(compute()));
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });

    // Escucha cambios del sistema
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setIsDark(compute());
    mql.addEventListener?.("change", onChange);

    return () => {
      obs.disconnect();
      mql.removeEventListener?.("change", onChange);
    };
  }, []);

  return isDark;
}

export default function Footer() {
  const isDark = useIsDark();

  // Un solo <Image> que respeta width/height (sin h-8/w-auto)
  const logoSrc = useMemo(() => (isDark ? "/logo-dark.png" : "/logo-light.png"), [isDark]);

  return (
    <footer className="mt-16 border-t border-border bg-[color:var(--color-background)]">
      <div className="container-app py-10">
        <div className="grid gap-8 lg:grid-cols-2">
          {/* Columna izquierda: info + links */}
          <div className="space-y-6">
            {/* Branding */}
            <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2">
  <span className="logo" aria-label="WAVE Studio"></span>
</Link>
            </div>

            <p className="max-w-prose text-sm text-muted-foreground">
              Empoderamiento a través del movimiento consciente al ritmo de la música.
              Únete a nuestra comunidad y prioriza tu bienestar físico y mental.
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              {/* Contacto */}
              <div className="card p-4">
                <h4 className="font-display text-sm font-extrabold">Contacto</h4>
                <ul className="mt-3 space-y-2 text-sm">
                  <li className="flex items-center gap-2 text-muted-foreground">
                    <FiPhone className="icon" />
                    <a href="tel:+528128877484" className="hover:underline">
                      +52 812 887 7484
                    </a>
                  </li>
                  <li className="flex items-center gap-2 text-muted-foreground">
                    <FiMail className="icon" />
                    <a href="mailto:wwavestudio@outlook.com" className="hover:underline">
                      wwavestudio@outlook.com
                    </a>
                  </li>
                  <li className="flex items-center gap-2 text-muted-foreground">
                    <FiMapPin className="icon" />
                    <span>1a Avenida 1495, Vista Hermosa, 64620 Monterrey, N.L.</span>
                  </li>
                </ul>

                <div className="mt-3 flex items-center gap-3">
                  <a
                    href="https://www.instagram.com/wavestudio.mx/"
                    target="_blank"
                    rel="noreferrer"
                    className="icon-btn ig"
                    aria-label="Instagram"
                    title="Instagram"
                  >
                    <FiInstagram className="icon" />
                  </a>
                </div>
              </div>

              {/* Enlaces rápidos */}
              <div className="card p-4">
                <h4 className="font-display text-sm font-extrabold">Enlaces</h4>
                <ul className="mt-3 grid gap-2 text-sm text-muted-foreground">
                  <li><Link href="/acerca" className="hover:text-foreground">Acerca</Link></li>
                  <li><Link href="/clases" className="hover:text-foreground">Clases</Link></li>
                  <li><Link href="/precios" className="hover:text-foreground">Precios</Link></li>
                  <li><Link href="/contacto" className="hover:text-foreground">Contacto</Link></li>
                  <li><Link href="/#FAQ" className="hover:text-foreground">Preguntas frecuentes</Link></li>
                  <li><Link href="/terminos" className="hover:text-foreground">Políticas & Términos</Link></li>
                </ul>
                <div className="mt-4">
                  <Link href="/login" className="btn-primary">Reservar clase</Link>
                </div>
              </div>
            </div>
          </div>

          {/* Columna derecha: mapa */}
          <div>
            <div className="card overflow-hidden">
              <div className="relative w-full aspect-[16/9]">
                <iframe
                  title="Ubicación WAVE Studio en Google Maps"
                  src="https://www.google.com/maps/embed?pb=!1m14!1m8!1m3!1d28760.730852351542!2d-100.3710868!3d25.7013991!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x86629746323fb619%3A0x6352c3919595d744!2swavestudio!5e0!3m2!1ses!2smx!4v1756475335440!5m2!1ses!2smx"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  allowFullScreen
                  className="absolute inset-0 h-full w-full border-0"
                />
              </div>
            </div>

            <p className="mt-3 text-xs text-muted-foreground">
              *El mapa es referencial. Confirma horarios y disponibilidad de clases al reservar.
            </p>
          </div>
        </div>
      </div>

      {/* Lower bar */}
      <div className="border-t border-border">
        <div className="container-app flex flex-col items-center justify-between gap-3 py-4 text-xs text-muted-foreground md:flex-row">
          <span>© {new Date().getFullYear()} WAVE Studio — Todos los derechos reservados</span>
          <div className="flex items-center gap-4">
            <Link href="/privacidad" className="hover:text-foreground">Privacidad</Link>
            <Link href="/terminos" className="hover:text-foreground">Términos</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
