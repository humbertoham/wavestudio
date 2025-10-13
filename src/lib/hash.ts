// lib/hash.ts
import bcrypt from "bcryptjs";
export const hash = (pwd: string) => bcrypt.hash(pwd, 12);
export const compareHash = (pwd: string, h: string) => bcrypt.compare(pwd, h);
