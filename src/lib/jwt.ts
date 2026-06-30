// lib/jwt.ts
import jwt, { type SignOptions, type Secret } from "jsonwebtoken";
import type { StringValue } from "ms";
import { getRequiredServerEnv } from "./env";

const SECRET: Secret = getRequiredServerEnv("JWT_SECRET");

export type AppRole = "USER" | "COACH" | "ADMIN";

export type JWTPayload = {
  sub: string;
  role: AppRole;
  affiliationConfirmed?: boolean;
};

export function signToken(
  payload: JWTPayload,
  expiresIn: StringValue | number = "7d" // 👈 usa ms.StringValue
) {
  const options: SignOptions = { expiresIn };
  return jwt.sign(payload, SECRET, options);
}

export function verifyToken<T = JWTPayload>(token: string) {
  return jwt.verify(token, SECRET) as T;
}
