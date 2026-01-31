"use client";

import { useState } from "react";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });

      if (!res.ok) {
        throw new Error("No se pudo enviar el correo. Intenta de nuevo.");
      }

      setSent(true);
    } catch (err: any) {
      setError(err?.message ?? "Ocurrió un error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[color:var(--color-background)] px-4 text-[color:var(--color-foreground)]">
      <main className="mx-auto max-w-md py-16">
        <div className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-8 shadow-lg">
          <h1 className="text-2xl font-semibold mb-2">
            ¿Olvidaste tu contraseña?
          </h1>

          <p className="text-sm text-[color:var(--color-muted-foreground)] mb-6">
            Te enviaremos un código o enlace para restablecer tu contraseña.
          </p>

          {sent ? (
            <div className="rounded-xl bg-[color:var(--color-muted)] p-4 text-sm">
              📩 Si el correo existe, te enviamos las instrucciones.
              <div className="mt-4">
                <Link
                  href="/login"
                  className="text-[var(--color-primary)] underline underline-offset-4"
                >
                  Volver a iniciar sesión
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
                  Correo electrónico
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-[color:var(--color-input)] bg-[color:var(--color-card)] px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                  autoComplete="email"
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
                {loading ? "Enviando…" : "Enviar instrucciones"}
              </button>

              <Link
                href="/login"
                className="block text-center text-sm text-[var(--color-primary)] hover:underline underline-offset-4"
              >
                Volver al login
              </Link>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
