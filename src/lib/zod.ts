import { z } from "zod";

import { parseAffiliation } from "@/lib/affiliation";
import { parseWellhubPlan } from "@/lib/wellhub";

export const REGISTER_FIELD_MESSAGES = {
  nameRequired: "Ingresa tu nombre.",
  nameTooLong: "El nombre no puede tener más de 80 caracteres.",
  emailRequired: "Ingresa tu correo electrónico.",
  emailInvalid: "Ingresa un correo electrónico válido.",
  passwordRequired: "Ingresa una contraseña.",
  passwordTooShort: "La contraseña debe tener al menos 8 caracteres.",
  passwordTooLong: "La contraseña debe tener máximo 64 caracteres.",
  dateOfBirthRequired: "Selecciona tu fecha de nacimiento.",
  dateOfBirthInvalid: "Ingresa una fecha de nacimiento válida.",
  phoneRequired: "Ingresa tu número de celular.",
  phoneInvalid: "Ingresa un número de celular válido.",
  emergencyPhoneRequired: "Ingresa un número de emergencias.",
  emergencyPhoneInvalid: "Ingresa un número de emergencias válido.",
  affiliationInvalid: "Selecciona una afiliación válida.",
  wellhubPlanRequired: "Selecciona tu plan de WellHub.",
  wellhubPlanInvalid: "Selecciona un plan de WellHub valido.",
} as const;

const registerAffiliationSchema = z.enum([
  "NONE",
  "WELLHUB",
  "TOTALPASS",
  "none",
  "wellhub",
  "totalpass",
], {
  message: REGISTER_FIELD_MESSAGES.affiliationInvalid,
});

function normalizePhoneForValidation(value: string) {
  return value.replace(/\D+/g, "");
}

function cleanStringInput(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanEmailInput(value: unknown) {
  return cleanStringInput(value).toLowerCase();
}

function isValidDateOfBirthValue(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const [, year, month, day] = match;
  const date = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day))
  );

  return (
    !Number.isNaN(date.getTime()) &&
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day) &&
    date <= new Date()
  );
}

export const registerSchema = z
  .object({
    name: z.preprocess(
      cleanStringInput,
      z
        .string()
        .min(1, REGISTER_FIELD_MESSAGES.nameRequired)
        .min(2, REGISTER_FIELD_MESSAGES.nameRequired)
        .max(80, REGISTER_FIELD_MESSAGES.nameTooLong)
    ),
    email: z.preprocess(
      cleanEmailInput,
      z
        .string()
        .min(1, REGISTER_FIELD_MESSAGES.emailRequired)
        .email(REGISTER_FIELD_MESSAGES.emailInvalid)
    ),
    password: z.preprocess(
      (value) => (typeof value === "string" ? value : ""),
      z
        .string()
        .min(1, REGISTER_FIELD_MESSAGES.passwordRequired)
        .min(8, REGISTER_FIELD_MESSAGES.passwordTooShort)
        .max(64, REGISTER_FIELD_MESSAGES.passwordTooLong)
    ),
    dateOfBirth: z.preprocess(
      cleanStringInput,
      z
        .string()
        .min(1, REGISTER_FIELD_MESSAGES.dateOfBirthRequired)
        .regex(/^\d{4}-\d{2}-\d{2}$/, REGISTER_FIELD_MESSAGES.dateOfBirthInvalid)
    ),
    phone: z.preprocess(
      cleanStringInput,
      z.string().min(1, REGISTER_FIELD_MESSAGES.phoneRequired)
    ),
    emergencyPhone: z.preprocess(
      cleanStringInput,
      z.string().min(1, REGISTER_FIELD_MESSAGES.emergencyPhoneRequired)
    ),
    affiliation: registerAffiliationSchema.optional().default("NONE"),
    wellhubPlan: z.unknown().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.dateOfBirth && !isValidDateOfBirthValue(value.dateOfBirth)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dateOfBirth"],
        message: REGISTER_FIELD_MESSAGES.dateOfBirthInvalid,
      });
    }

    const phone = normalizePhoneForValidation(value.phone);
    if (value.phone && (phone.length < 10 || phone.length > 20)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["phone"],
        message: REGISTER_FIELD_MESSAGES.phoneInvalid,
      });
    }

    const emergencyPhone = normalizePhoneForValidation(value.emergencyPhone);
    if (
      value.emergencyPhone &&
      (emergencyPhone.length < 10 || emergencyPhone.length > 20)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["emergencyPhone"],
        message: REGISTER_FIELD_MESSAGES.emergencyPhoneInvalid,
      });
    }

    const affiliation = parseAffiliation(value.affiliation);
    const planInput =
      typeof value.wellhubPlan === "string"
        ? value.wellhubPlan.trim()
        : value.wellhubPlan;
    const hasPlanInput =
      typeof planInput === "string" ? planInput.length > 0 : planInput != null;
    const plan = parseWellhubPlan(planInput);

    if (hasPlanInput && !plan) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["wellhubPlan"],
        message: REGISTER_FIELD_MESSAGES.wellhubPlanInvalid,
      });
    }

    if (affiliation === "WELLHUB" && !plan) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["wellhubPlan"],
        message: REGISTER_FIELD_MESSAGES.wellhubPlanRequired,
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
