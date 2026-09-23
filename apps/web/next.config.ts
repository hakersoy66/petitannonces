import type { NextConfig } from "next";

const privateSeoHeaders = [
  "/mon-compte/:path*", "/espace-pro/:path*", "/commandes/:path*", "/messages/:path*", "/notifications/:path*",
  "/checkout/:path*", "/connexion", "/inscription/:path*", "/mot-de-passe-oublie", "/reinitialiser-mot-de-passe",
  "/verifier-email", "/verifiez-votre-email", "/deposer-une-annonce", "/importer-une-annonce"
];

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    remotePatterns: [{ protocol: "https", hostname: "media.petitannonces.fr" }],
    qualities: [68, 75],
    minimumCacheTTL: 86400,
  },
  async headers() {
    return [
      { source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "max-image-preview: large, max-snippet: -1, max-video-preview: -1" }] },
      ...privateSeoHeaders.map(source => ({ source, headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }] })),
      { source: "/.well-known/web-app-origin-association", headers: [
        { key: "Content-Type", value: "application/json; charset=utf-8" },
        { key: "Cache-Control", value: "public, max-age=3600" },
      ] },
      { source: "/france-hero-map.svg", headers: [
        { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" },
      ] },
    ];
  },
  async redirects() {
    return [
      { source: "/mon-compte/mes-annonces", destination: "/mon-compte/annonces", permanent: true },
      { source: "/deposer", destination: "/deposer-une-annonce", permanent: true },
      { source: "/espace-pro/statistiques", destination: "/espace-pro/analytics", permanent: true },
      { source: "/espace-pro/boutique", destination: "/espace-pro/boutiques", permanent: true },
      { source: "/espace-pro/facturation", destination: "/espace-pro/abonnement", permanent: true },
      { source: "/espace-pro/paiements", destination: "/mon-compte/paiements", permanent: true },
    ];
  },
};

export default nextConfig;
