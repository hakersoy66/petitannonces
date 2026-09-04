"use client";

import { useEffect } from "react";

const nav = [
  ["Accueil", "/", "⌂"],
  ["Recherche", "/recherche", "⌕"],
  ["Déposer", "/deposer-une-annonce", "+"],
  ["Messages", "/messages", "✉"],
  ["Compte", "/conformite", "☺"],
];

export function PwaClient() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    }
  }, []);

  return <nav className="mobile-bottom-nav" aria-label="Navigation mobile">
    {nav.map(([label, href, icon]) => <a key={href} href={href}><span>{icon}</span><small>{label}</small></a>)}
  </nav>;
}
