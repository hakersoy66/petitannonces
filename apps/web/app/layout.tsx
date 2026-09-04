import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { CookieConsent } from "../components/cookie-consent";
import { PwaClient } from "../components/pwa-client";
import "./globals.css";
import "./typography.css";
import "./pwa.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
  fallback: ["Arial", "sans-serif"],
  adjustFontFallback: true,
});

export const viewport: Viewport = {
  themeColor: "#5b4cf0",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://petitannonces.fr"),
  title: {
    default: "Petit Annonces — Achetez et vendez partout en France",
    template: "%s | Petit Annonces",
  },
  description: "Achetez, vendez et découvrez des annonces partout en France avec paiement protégé, livraison suivie et boutiques professionnelles.",
  applicationName: "Petit Annonces",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Petit Annonces",
    statusBarStyle: "default",
  },
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "fr_FR",
    siteName: "Petit Annonces",
    title: "Petit Annonces — Tout ce que vous cherchez, juste à côté",
    description: "La marketplace française nouvelle génération pour acheter et vendre simplement et en confiance.",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" className={inter.variable}>
      <body>{children}<CookieConsent /><PwaClient /></body>
    </html>
  );
}
