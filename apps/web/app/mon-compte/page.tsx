"use client";

import { useEffect, useMemo, useState } from "react";
import { AccountNav } from "../../components/account-nav";
import { SiteHeader } from "../../components/site-header";
import styles from "./page.module.css";

type ListingStatus = "DRAFT" | "PENDING" | "PUBLISHED" | "SUSPENDED" | "SOLD" | "EXPIRED";
type DashboardData = {
  user: { id: string; email: string; kind: "PARTICULIER" | "PROFESSIONNEL"; displayName: string; avatarUrl: string | null };
  stats: { listings: Record<ListingStatus, number>; totalListings: number; unreadConversations: number; pendingOffers: number; unreadNotifications:number };
  recentListings: Array<{ id: string; title: string | null; slug: string | null; status: ListingStatus; priceMinor: number | null; currency: string; city: string | null; updatedAt: string; category: { name: string; slug: string } }>;
  stores: Array<{ id: string; name: string; slug: string; status: string; isVerified: boolean }>;
};

const preview: DashboardData = {
  user: { id: "preview", email: "hakan@example.fr", kind: "PARTICULIER", displayName: "Hakan", avatarUrl: null },
  stats: { listings: { DRAFT: 2, PENDING: 1, PUBLISHED: 8, SUSPENDED: 0, SOLD: 14, EXPIRED: 3 }, totalListings: 28, unreadConversations: 4, pendingOffers: 2, unreadNotifications:3 },
  recentListings: [
    { id: "1", title: "iPhone 15 Pro 256 Go titane", slug: "iphone-15-pro", status: "PUBLISHED", priceMinor: 89900, currency: "EUR", city: "Saint-Étienne", updatedAt: new Date().toISOString(), category: { name: "Téléphones & smartphones", slug: "telephones-smartphones" } },
    { id: "2", title: "Renault Clio V TCe 90", slug: "renault-clio-v", status: "PENDING", priceMinor: 1399000, currency: "EUR", city: "Lyon", updatedAt: new Date().toISOString(), category: { name: "Voitures", slug: "voitures" } },
    { id: "3", title: "Canapé d'angle velours beige", slug: "canape-angle", status: "DRAFT", priceMinor: 28000, currency: "EUR", city: "Saint-Chamond", updatedAt: new Date().toISOString(), category: { name: "Maison & Jardin", slug: "maison-jardin" } },
  ], stores: [],
};

const statusLabels: Record<ListingStatus, string> = { DRAFT: "Brouillon", PENDING: "En vérification", PUBLISHED: "En ligne", SUSPENDED: "Suspendue", SOLD: "Vendue", EXPIRED: "Expirée" };
function apiBase() { return (process.env.NEXT_PUBLIC_API_URL ?? "/api").replace(/\/$/, ""); }
function euro(value: number | null) { return value === null ? "Prix non défini" : new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value / 100); }

