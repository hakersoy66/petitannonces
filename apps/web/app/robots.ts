import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/", "/mon-compte/", "/espace-pro/", "/commandes/", "/messages",
        "/notifications", "/checkout", "/connexion", "/inscription", "/mot-de-passe-oublie",
        "/reinitialiser-mot-de-passe", "/verifier-email", "/verifiez-votre-email",
        "/deposer-une-annonce", "/importer-une-annonce"
      ],
    },
    sitemap: "https://petitannonces.fr/sitemap.xml",
    host: "https://petitannonces.fr",
  };
}