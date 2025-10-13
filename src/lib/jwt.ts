// lib/jwt.ts
import jwt, { type SignOptions, type Secret } from "jsonwebtoken";
import type { StringValue } from "ms";

const SECRET: Secret = process.env.JWT_SECRET as string;
if (!SECRET) throw new Error("Missing JWT_SECRET");

export type JWTPayload = { sub: string; role: "USER" | "ADMIN" };

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
