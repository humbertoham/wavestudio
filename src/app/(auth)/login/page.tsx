"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "@/lib/useSession"; // ⬅️ clave: invalida /api/auth/me

export default function LoginPage() {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next") || "/clases"; // cambia el default si quieres
  const { refresh } = useSession(); // ⬅️ para revalidar la sesión sin recargar

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
        credentials: "include", // usa cookies si tu API las setea
        body: JSON.stringify({
          email: email.trim(),
          password,
          remember, // si tu backend soporta "recuérdame"
        }),
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

      // ⚡️ Invalida el cache de /api/auth/me para que el Navbar re-renderice ya
      await refresh();

      // Navega a "next" y refresca el árbol RSC (por si tienes layouts server)
      router.replace(next);
      router.refresh();
    } catch (err: any) {
      setErrorMsg(err?.message ?? "Ocurrió un error al iniciar sesión.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4">
      <main className="mx-auto max-w-md py-12">
        <div className="bg-white shadow-lg rounded-2xl p-8">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-gray-900">Iniciar sesión</h1>
            <p className="mt-1 text-sm text-gray-600">
              ¿No tienes cuenta?{" "}
              <Link href="/register" className="font-medium underline underline-offset-4">
                <span className="text-[var(--color-primary)]">Crear cuenta</span>
              </Link>
            </p>
          </div>

          {errorMsg && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Correo electrónico
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                autoComplete="email"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                Contraseña
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPwd ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 pr-12 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  className="absolute inset-y-0 right-2 my-1 rounded-lg px-3 text-sm text-gray-600 hover:bg-gray-100"
                  aria-label={showPwd ? "Ocultar contraseña" : "Mostrar contraseña"}
                >
                  {showPwd ? "Ocultar" : "Ver"}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                Recordarme
              </label>

              <Link href="/forgot-password" className="text-sm">
                <span className="text-[var(--color-primary)] hover:underline underline-offset-4">
                  ¿Olvidaste tu contraseña?
                </span>
              </Link>
            </div>

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
              className="block w-full text-center rounded-xl border px-4 py-2.5 font-medium transition hover:bg-gray-50"
              style={{ borderColor: "var(--color-primary)", color: "var(--color-primary)" }}
            >
              Crear cuenta
            </Link>
          </form>

          <p className="mt-6 text-center text-xs text-gray-500">
            Al continuar, aceptas nuestros{" "}
            <Link href="/terminos" className="underline underline-offset-4">
              <span className="text-[var(--color-primary)]">Términos</span>
            </Link>{" "}
            y{" "}
            <Link href="/privacidad" className="underline underline-offset-4">
              <span className="text-[var(--color-primary)]">Privacidad</span>
            </Link>
            .
          </p>
        </div>
      </main>
    </div>
  );
}
