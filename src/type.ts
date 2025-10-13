// src/types.ts
export type ApiPack = {
  id: string;
  name: string;
  classes: number;
  price: number;
  validityDays: number;
  isActive: boolean;
  createdAt: string;

  classesLabel: string | null;
  highlight: "POPULAR" | "BEST" | null;
  description: string[] | null;
};