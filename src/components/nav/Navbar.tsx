"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  FiMenu,
  FiX,
  FiUser,
  FiSun,
  FiMoon,
  FiInstagram,
  FiPhone,
  FiMail,
  FiMapPin,
  FiLogOut,
  FiUserCheck,
  FiCalendar,
} from "react-icons/fi";
import { motion, AnimatePresence } from "framer-motion";
import { useSession } from "@/lib/useSession";

const NAV_LINKS = [
  { href: "/", label: "Inicio" },
  { href: "/acerca", label: "Acerca" },
  { href: "/clases", label: "Clases" },
  { href: "/precios", label: "Precios" },
  { href: "/contacto", label: "Contacto" },
];

const SECONDARY_LINKS = [
  { href: "/faq", label: "Preguntas frecuentes" },
  { href: "/politicas", label: "Políticas & Términos" },
];

function getInitials(name?: string) {
  if (!name) return "U";
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  
  const [open, setOpen] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const { user, isAuthenticated, isLoading, refresh } = useSession();

  // Persistencia de tema
  useEffect(() => {
    const root = document.documentElement;
    const stored = localStorage.getItem("theme");
    if (stored === "dark") root.classList.add("dark");
    if (stored === "light") root.classList.remove("dark");
    setIsDark(root.classList.contains("dark"));
  }, []);

  const toggleTheme = () => {
    const root = document.documentElement;
    root.classList.toggle("dark");
    const dark = root.classList.contains("dark");
    localStorage.setItem("theme", dark ? "dark" : "light");
    setIsDark(dark);
  };

  // Cierra el menú al navegar
  useEffect(() => {
    setOpen(false);
    setUserMenuOpen(false);
  }, [pathname]);

  const initials = useMemo(() => getInitials(user?.name), [user]);

 async function handleLogout() {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
    });
  } catch {
    // ignora
  } finally {
    setUserMenuOpen(false);

    // Si estabas en rutas privadas, haz un hard redirect al home
    if (pathname.startsWith("/cuenta") || pathname.startsWith("/admin")) {
      window.location.replace("/"); // no deja historial de la ruta privada
      return;
    }

    // En rutas públicas, recarga dura la página actual
    window.location.reload();
  }
}


  return (
    <header className="sticky top-0 z-50 bg-[color:var(--color-background)/0.8] backdrop-blur border-b border-border">
      <nav className="container-app flex h-16 items-center justify-between">
        {/* Logo */}
       <Link href="/" className="flex items-center gap-2">
  <span className="logo" aria-label="WAVE Studio"></span>
</Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-8">
          <ul className="flex items-center gap-6">
            {NAV_LINKS.map(({ href, label }) => {
              const active = pathname === href;
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className="relative font-medium text-sm hover:underline underline-offset-4"
                  >
                    {label}
                    {active && (
                      <motion.span
                        layoutId="activeLink"
                        className="absolute -bottom-1 left-0 h-[2px] w-full bg-primary"
                      />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="flex items-center gap-3 relative">
            <button
              onClick={toggleTheme}
              aria-label="Cambiar tema"
              className="icon-btn"
              title={isDark ? "Cambiar a claro" : "Cambiar a oscuro"}
            >
              {isDark ? <FiSun className="icon" /> : <FiMoon className="icon" />}
            </button>

            {/* Acciones: depende de sesión */}
            {!isLoading && !isAuthenticated && (
              <>
                <Link href="/login" className="btn-outline h-10">
                  <FiUser className="icon" />
                  <span className="ml-1.5">Iniciar sesión</span>
                </Link>
                <Link href="/register" className="btn-primary h-10">
                  Reservar clase
                </Link>
              </>
            )}

            {!isLoading && isAuthenticated && (
              <>
                <Link href="/mis-clases" className="btn-primary h-10">
                  <FiCalendar className="icon" />
                  <span className="ml-1.5">Mis clases</span>
                </Link>

                {/* Botón de usuario */}
                <button
                  onClick={() => setUserMenuOpen((v) => !v)}
                  className="h-10 px-3 rounded-full border border-border flex items-center gap-2 hover:bg-muted"
                  aria-haspopup="menu"
                  aria-expanded={userMenuOpen}
                  aria-label="Menú de usuario"
                >
                  <div className="h-7 w-7 rounded-full bg-primary/10 text-primary grid place-items-center text-xs font-bold">
                    {initials}
                  </div>
                  <span className="text-sm font-medium max-w-[12ch] truncate">
                    {user?.name ?? user?.email}
                  </span>
                </button>

                {/* Menú desplegable */}
                <AnimatePresence>
                  {userMenuOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 6 }}
                      className="absolute right-0 top-12 w-56 rounded-xl border border-border bg-background shadow-xl overflow-hidden"
                      role="menu"
                    >
                      <div className="px-3 py-2 text-xs text-muted-foreground">
                        Sesión iniciada como
                        <div className="font-medium text-foreground truncate">
                          {user?.email}
                        </div>
                      </div>
                      <div className="h-px bg-border" />
                  
                      <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-2 px-4 py-2 text-left text-sm hover:bg-muted"
                        role="menuitem"
                      >
                        <FiLogOut className="icon" />
                        Cerrar sesión
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}
          </div>
        </div>

        {/* Mobile actions */}
        <div className="md:hidden flex items-center gap-2">
          <button onClick={toggleTheme} aria-label="Cambiar tema" className="icon-btn">
            {isDark ? <FiSun className="icon" /> : <FiMoon className="icon" />}
          </button>
          <button
            onClick={() => setOpen(true)}
            className="icon-btn"
            aria-label="Abrir menú"
            aria-expanded={open}
            aria-controls="mobile-menu"
          >
            <FiMenu className="icon" />
          </button>
        </div>
      </nav>

      {/* Mobile Menu */}
      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <motion.button
              className="fixed inset-0 bg-black/30 md:hidden"
              onClick={() => setOpen(false)}
              aria-label="Cerrar menú"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
            {/* Panel */}
            <motion.aside
              id="mobile-menu"
              className="fixed right-0 top-0 h-screen w-[86%] max-w-sm bg-background text-foreground shadow-2xl md:hidden flex flex-col"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-4 border-b border-border">
                <div className="flex items-center gap-2">
                <Link href="/" className="flex items-center gap-2">
  <span className="logo" aria-label="WAVE Studio"></span>
</Link>
                </div>
                <button onClick={() => setOpen(false)} className="icon-btn" aria-label="Cerrar menú">
                  <FiX className="icon" />
                </button>
              </div>

              {/* Si hay sesión, muestra tarjeta del usuario */}
              {!isLoading && isAuthenticated && (
                <div className="px-4 pt-3">
                  <div className="card p-4 flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary/10 text-primary grid place-items-center font-bold">
                      {initials}
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium truncate">{user?.name ?? "Usuario"}</div>
                      <div className="text-xs text-muted-foreground truncate">{user?.email}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Primary nav */}
              <ul className="px-3 py-3">
                {NAV_LINKS.map(({ href, label }) => {
                  const active = pathname === href;
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        className={`block rounded-xl px-3 py-2 text-base font-medium ${
                          active
                            ? "bg-[color:var(--color-primary-50)] text-[var(--color-primary)]"
                            : "hover:bg-muted"
                        }`}
                      >
                        {label}
                      </Link>
                    </li>
                  );
                })}
                {/* Acciones extra según sesión */}
                {!isLoading && isAuthenticated ? (
                  <>
                    <li>
                      <Link href="/mis-clases" className="block rounded-xl px-3 py-2 text-base font-medium hover:bg-muted">
                        Mis clases
                      </Link>
                    </li>
                   
                  </>
                ) : null}
              </ul>

              {/* Quick actions */}
              <div className="px-4 pt-2 grid grid-cols-2 gap-3">
                {!isLoading && isAuthenticated ? (
                  <>
                    <Link href="/mis-clases" className="btn-primary h-10 justify-center">
                      Mis clases
                    </Link>
                    <button onClick={handleLogout} className="btn-outline h-10 justify-center">
                      <FiLogOut className="icon" />
                      <span className="ml-1">Salir</span>
                    </button>
                  </>
                ) : (
                  <>
                    <Link href="/register" className="btn-primary h-10 justify-center">
                      Reservar
                    </Link>
                    <Link href="/login" className="btn-outline h-10 justify-center">
                      <FiUser className="icon" />
                      <span className="ml-1">Entrar</span>
                    </Link>
                  </>
                )}
              </div>

              {/* Contacto + Instagram */}
              <div className="px-4 mt-4">
                <div className="card p-4">
                  <h4 className="font-display font-extrabold text-base">Contáctanos</h4>
                  <div className="mt-2 space-y-2 text-sm text-muted-foreground">
                    <p className="flex items-center gap-2">
                      <FiPhone className="icon" /> +52 812 887 7484
                    </p>
                    <p className="flex items-center gap-2">
                      <FiMail className="icon" /> wwavestudio@outlook.com
                    </p>
                    <p className="flex items-center gap-2">
                      <FiMapPin className="icon" /> 1a Avenida 1495, Vista Hermosa,
                      64620 Monterrey, N.L.
                    </p>
                  </div>
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
              </div>

              {/* Secondary links */}
              <div className="px-4 py-4">
                <ul className="grid gap-2">
                  {SECONDARY_LINKS.map(({ href, label }) => (
                    <li key={href}>
                      <Link href={href} className="block text-sm text-muted-foreground hover:text-foreground">
                        {label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Footer del panel */}
              <div className="mt-auto px-4 py-4 border-t border-border text-xs text-muted-foreground">
                © {new Date().getFullYear()} WAVE Studio — Todos los derechos reservados
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </header>
  );
}

export default Navbar;
