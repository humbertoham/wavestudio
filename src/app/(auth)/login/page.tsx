"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "@/lib/useSession";

export const dynamic = "force-dynamic";

function LoginInner() {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next") || "/clases";
  const { refresh } = useSession();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim(), password, remember }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 401 || data?.error === "INVALID_CREDENTIALS") {
          throw new Error("Correo o contraseña incorrectos.");
        }
        if (res.status === 400 || data?.error === "INVALID") {
          throw new Error("Datos inválidos. Revisa el formulario.");
        }
        throw new Error("No se pudo iniciar sesión. Inténtalo de nuevo.");
      }

      await refresh();
      router.replace(next);
      router.refresh();
    } catch (err: any) {
      setErrorMsg(err?.message ?? "Ocurrió un error al iniciar sesión.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[color:var(--color-background)] px-4 text-[color:var(--color-foreground)] transition-colors">
      <main className="mx-auto max-w-md py-12">
        <div className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-8 shadow-lg transition-colors">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-[color:var(--color-card-foreground)]">
              Iniciar sesión
            </h1>
            <p className="mt-1 text-sm text-[color:var(--color-muted-foreground)]">
              ¿No tienes cuenta?{" "}
              <Link
                href="/register"
                className="font-medium underline underline-offset-4 text-[var(--color-primary)]"
              >
                Crear cuenta
              </Link>
            </p>
          </div>

          {errorMsg && (
            <div className="mb-4 rounded-xl border border-red-400 bg-red-50 dark:bg-red-900/30 dark:border-red-700 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email */}
            <div className="space-y-2">
              <label
                htmlFor="email"
                className="block text-sm font-medium text-[color:var(--color-card-foreground)]"
              >
                Correo electrónico
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-[color:var(--color-input)] bg-[color:var(--color-card)] px-4 py-2.5 text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                autoComplete="email"
              />
            </div>

            {/* Password */}
            <div className="space-y-2">
              <label
                htmlFor="password"
                className="block text-sm font-medium text-[color:var(--color-card-foreground)]"
              >
                Contraseña
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPwd ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-[color:var(--color-input)] bg-[color:var(--color-card)] px-4 py-2.5 pr-12 text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  className="absolute inset-y-0 right-2 my-1 rounded-lg px-3 text-sm text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-muted)]"
                  aria-label={showPwd ? "Ocultar contraseña" : "Mostrar contraseña"}
                >
                  {showPwd ? "Ocultar" : "Ver"}
                </button>
              </div>
            </div>

            {/* Recordarme / Olvidé */}
            <div className="flex items-center justify-between">
              <label className="inline-flex items-center gap-2 text-sm text-[color:var(--color-muted-foreground)]">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-[color:var(--color-input)] bg-[color:var(--color-card)]"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                Recordarme
              </label>
{/*
              <Link
                href="/forgot-password"
                className="text-sm text-[var(--color-primary)] hover:underline underline-offset-4"
              >
                ¿Olvidaste tu contraseña?
              </Link>
              */}
            </div>

            {/* Botones */}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl py-2.5 font-medium text-white transition focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              style={{ backgroundColor: "var(--color-primary)", opacity: loading ? 0.9 : 1 }}
            >
              {loading ? "Entrando..." : "Entrar"}
            </button>

            <Link
              href="/register"
              className="block w-full text-center rounded-xl border px-4 py-2.5 font-medium transition hover:bg-[color:var(--color-muted)]"
              style={{
                borderColor: "var(--color-primary)",
                color: "var(--color-primary)",
              }}
            >
              Crear cuenta
            </Link>
          </form>

          <p className="mt-6 text-center text-xs text-[color:var(--color-muted-foreground)]">
            Al continuar, aceptas nuestros{" "}
            <Link href="/terminos" className="underline underline-offset-4 text-[var(--color-primary)]">
              Términos
            </Link>{" "}
            y{" "}
            <Link href="/privacidad" className="underline underline-offset-4 text-[var(--color-primary)]">
              Privacidad
            </Link>
            .
          </p>
        </div>
      </main>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="p-6 text-center">Cargando…</div>}>
      <LoginInner />
    </Suspense>
  );
}
