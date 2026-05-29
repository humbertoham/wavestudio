// src/app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import { Inter, Manrope } from "next/font/google";

const SITE_DESCRIPTION =
  "Entrenamiento funcional en Cumbres Monterrey. WAVE Studio: fuerza, energía y clases diseñadas para fortalecer tu cuerpo y mente.";

export const metadata: Metadata = {
  title: "WAVE Studio",
  description: SITE_DESCRIPTION,
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
    >    <head>
    <meta charSet="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>WAVE Studio</title>
    <meta name="theme-color" content="#000" />

    <meta name="description" content={SITE_DESCRIPTION}/>
    <link rel="canonical" href="wavestudio.mx/"/>
    <meta name="keywords" content={SITE_DESCRIPTION}></meta>
    <meta name="robots" content="index, follow"/>
    <meta property="og:title" content="WAVE Studio"/>
<meta property="og:description" content={SITE_DESCRIPTION}/>
<meta property="og:image" content="wavestudio.mx/banner.png"/>
<meta property="og:url" content="wavestudio.mx"/>
<meta property="og:type" content="website"/>
<meta property="og:site_name" content="WAVE Studio"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="WAVE Studio"/>
<meta name="twitter:description" content={SITE_DESCRIPTION}/>
<meta name="twitter:image" content="wavestudio.mx/banner.png"/>
<script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
  "@type": "Organization",
  "name": "WAVE Studio",
  "url": "wavestudio.mx",
  "logo": "wavestudio.mx/logo-light.png",
  "description": SITE_DESCRIPTION,
  "contactPoint": {
    "@type": "ContactPoint",
    "contactType": "customer service",
    "email": "wwavestudio@outlook.com",
    "areaServed": "Monterrey, Nuevo León."
  },
  "sameAs": [
    "https://www.instagram.com/wavestudio.mx/",
  ]
            }),
          }}
        />



    <link id="favicon" rel="icon" href="/favicon.ico" />
    <link id="apple-touch-icon" rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
    <link id="favicon-32x32" rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
    <link id="favicon-16x16" rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
    <link id="android-192x192" rel="icon" type="image/png" sizes="192x192" href="/android-chrome-192x192.png" />
    <link id="android-512x512" rel="icon" type="image/png" sizes="512x512.png" href="/android-chrome-512x512.png"  />
    <link id="webmanifest" rel="manifest" href="/site.webmanifest" />
  </head>
      <body>{children}</body>
    </html>
  );
}
