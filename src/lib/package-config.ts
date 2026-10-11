import { PackHighlight } from "@prisma/client";
import { z } from "zod";

export const packConfigurationSchema = z
  .object({
    name: z.string().trim().min(1),
    type: z.enum(["STANDARD", "MONTHLY_UNLIMITED"]).default("STANDARD"),
    price: z.coerce.number().nonnegative().transform(Math.round),
    classes: z.coerce.number().int().nonnegative().optional(),
    classesCount: z.coerce.number().int().nonnegative().optional(),
    validityDays: z.coerce.number().int().nonnegative().optional(),
    unlimitedMonth: z.number().int().min(1).max(12).nullable().optional(),
    unlimitedYear: z.number().int().min(2000).max(2200).nullable().optional(),
    isActive: z.boolean().default(true),
    isVisible: z.boolean().default(true),
    oncePerUser: z.boolean().default(false),
    classesLabel: z.string().trim().min(1).nullable().optional(),
    highlight: z.preprocess(
      (v) => (typeof v === "string" ? v.toUpperCase() : v),
      z.nativeEnum(PackHighlight).nullable().optional(),
    ),
    description: z
      .union([z.string(), z.array(z.string())])
      .nullable()
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === "MONTHLY_UNLIMITED") {
      for (const field of ["unlimitedMonth", "unlimitedYear"] as const) {
        if (v[field] == null)
          ctx.addIssue({
            code: "custom",
            path: [field],
            message: "El mes y año son obligatorios para el ilimitado.",
          });
      }
    } else {
      if ((v.classes ?? v.classesCount ?? 0) <= 0)
        ctx.addIssue({
          code: "custom",
          path: ["classes"],
          message: "Debe tener al menos una clase.",
        });
      if ((v.validityDays ?? 0) <= 0)
        ctx.addIssue({
          code: "custom",
          path: ["validityDays"],
          message: "La vigencia debe ser mayor a cero.",
        });
    }
  })
  .transform(({ classesCount, ...v }) => ({
    ...v,
    classes: v.type === "MONTHLY_UNLIMITED" ? 0 : (v.classes ?? classesCount)!,
    validityDays: v.type === "MONTHLY_UNLIMITED" ? 0 : v.validityDays!,
    unlimitedMonth: v.type === "MONTHLY_UNLIMITED" ? v.unlimitedMonth! : null,
    unlimitedYear: v.type === "MONTHLY_UNLIMITED" ? v.unlimitedYear! : null,
    description: (typeof v.description === "string"
      ? v.description.split("\n")
      : (v.description ?? [])
    )
      .map((s) => s.trim())
      .filter(Boolean),
  }));
