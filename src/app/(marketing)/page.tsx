import CallToAction from "@/components/marketing/CallToAction";
import FAQ from "@/components/marketing/FAQ";
import Features from "@/components/marketing/Features";
import Hero from "@/components/marketing/Hero";

// src/app/(marketing)/page.tsx
export default function HomePage() {
  return (
   <>
   <Hero/>
   <Features/>
   <CallToAction/>
   <FAQ/>
   </>
  );
}