export default function AccountDashboardPage() {
  const [data, setData] = useState<DashboardData>(preview); const [live, setLive] = useState(false); const [filter, setFilter] = useState<"ALL" | ListingStatus>("ALL");
  useEffect(() => { fetch(`${apiBase()}/account/dashboard`, { credentials: "include" }).then(async (response) => { if (response.status===401){window.location.href="/connexion?next=/mon-compte";throw new Error("unauthorized")} if (!response.ok) throw new Error("dashboard_unavailable"); return response.json() as Promise<DashboardData>; }).then((payload) => { setData(payload); setLive(true); }).catch(() => setLive(false)); }, []);
  const listings = useMemo(() => filter === "ALL" ? data.recentListings : data.recentListings.filter((listing) => listing.status === filter), [data.recentListings, filter]);
  const initials = data.user.displayName.slice(0, 2).toUpperCase();
  return <div className={styles.page}><SiteHeader/><main className={styles.shell}>
    <aside className={styles.sidebar}><div className={styles.profileMini}><div className={styles.avatar}>{data.user.avatarUrl ? <img src={data.user.avatarUrl} alt="" /> : initials}</div><div><strong>{data.user.displayName}</strong><span>{data.user.kind === "PROFESSIONNEL" ? "Compte professionnel" : "Compte particulier"}</span></div></div>
      <AccountNav active="dashboard" mode="sidebar" unreadMessages={data.stats.unreadConversations} unreadNotifications={data.stats.unreadNotifications}/>
      <div className={styles.proCard}><div className={styles.proIcon}>PRO</div><strong>Passez au niveau supérieur</strong><p>Statistiques, boutique, remontées et outils professionnels.</p><a href="/boutique">Découvrir Petit Annonces Pro</a></div>
    </aside>
    <section className={styles.content}><div className={styles.hero}><div><span className={styles.eyebrow}>Mon espace</span><h1>Bonjour {data.user.displayName} 👋</h1><p>Retrouvez vos annonces, messages, offres et activités au même endroit.</p></div><div className={styles.heroActions}>{!live && <span className={styles.previewBadge}>Aperçu</span>}<a className={styles.secondary} href="/recherche">Voir le site</a><a className={styles.primary} href="/deposer-une-annonce">+ Déposer une annonce</a></div></div>
      <div className={styles.statsGrid}><article><span className={styles.statIcon}>A</span><div><small>Annonces en ligne</small><strong>{data.stats.listings.PUBLISHED}</strong><em>{data.stats.totalListings} au total</em></div></article><article><span className={styles.statIcon}>M</span><div><small>Messages non lus</small><strong>{data.stats.unreadConversations}</strong><em>À consulter</em></div></article><article><span className={styles.statIcon}>€</span><div><small>Offres reçues</small><strong>{data.stats.pendingOffers}</strong><em>En attente de réponse</em></div></article><article><span className={styles.statIcon}>N</span><div><small>Notifications</small><strong>{data.stats.unreadNotifications}</strong><em>Non lues</em></div></article></div>
      <div className={styles.mainGrid}><section className={styles.panel}><div className={styles.panelHeader}><div><span className={styles.eyebrow}>Mes annonces</span><h2>Activité récente</h2></div><a href="/mon-compte/annonces">Tout voir →</a></div><div className={styles.filters}>{(["ALL", "PUBLISHED", "PENDING", "DRAFT", "SOLD"] as const).map((item) => <button key={item} onClick={() => setFilter(item)} className={filter === item ? styles.filterActive : undefined}>{item === "ALL" ? "Toutes" : statusLabels[item]}</button>)}</div><div className={styles.listings}>{listings.length === 0 ? <div className={styles.empty}>Aucune annonce dans cette catégorie.</div> : listings.map((listing, index) => <article className={styles.listingRow} key={listing.id}><div className={`${styles.thumb} ${styles[`thumb${index % 3}`]}`}><span>{listing.category.name.charAt(0)}</span></div><div className={styles.listingInfo}><div className={styles.titleLine}><strong>{listing.title ?? "Annonce sans titre"}</strong><span className={`${styles.status} ${styles[`status${listing.status}`]}`}>{statusLabels[listing.status]}</span></div><p>{listing.category.name} · {listing.city ?? "France"}</p><div className={styles.listingMeta}><b>{euro(listing.priceMinor)}</b><span>Modifiée récemment</span></div></div><button className={styles.more} aria-label="Plus d'actions">•••</button></article>)}</div></section>
        <aside className={styles.rightColumn}><section className={`${styles.panel} ${styles.quickPanel}`}><div className={styles.panelHeader}><div><span className={styles.eyebrow}>Raccourcis</span><h2>Actions rapides</h2></div></div><div className={styles.quickLinks}><a href="/deposer-une-annonce"><span>+</span><div><strong>Créer une annonce</strong><small>Publier en quelques minutes</small></div><i>›</i></a><a href="/messages"><span>M</span><div><strong>Répondre aux messages</strong><small>{data.stats.unreadConversations} conversation(s) à lire</small></div><i>›</i></a><a href="/mon-compte/notifications"><span>N</span><div><strong>Voir mes notifications</strong><small>{data.stats.unreadNotifications} notification(s) non lue(s)</small></div><i>›</i></a></div></section>
          <section className={`${styles.panel} ${styles.accountHealth}`}><div className={styles.healthTop}><div><span className={styles.eyebrow}>Confiance</span><h2>Votre profil</h2></div><b>75%</b></div><div className={styles.progress}><span/></div><ul><li className={styles.done}>✓ E-mail vérifié</li><li className={styles.done}>✓ Profil renseigné</li><li>○ Téléphone à vérifier</li><li>○ Identité à confirmer</li></ul><a href="/mon-compte/profil">Améliorer mon profil</a></section></aside>
      </div>
    </section>
  </main></div>;
}
