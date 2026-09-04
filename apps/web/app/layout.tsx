import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://petitannonces.fr"),
  title: {
    default: "Petit Annonces — Achetez et vendez partout en France",
    template: "%s | Petit Annonces",
  },
  description: "Achetez, vendez et découvrez des annonces partout en France avec paiement protégé, livraison suivie et boutiques professionnelles.",
  applicationName: "Petit Annonces",
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
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
