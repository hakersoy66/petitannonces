import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Petit Annonces",
  description: "Achetez, vendez et découvrez des annonces partout en France.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
