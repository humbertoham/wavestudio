"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";

export default function ResetPasswordPage() {
  const search = useSearchParams();
  const router = useRouter();
  const token = search.get("token");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) {
      setError("Token inválido o expirado.");
      return;
    }
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      if (!res.ok) {
        throw new Error("El enlace es inválido o expiró.");
      }

      setDone(true);
      setTimeout(() => router.replace("/login"), 2500);
    } catch (err: any) {
      setError(err?.message ?? "No se pudo cambiar la contraseña.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[color:var(--color-background)] px-4 text-[color:var(--color-foreground)]">
      <main className="mx-auto max-w-md py-16">
        <div className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-8 shadow-lg">
          <h1 className="text-2xl font-semibold mb-2">
            Restablecer contraseña
          </h1>

          {done ? (
            <div className="rounded-xl bg-[color:var(--color-muted)] p-4 text-sm">
              ✅ Contraseña actualizada correctamente.  
              <div className="mt-3">
                <Link
                  href="/login"
                  className="text-[var(--color-primary)] underline underline-offset-4"
                >
                  Ir al login
                </Link>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="rounded-xl border border-red-400 bg-red-50 dark:bg-red-900/30 px-4 py-3 text-sm text-red-700 dark:text-red-300">
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <label className="block text-sm font-medium">
                  Nueva contraseña
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-[color:var(--color-input)] bg-[color:var(--color-card)] px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium">
                  Confirmar contraseña
                </label>
                <input
                  type="password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full rounded-xl border border-[color:var(--color-input)] bg-[color:var(--color-card)] px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl py-2.5 font-medium text-white transition focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                style={{
                  backgroundColor: "var(--color-primary)",
                  opacity: loading ? 0.9 : 1,
                }}
              >
                {loading ? "Guardando…" : "Cambiar contraseña"}
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
