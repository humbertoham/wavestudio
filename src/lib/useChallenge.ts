"use client";

import useSWR from "swr";
import { useEffect } from "react";

export type UserChallenge = {
  active: boolean;
  name: string;
  points: number;
  activatedAt: string | null;
};

const fetcher = async (url: string) => {
  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(String(response.status));
  return response.json() as Promise<UserChallenge>;
};

export function useChallenge(enabled: boolean) {
  const result = useSWR<UserChallenge>(enabled ? "/api/challenge" : null, fetcher, {
    shouldRetryOnError: false,
    revalidateOnFocus: true,
    refreshInterval: enabled ? 15_000 : 0,
  });

  useEffect(() => {
    if (!enabled) return;
    const refresh = () => void result.mutate();
    window.addEventListener("challenge-updated", refresh);
    return () => window.removeEventListener("challenge-updated", refresh);
  }, [enabled, result.mutate]);

  return {
    challenge: result.data,
    isLoading: result.isLoading,
    error: result.error,
    refresh: result.mutate,
  };
}
