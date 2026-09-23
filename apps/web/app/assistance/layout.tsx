import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { absolute: "Centre d’aide et assistance | Petit Annonces" },
  description: "Besoin d’aide sur Petit Annonces ? Consultez les réponses fréquentes, suivez vos demandes et contactez le service client.",
  alternates: { canonical: "/assistance" },
  openGraph: {
    type: "website",
    url: "/assistance",
    title: "Centre d’aide et assistance | Petit Annonces",
    description: "Consultez les réponses fréquentes et contactez le service client Petit Annonces.",
  },
};

export default function AssistanceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
