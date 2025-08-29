// src/app/(marketing)/layout.tsx
import { Navbar } from "@/components/nav/Navbar";
// import { Footer } from "@/components/nav/Footer"; // si tienes footer
import "../globals.css";
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh flex flex-col">
      <Navbar />
      <main className="container-app flex-1">{children}</main>
      {/* <Footer /> */}
    </div>
  );
}
