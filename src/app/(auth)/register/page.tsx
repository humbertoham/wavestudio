"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/useSession";

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 64;

function phoneDigits(value: string) {
  return value.replace(/\D+/g, "");
}

function firstServerFieldMessage(fields: unknown) {
  if (!fields || typeof fields !== "object") return null;

  for (const key of [
    "name",
    "email",
    "password",
    "dateOfBirth",
    "phone",
    "emergencyPhone",
    "affiliation",
    "wellhubPlan",
  ]) {
    const value = (fields as Record<string, unknown>)[key];
    if (Array.isArray(value) && typeof value[0] === "string") {
      return value[0];
    }
  }

  return null;
}

function serverErrorMessage(payload: unknown, fallback: string) {
  const fieldMessage =
    payload && typeof payload === "object" && "fields" in payload
      ? firstServerFieldMessage((payload as { fields?: unknown }).fields)
      : null;

  if (fieldMessage) return fieldMessage;

  if (
    payload &&
    typeof payload === "object" &&
    "message" in payload &&
    typeof (payload as { message?: unknown }).message === "string"
  ) {
    return (payload as { message: string }).message;
  }

  return fallback;
}

export default function RegisterPage() {
  const router = useRouter();
  const { refresh } = useSession();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirmPwd, setShowConfirmPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [dateOfBirth, setDateOfBirth] = useState("");
  const [phone, setPhone] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [affiliation, setAffiliation] = useState<"none" | "wellhub" | "totalpass">("none");
  const [wellhubPlan, setWellhubPlan] = useState<
    "" | "GOLD_PLUS" | "PLATINUM" | "DIAMOND" | "DIAMOND_PLUS"
  >("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);

    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const normalizedPhone = phoneDigits(phone);
    const normalizedEmergencyPhone = phoneDigits(emergencyPhone);

    if (!trimmedName) return setErrorMsg("Ingresa tu nombre.");
    if (!trimmedEmail) return setErrorMsg("Ingresa tu correo electrónico.");
    if (!dateOfBirth) return setErrorMsg("Selecciona tu fecha de nacimiento.");
    if (!phone.trim()) return setErrorMsg("Ingresa tu número de celular.");
    if (normalizedPhone.length < 10 || normalizedPhone.length > 20) {
      return setErrorMsg("Ingresa un número de celular válido.");
    }
    if (!emergencyPhone.trim()) {
      return setErrorMsg("Ingresa un número de emergencias.");
    }
    if (
      normalizedEmergencyPhone.length < 10 ||
      normalizedEmergencyPhone.length > 20
    ) {
      return setErrorMsg("Ingresa un número de emergencias válido.");
    }

    if (password.length < PASSWORD_MIN_LENGTH)
      return setErrorMsg(
        `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`
      );
    if (password.length > PASSWORD_MAX_LENGTH)
      return setErrorMsg(
        `La contraseña debe tener máximo ${PASSWORD_MAX_LENGTH} caracteres.`
      );

    if (password !== confirmPwd) return setErrorMsg("Las contraseñas no coinciden.");

    if (affiliation === "wellhub" && !wellhubPlan) {
      return setErrorMsg("Selecciona tu plan de WellHub.");
    }

    setLoading(true);
    try {
      const regRes = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: trimmedName,
          email: trimmedEmail,
          password,
          dateOfBirth,
          phone,
          emergencyPhone,
          affiliation,
          wellhubPlan: affiliation === "wellhub" ? wellhubPlan : null,
        }),
      });

      if (!regRes.ok) {
        const err = await regRes.json().catch(() => ({}));
        throw new Error(serverErrorMessage(err, "No se pudo crear la cuenta."));
      }

      const logRes = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: trimmedEmail, password }),
      });
      if (!logRes.ok)
        throw new Error("Cuenta creada, pero no se pudo iniciar sesión. Intenta entrar manualmente.");

      await refresh();
      router.push("/clases");
    } catch (err: any) {
      setErrorMsg(err?.message ?? "Ocurrió un error al crear la cuenta.");
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
              Crear cuenta
            </h1>
            <p className="mt-1 text-sm text-[color:var(--color-muted-foreground)]">
              ¿Ya tienes cuenta?{" "}
              <Link
                href="/login"
                className="font-medium underline underline-offset-4 text-[var(--color-primary)]"
              >
                Inicia sesión
              </Link>
            </p>
          </div>

          {errorMsg && (
            <div className="mb-4 rounded-xl border border-red-400 bg-red-50 dark:bg-red-900/30 dark:border-red-700 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Nombre */}
            <div className="space-y-2">
              <label htmlFor="name" className="block text-sm font-medium text-[color:var(--color-card-foreground)]">
                Nombre completo
              </label>
              <input
                id="name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-xl border border-[color:var(--color-input)] bg-[color:var(--color-card)] px-4 py-2.5 text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              />
            </div>

            {/* Correo */}
            <div className="space-y-2">
              <label htmlFor="email" className="block text-sm font-medium text-[color:var(--color-card-foreground)]">
                Correo electrónico
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-[color:var(--color-input)] bg-[color:var(--color-card)] px-4 py-2.5 text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              />
            </div>

            {/* Fecha de nacimiento */}
            <div className="space-y-2">
              <label htmlFor="dob" className="block text-sm font-medium text-[color:var(--color-card-foreground)]">
                Fecha de nacimiento
              </label>
              <input
  id="dob"
  type="date"
  required
  value={dateOfBirth}
  onChange={(e) => setDateOfBirth(e.target.value)}
  className="
    w-full
    box-border
    appearance-none
    rounded-xl
    border border-[color:var(--color-input)]
    bg-[color:var(--color-card)]
    px-4
    py-2.5
    text-[color:var(--color-foreground)]
    focus:outline-none
    focus:ring-2
    focus:ring-[var(--color-primary)]
  "
/>
            </div>

            {/* Teléfonos */}
            <div className="space-y-2">
              <label htmlFor="phone" className="block text-sm font-medium text-[color:var(--color-card-foreground)]">
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
                className="w-full rounded-xl border border-[color:var(--color-input)] bg-[color:var(--color-card)] px-4 py-2.5 text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="emergencyPhone" className="block text-sm font-medium text-[color:var(--color-card-foreground)]">
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
                className="w-full rounded-xl border border-[color:var(--color-input)] bg-[color:var(--color-card)] px-4 py-2.5 text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              />
            </div>

            {/* Afiliación */}
            <div className="space-y-2">
              <label htmlFor="affiliation" className="block text-sm font-medium text-[color:var(--color-card-foreground)]">
                Afiliación:
              </label>
              <select
                id="affiliation"
                value={affiliation}
                onChange={(e) => {
                  const next = e.target.value as "none" | "wellhub" | "totalpass";
                  setAffiliation(next);
                  if (next !== "wellhub") setWellhubPlan("");
                }}
                className="w-full rounded-xl border border-[color:var(--color-input)] bg-[color:var(--color-card)] px-4 py-2.5 text-[color:var(--color-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              >
                <option value="none">Ninguna</option>
                <option value="wellhub">WellHub</option>
                <option value="totalpass">TotalPass</option>
              </select>
            </div>

            {affiliation === "wellhub" && (
              <div className="space-y-2">
                <label htmlFor="wellhubPlan" className="block text-sm font-medium text-[color:var(--color-card-foreground)]">
                  Plan en WellHub
                </label>
                <select
                  id="wellhubPlan"
                  value={wellhubPlan}
                  onChange={(e) => setWellhubPlan(e.target.value as typeof wellhubPlan)}
                  required
                  className="w-full rounded-xl border border-[color:var(--color-input)] bg-[color:var(--color-card)] px-4 py-2.5 text-[color:var(--color-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                >
                  <option value="">Selecciona tu plan</option>
                  <option value="GOLD_PLUS">Gold+ - 2 creditos mensuales</option>
                  <option value="PLATINUM">Platinum - 8 creditos mensuales</option>
                  <option value="DIAMOND">Diamond - 30 creditos mensuales</option>
                  <option value="DIAMOND_PLUS">Diamond+ - 30 creditos mensuales</option>
                </select>
              </div>
            )}

            {/* Contraseña */}
            <div className="space-y-2">
              <label htmlFor="password" className="block text-sm font-medium text-[color:var(--color-card-foreground)]">
                Contraseña
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPwd ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-[color:var(--color-input)] bg-[color:var(--color-card)] px-4 py-2.5 pr-12 text-[color:var(--color-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  className="absolute inset-y-0 right-2 my-1 rounded-lg px-3 text-sm text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-muted)]"
                >
                  {showPwd ? "Ocultar" : "Ver"}
                </button>
              </div>
            </div>

            {/* Confirmar */}
            <div className="space-y-2">
              <label htmlFor="confirmPwd" className="block text-sm font-medium text-[color:var(--color-card-foreground)]">
                Confirmar contraseña
              </label>
              <div className="relative">
                <input
                  id="confirmPwd"
                  type={showConfirmPwd ? "text" : "password"}
                  required
                  value={confirmPwd}
                  onChange={(e) => setConfirmPwd(e.target.value)}
                  className="w-full rounded-xl border border-[color:var(--color-input)] bg-[color:var(--color-card)] px-4 py-2.5 pr-12 text-[color:var(--color-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPwd((v) => !v)}
                  className="absolute inset-y-0 right-2 my-1 rounded-lg px-3 text-sm text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-muted)]"
                >
                  {showConfirmPwd ? "Ocultar" : "Ver"}
                </button>
              </div>
            </div>

            {/* Botones */}
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
              className="block w-full text-center rounded-xl border px-4 py-2.5 font-medium transition hover:bg-[color:var(--color-muted)]"
              style={{ borderColor: "var(--color-primary)", color: "var(--color-primary)" }}
            >
              Iniciar sesión
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
