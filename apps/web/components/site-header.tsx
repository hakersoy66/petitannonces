"use client";

import { Bell, Heart, LogIn, Menu, MessageCircle, Plus, Search, Store, UserRound, X } from "lucide-react";
import { useEffect, useState } from "react";

const navItems = [
  { label: "Acheter", href: "/recherche", icon: Search },
  { label: "Catégories", href: "/#categories", icon: Search },
  { label: "Boutiques", href: "/boutique", icon: Store },
  { label: "Vendre", href: "/deposer-une-annonce", icon: Plus },
];

type HeaderSummary = { unreadConversations: number; pendingOffers: number; unreadNotifications: number };
function apiBase() { return (process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, ""); }

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
    document.body.classList.toggle("mobile-menu-open", menuOpen);
    return () => document.body.classList.remove("mobile-menu-open");
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="site-header pa-header">
      <div className="shell header-inner pa-header-inner">
        <a className="brand pa-brand" href="/" aria-label="Petit Annonces, accueil">
          <span className="brand-mark" aria-hidden="true">pa</span>
          <span className="brand-copy"><strong>Petit Annonces</strong><small>France</small></span>
        </a>

        <nav className="desktop-nav pa-desktop-nav" aria-label="Navigation principale">
          {navItems.map((item) => <a key={item.label} href={item.href}>{item.label}</a>)}
        </nav>

        <div className="header-actions desktop-actions pa-header-actions">
          <a className="icon-action pa-icon-button" href={authenticated ? "/mon-compte/favoris" : "/connexion?next=%2Fmon-compte%2Ffavoris"} aria-label="Mes favoris"><Heart size={19} /></a>
          {authenticated && <a className="icon-action pa-icon-button pa-badge-anchor" href="/messages" aria-label={`${summary.unreadConversations} message(s) non lu(s)`}><MessageCircle size={19} />{summary.unreadConversations > 0 && <span className="header-badge pa-count-badge">{summary.unreadConversations > 99 ? "99+" : summary.unreadConversations}</span>}</a>}
          {authenticated && <a className="icon-action pa-icon-button pa-badge-anchor" href="/mon-compte/notifications" aria-label={`${summary.unreadNotifications} notification(s) non lue(s)`}><Bell size={19} />{summary.unreadNotifications > 0 && <span className="header-badge header-badge-violet pa-count-badge pa-count-badge-violet">{summary.unreadNotifications > 99 ? "99+" : summary.unreadNotifications}</span>}</a>}
          <a className="account-link pa-account-link" href={authenticated ? "/mon-compte" : "/connexion"}><UserRound size={17} /><span>{authenticated ? "Mon compte" : "Connexion"}</span></a>
          <a className="button button-primary button-compact pa-deposit-button" href="/deposer-une-annonce"><Plus size={18} />Déposer une annonce</a>
        </div>

        <div className="mobile-actions pa-mobile-actions">
          <a className="mobile-account pa-mobile-account" href={authenticated ? "/mon-compte" : "/connexion"} aria-label={authenticated ? "Mon compte" : "Connexion"}><UserRound size={20} /></a>
          <button className="mobile-menu-button pa-mobile-toggle" type="button" aria-label={menuOpen ? "Fermer le menu" : "Ouvrir le menu"} aria-expanded={menuOpen} aria-controls="pa-mobile-menu" onClick={() => setMenuOpen((value) => !value)}>{menuOpen ? <X size={22} /> : <Menu size={22} />}</button>
        </div>
      </div>

      <div className={`mobile-menu-layer pa-mobile-menu ${menuOpen ? "is-open" : ""}`} id="pa-mobile-menu" aria-hidden={!menuOpen}>
        <button className="pa-mobile-menu-backdrop" type="button" aria-label="Fermer le menu" onClick={closeMenu} />
        <div className="mobile-menu-panel pa-mobile-panel">
          <div className="pa-mobile-panel-head"><strong>Menu</strong><button type="button" onClick={closeMenu} aria-label="Fermer le menu"><X size={21} /></button></div>
          <nav className="mobile-nav pa-mobile-nav" aria-label="Navigation mobile">
            {navItems.map(({ label, href, icon: Icon }) => <a key={label} href={href} onClick={closeMenu}><Icon size={19} /><span>{label}</span></a>)}
          </nav>
          <div className="mobile-menu-links pa-mobile-secondary">
            <a href={authenticated ? "/mon-compte/favoris" : "/connexion?next=%2Fmon-compte%2Ffavoris"} onClick={closeMenu}><Heart size={19} /><span>Favoris</span></a>
            <a href={authenticated ? "/messages" : "/connexion?next=%2Fmessages"} onClick={closeMenu}><MessageCircle size={19} /><span>Messages</span>{summary.unreadConversations > 0 && <b>{summary.unreadConversations}</b>}</a>
            <a href={authenticated ? "/mon-compte/notifications" : "/connexion"} onClick={closeMenu}><Bell size={19} /><span>Notifications</span>{summary.unreadNotifications > 0 && <b>{summary.unreadNotifications}</b>}</a>
            <a href={authenticated ? "/mon-compte" : "/connexion"} onClick={closeMenu}>{authenticated ? <UserRound size={19} /> : <LogIn size={19} />}<span>{authenticated ? "Mon compte" : "Connexion"}</span></a>
          </div>
          <a className="button button-primary mobile-post-button pa-mobile-deposit" href="/deposer-une-annonce" onClick={closeMenu}><Plus size={19} />Déposer une annonce</a>
        </div>
      </div>
    </header>
  );
}
