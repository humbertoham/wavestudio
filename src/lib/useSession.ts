// lib/useSession.ts
"use client";

import useSWR from "swr";

type Me = {
  id: string;
  name: string;
  email: string;
  role: "USER" | "COACH" | "ADMIN";
  affiliation: "NONE" | "WELLHUB" | "TOTALPASS";
  wellhubPlan: "GOLD_PLUS" | "PLATINUM" | "DIAMOND" | "DIAMOND_PLUS" | null;
  affiliationConfirmed: boolean;
  affiliationConfirmedAt?: string | null;
  authVersion: number;
  wellhubPlanConfirmationRequired: boolean;
  wellhubPlanConfirmationRequestedAt?: string | null;
  wellhubPlanConfirmedAt?: string | null;
  wellhubPlanConfirmationCampaign?: string | null;
};

const fetcher = (url: string) =>
  fetch(url, { credentials: "include" }).then(async (r) => {
    if (!r.ok) throw new Error(String(r.status));
    const txt = await r.text();
    if (!txt) return null;
    try {
      return JSON.parse(txt);
    } catch {
      return null;
    }
  });

export function useSession() {
  const { data, error, isLoading, mutate } = useSWR<Me | null>(
    "/api/auth/me",
    fetcher,
    {
      shouldRetryOnError: false,
      revalidateOnFocus: true,
      revalidateIfStale: false,
    }
  );

  const isAuthenticated = !!data;

  return {
    user: data,
    isAuthenticated,
    isLoading,
    error,
    refresh: () => mutate(),
  };
}
