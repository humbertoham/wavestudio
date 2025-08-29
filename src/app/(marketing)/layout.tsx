// src/app/(marketing)/layout.tsx
import "@/app/globals.css";
import Footer from "@/components/nav/Footer";
import { Navbar } from "@/components/nav/Navbar";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className="bg-background text-foreground">
        <Navbar />
        <main className="container-app">{children}</main>
        {/* Puedes agregar aquí tu <Footer /> */}
        <Footer/>
      </body>
    </html>
  );
}
