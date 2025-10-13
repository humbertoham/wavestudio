// lib/zod.ts
import { z } from "zod";

export const registerSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(8).max(64),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(64),
});

export const instructorCreateSchema = z.object({
  name: z.string().min(2).max(80),
  bio: z.string().max(200).optional(),
});

export const classCreateSchema = z.object({
  title: z.string().min(2).max(80),
  focus: z.string().min(2).max(40),
  date: z.string().datetime(),      // ISO string
  durationMin: z.number().int().min(10).max(300),
  capacity: z.number().int().min(1).max(1000),
  instructorId: z.string().min(1),
});
