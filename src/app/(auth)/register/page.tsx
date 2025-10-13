"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/useSession";

export default function RegisterPage() {
  const router = useRouter();
  const { refresh } = useSession(); // ⬅️ clave

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirmPwd, setShowConfirmPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Nuevos campos
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [phone, setPhone] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [affiliation, setAffiliation] = useState<"none" | "wellhub" | "totalpass">("none");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);

    if (password !== confirmPwd) {
      setErrorMsg("Las contraseñas no coinciden.");
      return;
    }
    if (!dateOfBirth) return setErrorMsg("Selecciona tu fecha de nacimiento.");
    if (!phone) return setErrorMsg("Ingresa tu número de celular.");
    if (!emergencyPhone) return setErrorMsg("Ingresa un número de emergencias.");

    setLoading(true);
    try {
      // 1) Registrar
      const regRes = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name,
          email,
          password,
          dateOfBirth,
          phone,
          emergencyPhone,
          affiliation,
        }),
      });

      if (!regRes.ok) {
        const err = await regRes.json().catch(() => ({}));
        if (regRes.status === 409 || err?.error === "EMAIL_IN_USE") {
          throw new Error("Este correo ya está registrado.");
        }
        if (regRes.status === 400 || err?.error === "INVALID") {
          throw new Error("Datos inválidos. Revisa el formulario.");
        }
        throw new Error("No se pudo crear la cuenta.");
      }

      // 2) Auto-login
      const logRes = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      if (!logRes.ok) {
        throw new Error("Cuenta creada, pero no se pudo iniciar sesión. Intenta entrar manualmente.");
      }

      await refresh();        // 🔥 actualiza Navbar inmediatamente
      router.push("/clases"); // 3) Redirigir
    } catch (err: any) {
      setErrorMsg(err?.message ?? "Ocurrió un error al crear la cuenta.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4">
      <main className="mx-auto max-w-md py-12">
        <div className="bg-white shadow-lg rounded-2xl p-8">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-gray-900">Crear cuenta</h1>
            <p className="mt-1 text-sm text-gray-600">
              ¿Ya tienes cuenta?{" "}
              <Link href="/login" className="font-medium underline underline-offset-4">
                <span className="text-[var(--color-primary)]">Inicia sesión</span>
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
              <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                Nombre completo
              </label>
              <input
                id="name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-xl border border-gray-300 px-4 py-2.5"
              />
            </div>

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
                className="w-full rounded-xl border border-gray-300 px-4 py-2.5"
              />
            </div>

            {/* Nuevos campos */}
            <div className="space-y-2">
              <label htmlFor="dob" className="block text-sm font-medium text-gray-700">
                Fecha de nacimiento
              </label>
              <input
                id="dob"
                type="date"
                required
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                className="w-full rounded-xl border border-gray-300 px-4 py-2.5"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="phone" className="block text-sm font-medium text-gray-700">
                Número de celular
              </label>
              <input
                id="phone"
                type="tel"
                inputMode="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="10 dígitos"
                className="w-full rounded-xl border border-gray-300 px-4 py-2.5"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="emergencyPhone" className="block text-sm font-medium text-gray-700">
                Número de emergencias
              </label>
              <input
                id="emergencyPhone"
                type="tel"
                inputMode="tel"
                required
                value={emergencyPhone}
                onChange={(e) => setEmergencyPhone(e.target.value)}
                placeholder="Contacto de emergencia"
                className="w-full rounded-xl border border-gray-300 px-4 py-2.5"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="affiliation" className="block text-sm font-medium text-gray-700">
                Afilación:
              </label>
              <select
                id="affiliation"
                value={affiliation}
                onChange={(e) => setAffiliation(e.target.value as "none" | "wellhub" | "totalpass")}
                className="w-full rounded-xl border border-gray-300 px-4 py-2.5 bg-white"
              >
                <option value="none">Ninguna</option>
                <option value="wellhub">WellHub</option>
                <option value="totalpass">TotalPass</option>
              </select>
            </div>

            {/* Contraseña */}
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
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  className="absolute inset-y-0 right-2 my-1 rounded-lg px-3 text-sm text-gray-600 hover:bg-gray-100"
                >
                  {showPwd ? "Ocultar" : "Ver"}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="confirmPwd" className="block text-sm font-medium text-gray-700">
                Confirmar contraseña
              </label>
              <div className="relative">
                <input
                  id="confirmPwd"
                  type={showConfirmPwd ? "text" : "password"}
                  required
                  value={confirmPwd}
                  onChange={(e) => setConfirmPwd(e.target.value)}
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPwd((v) => !v)}
                  className="absolute inset-y-0 right-2 my-1 rounded-lg px-3 text-sm text-gray-600 hover:bg-gray-100"
                >
                  {showConfirmPwd ? "Ocultar" : "Ver"}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl py-2.5 font-medium text-white transition focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              style={{ backgroundColor: "var(--color-primary)", opacity: loading ? 0.9 : 1 }}
            >
              {loading ? "Creando..." : "Crear cuenta"}
            </button>

            <Link
              href="/login"
              className="block w-full text-center rounded-xl border px-4 py-2.5 font-medium transition hover:bg-gray-50"
              style={{ borderColor: "var(--color-primary)", color: "var(--color-primary)" }}
            >
              Iniciar sesión
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
