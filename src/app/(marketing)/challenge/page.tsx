"use client";

import Link from "next/link";
import { ChallengeInfoContent } from "@/components/challenge/ChallengeInfoContent";

import { CHALLENGE_INFO_TITLE } from "@/lib/challenge-copy";
import { useChallenge } from "@/lib/useChallenge";
import { useSession } from "@/lib/useSession";

export default function ChallengeInfoPage() {
  const { isAuthenticated, isLoading: sessionLoading } = useSession();
  const { challenge, isLoading } = useChallenge(isAuthenticated);

  if (sessionLoading || (isAuthenticated && isLoading)) {
    return <section className="section text-center">Cargando Challenge...</section>;
  }

  if (!isAuthenticated) {
    return (
      <section className="section mx-auto max-w-2xl text-center">
        <h1 className="font-display text-3xl font-bold">{CHALLENGE_INFO_TITLE}</h1>
        <p className="mt-3 text-muted-foreground">
          Inicia sesión para consultar el Challenge.
        </p>
        <Link href="/login" className="btn-primary mt-6 inline-flex">
          Iniciar sesión
        </Link>
      </section>
    );
  }

  if (!challenge?.active) {
    return (
      <section className="section mx-auto max-w-2xl text-center">
        <h1 className="font-display text-3xl font-bold">Challenge en pausa</h1>
        <p className="mt-3 text-muted-foreground">
          El Challenge no está activo en este momento. Tus puntos e historial se conservan.
        </p>
        <Link href="/clases" className="btn-outline mt-6 inline-flex">
          Ver clases
        </Link>
      </section>
    );
  }

  return (
    <section className="section mx-auto max-w-3xl">
      <ChallengeInfoContent />
    </section>
  );
}
