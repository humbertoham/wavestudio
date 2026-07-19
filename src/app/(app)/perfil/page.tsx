"use client";

import useSWR from "swr";
import Link from "next/link";

import { ChallengePointsBadge } from "@/components/challenge/ChallengePointsBadge";
import { useChallenge } from "@/lib/useChallenge";
import { useSession } from "@/lib/useSession";

type TokenSummary = { tokens: number; authenticated: boolean };

const fetcher = async (url: string) => {
  const response = await fetch(url, { credentials: "include", cache: "no-store" });
  if (!response.ok) throw new Error(String(response.status));
  return response.json() as Promise<TokenSummary>;
};

export default function ProfilePage() {
  const { user, isAuthenticated, isLoading } = useSession();
  const tokens = useSWR<TokenSummary>(
    isAuthenticated ? "/api/users/me/tokens" : null,
    fetcher
  );
  const { challenge } = useChallenge(isAuthenticated);

  if (isLoading) return <section className="section">Cargando perfil...</section>;

  if (!isAuthenticated || !user) {
    return (
      <section className="section text-center">
        <h1 className="font-display text-3xl font-bold">Mi perfil</h1>
        <p className="mt-3 text-muted-foreground">Inicia sesión para ver tu perfil.</p>
        <Link href="/login" className="btn-primary mt-6 inline-flex">Iniciar sesión</Link>
      </section>
    );
  }

  return (
    <section className="section mx-auto max-w-2xl">
      <div className="card p-6 md:p-8">
        <h1 className="font-display text-3xl font-bold">Mi perfil</h1>
        <p className="mt-2 font-medium">{user.name}</p>
        <p className="text-sm text-muted-foreground">{user.email}</p>

        <div className="mt-6 flex flex-wrap items-center gap-3" aria-label="Saldos de la cuenta">
          <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm">
            <span className="opacity-70">Tus créditos:</span>
            <span className="font-bold">{tokens.data?.tokens ?? 0}</span>
          </span>
          {challenge?.active && <ChallengePointsBadge points={challenge.points} />}
        </div>

        {challenge?.active && (
          <Link href="/challenge" className="mt-5 inline-flex text-sm font-medium text-primary underline underline-offset-4">
            {"¿Cómo funciona el Challenge?"}
          </Link>
        )}
      </div>
    </section>
  );
}
