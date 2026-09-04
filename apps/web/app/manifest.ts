import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Petit Annonces",
    short_name: "Petit Annonces",
    description: "Achetez et vendez partout en France avec paiement protégé, livraison suivie et boutiques professionnelles.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#5b4cf0",
    lang: "fr-FR",
    categories: ["shopping", "business", "lifestyle"],
    shortcuts: [
      { name: "Rechercher", short_name: "Rechercher", url: "/recherche" },
      { name: "Déposer une annonce", short_name: "Déposer", url: "/deposer-une-annonce" },
      { name: "Messages", short_name: "Messages", url: "/messages" },
    ],
  };
}
