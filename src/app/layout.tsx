// src/app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import { Inter, Manrope } from "next/font/google";

export const metadata: Metadata = {
  title: "WAVE Studio",
  description: "Movimiento consciente al ritmo de la música.",
};

// Crea variables CSS para usarlas en tu global.css
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});
const manrope = Manrope({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="es"
      className={`${inter.variable} ${manrope.variable}`}
      suppressHydrationWarning
    >
      <body>{children}</body>
    </html>
  );
}
