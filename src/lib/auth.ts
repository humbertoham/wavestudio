// lib/auth.ts
import { cookies } from "next/headers";
import { verifyToken, type JWTPayload } from "./jwt";

async function readCookie(name: string): Promise<string | null> {
  // `cookies()` puede ser sync (node) o async (edge). Normalizamos:
  const c: any = cookies();                 // cast intencional para unificar tipos
  // Si es Promesa (edge), espera; si no, úsalo directo (node).
  const store = typeof c?.then === "function" ? await c : c;
  return store?.get?.(name)?.value ?? null;
}

export async function getAuth(): Promise<JWTPayload | null> {
  const token = await readCookie("session");
  if (!token) return null;
  try { return verifyToken(token); } catch { return null; }
}
// Si quieres versión "throwing", mantenla,
// pero entiende que debe atraparse en cada route.
export async function requireAuth(): Promise<JWTPayload> {
  const p = await getAuth();
  if (!p) throw new Error("UNAUTHORIZED");
  return p;
}

export async function requireAdmin(): Promise<JWTPayload> {
  const p = await requireAuth();
  if (p.role !== "ADMIN") throw new Error("FORBIDDEN");
  return p;
}
