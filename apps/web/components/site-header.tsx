"use client";

import { useEffect, useState } from "react";

const navItems = [
  { label: "Acheter", href: "/recherche" },
  { label: "Catégories", href: "/#categories" },
  { label: "Boutiques", href: "/boutique" },
  { label: "Vendre", href: "/deposer-une-annonce" },
];

type HeaderSummary = { unreadConversations: number; pendingOffers: number; unreadNotifications: number };
function apiBase() { return (process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, ""); }

function Icon({ name }: { name: "heart" | "mail" | "bell" | "menu" | "close" | "user" | "plus" }) {
  const common = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "heart") return <svg {...common}><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z" /></svg>;
  if (name === "mail") return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>;
  if (name === "bell") return <svg {...common}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></svg>;
  if (name === "menu") return <svg {...common}><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
  if (name === "close") return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>;
  if (name === "user") return <svg {...common}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>;
  return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
}

export function SiteHeader() {
  const [authenticated, setAuthenticated] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [summary, setSummary] = useState<HeaderSummary>({ unreadConversations: 0, pendingOffers: 0, unreadNotifications: 0 });

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch(`${apiBase()}/auth/me`, { credentials: "include" }),
      fetch(`${apiBase()}/account/message-summary`, { credentials: "include" }),
    ]).then(async ([meRes, sumRes]) => {
      if (!active) return;
      if (!meRes.ok) { setAuthenticated(false); return; }
      setAuthenticated(true);
      if (sumRes.ok) setSummary(await sumRes.json() as HeaderSummary);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [menuOpen]);

  return (
    <header className="site-header">
      <div className="shell header-inner">
        <a className="brand" href="/" aria-label="Petit Annonces, accueil">
          <span className="brand-mark" aria-hidden="true">pa</span>
          <span className="brand-copy"><strong>Petit Annonces</strong><small>France</small></span>
        </a>

        <nav className="desktop-nav" aria-label="Navigation principale">
          {navItems.map((item) => <a key={item.label} href={item.href}>{item.label}</a>)}
        </nav>

        <div className="header-actions desktop-actions">
          <a className="icon-action" href={authenticated ? "/mon-compte/favoris" : "/connexion?next=%2Fmon-compte%2Ffavoris"} aria-label="Mes favoris"><Icon name="heart" /></a>
          {authenticated && <a className="icon-action header-badge-wrap" href="/messages" aria-label={`${summary.unreadConversations} message(s) non lu(s)`}><Icon name="mail" />{summary.unreadConversations > 0 && <span className="header-badge">{summary.unreadConversations > 99 ? "99+" : summary.unreadConversations}</span>}</a>}
          {authenticated && <a className="icon-action header-badge-wrap" href="/mon-compte/notifications" aria-label={`${summary.unreadNotifications} notification(s) non lue(s)`}><Icon name="bell" />{summary.unreadNotifications > 0 && <span className="header-badge header-badge-violet">{summary.unreadNotifications > 99 ? "99+" : summary.unreadNotifications}</span>}</a>}
          <a className="account-link" href={authenticated ? "/mon-compte" : "/connexion"}>{authenticated ? "Mon compte" : "Connexion"}</a>
          <a className="button button-primary button-compact" href="/deposer-une-annonce"><Icon name="plus" />Déposer une annonce</a>
        </div>

        <div className="mobile-actions">
          <a className="mobile-account" href={authenticated ? "/mon-compte" : "/connexion"} aria-label={authenticated ? "Mon compte" : "Connexion"}><Icon name="user" /></a>
          <button className="mobile-menu-button" type="button" aria-label={menuOpen ? "Fermer le menu" : "Ouvrir le menu"} aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}><Icon name={menuOpen ? "close" : "menu"} /></button>
        </div>
      </div>

      {menuOpen && <div className="mobile-menu-layer" onClick={() => setMenuOpen(false)}>
        <div className="mobile-menu-panel" onClick={(event) => event.stopPropagation()}>
          <nav className="mobile-nav" aria-label="Navigation mobile">
            {navItems.map((item) => <a key={item.label} href={item.href} onClick={() => setMenuOpen(false)}>{item.label}<span>→</span></a>)}
          </nav>
          <div className="mobile-menu-links">
            <a href={authenticated ? "/mon-compte/favoris" : "/connexion?next=%2Fmon-compte%2Ffavoris"}><Icon name="heart" />Favoris</a>
            <a href={authenticated ? "/messages" : "/connexion?next=%2Fmessages"}><Icon name="mail" />Messages{summary.unreadConversations > 0 && <b>{summary.unreadConversations}</b>}</a>
            <a href={authenticated ? "/mon-compte/notifications" : "/connexion"}><Icon name="bell" />Notifications{summary.unreadNotifications > 0 && <b>{summary.unreadNotifications}</b>}</a>
          </div>
          <a className="button button-primary mobile-post-button" href="/deposer-une-annonce" onClick={() => setMenuOpen(false)}><Icon name="plus" />Déposer une annonce</a>
        </div>
      </div>}
    </header>
  );
}
