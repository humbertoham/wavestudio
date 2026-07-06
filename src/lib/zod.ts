import { z } from "zod";

const registerAffiliationSchema = z.enum([
  "NONE",
  "WELLHUB",
  "TOTALPASS",
  "none",
  "wellhub",
  "totalpass",
]);

function normalizePhoneForValidation(value: string) {
  return value.replace(/\D+/g, "");
}

export const registerSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    email: z.string().trim().toLowerCase().email(),
    password: z.string().min(8).max(64),
    dateOfBirth: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
    phone: z.string().trim().min(1),
    emergencyPhone: z.string().trim().min(1),
    affiliation: registerAffiliationSchema.optional().default("NONE"),
  })
  .superRefine((value, ctx) => {
    const dateOfBirth = new Date(`${value.dateOfBirth}T00:00:00.000Z`);
    if (Number.isNaN(dateOfBirth.getTime()) || dateOfBirth > new Date()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dateOfBirth"],
        message: "INVALID_DATE_OF_BIRTH",
      });
    }

    const phone = normalizePhoneForValidation(value.phone);
    if (phone.length < 10 || phone.length > 20) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["phone"],
        message: "INVALID_PHONE",
      });
    }

    const emergencyPhone = normalizePhoneForValidation(value.emergencyPhone);
    if (emergencyPhone.length < 10 || emergencyPhone.length > 20) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["emergencyPhone"],
        message: "INVALID_EMERGENCY_PHONE",
      });
    }
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
  date: z.string().datetime(),
  durationMin: z.number().int().min(10).max(300),
  capacity: z.number().int().min(1).max(1000),
  instructorId: z.string().min(1),
});
