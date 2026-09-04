"use client";

import { useEffect, useMemo, useState } from "react";
import { SiteHeader } from "../../../components/site-header";
import styles from "./page.module.css";

type Status = "DRAFT" | "PENDING" | "PUBLISHED" | "SUSPENDED" | "SOLD" | "EXPIRED";
type Listing = {
  id: string;
  title: string | null;
  slug: string | null;
  status: Status;
  priceMinor: number | null;
  currency: string;
  city: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  category: { name: string; slug: string };
};

const labels: Record<Status | "ALL", string> = {
  ALL: "Toutes",
  DRAFT: "Brouillons",
  PENDING: "En modération",
  PUBLISHED: "Actives",
  SUSPENDED: "En pause",
  SOLD: "Vendues",
  EXPIRED: "Expirées",
};

function apiBase() {
  return (process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");
}

function price(value: number | null, currency: string) {
  if (value === null) return "Prix non défini";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency, maximumFractionDigits: 0 }).format(value / 100);
}

export default function MyListingsPage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [status, setStatus] = useState<Status | "ALL">("ALL");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (status !== "ALL") params.set("status", status);
    if (query.trim()) params.set("q", query.trim());
    try {
      const response = await fetch(`${apiBase()}/account/listings?${params}`, { credentials: "include" });
      if (!response.ok) throw new Error();
      const payload = await response.json() as { listings: Listing[] };
      setListings(payload.listings);
      setMessage("");
    } catch {
      setMessage("Impossible de charger vos annonces pour le moment.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [status]);

  const counts = useMemo(() => {
    const result: Record<string, number> = { ALL: listings.length };
    for (const item of listings) result[item.status] = (result[item.status] ?? 0) + 1;
    return result;
  }, [listings]);

  async function changeStatus(id: string, next: Status) {
    setMessage("");
    const response = await fetch(`${apiBase()}/account/listings/${encodeURIComponent(id)}/status`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (!response.ok) {
      setMessage("Cette action n’est pas disponible pour cette annonce.");
      return;
    }
    await load();
  }

  async function removeDraft(id: string) {
    if (!window.confirm("Supprimer définitivement ce brouillon ?")) return;
    const response = await fetch(`${apiBase()}/account/listings/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include" });
    if (!response.ok) {
      setMessage("Impossible de supprimer ce brouillon.");
      return;
    }
    await load();
  }

  return (
    <div className={styles.page}>
      <SiteHeader />
      <main className={styles.shell}>
        <aside className={styles.sidebar}>
          <a href="/mon-compte" className={styles.back}>← Tableau de bord</a>
          <nav>
            <a className={styles.active} href="/mon-compte/annonces">Mes annonces</a>
            <a href="/messages">Messages</a>
            <a href="/#favoris">Favoris</a>
            <a href="/commandes">Achats & ventes</a>
            <a href="/mon-compte">Profil & paramètres</a>
          </nav>
        </aside>

        <section className={styles.content}>
          <header className={styles.heading}>
            <div>
              <p>Mon espace</p>
              <h1>Mes annonces</h1>
              <span>Gérez vos brouillons, annonces actives et ventes depuis un seul endroit.</span>
            </div>
            <a className={styles.create} href="/deposer-une-annonce">+ Déposer une annonce</a>
          </header>

          <div className={styles.toolbar}>
            <div className={styles.tabs}>
              {(Object.keys(labels) as Array<Status | "ALL">).map((item) => (
                <button key={item} className={status === item ? styles.selected : ""} onClick={() => setStatus(item)}>
                  {labels[item]} <span>{counts[item] ?? 0}</span>
                </button>
              ))}
            </div>
            <form className={styles.search} onSubmit={(event) => { event.preventDefault(); void load(); }}>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher dans mes annonces" />
              <button>Rechercher</button>
            </form>
          </div>

          {message && <div className={styles.notice}>{message}</div>}
          {loading ? <div className={styles.empty}>Chargement de vos annonces…</div> : listings.length === 0 ? (
            <div className={styles.empty}><b>Aucune annonce dans cette section.</b><span>Créez une nouvelle annonce ou changez de filtre.</span></div>
          ) : (
            <div className={styles.list}>
              {listings.map((item) => (
                <article className={styles.card} key={item.id}>
                  <div className={styles.thumb}><span>{item.category.name.slice(0, 1).toUpperCase()}</span></div>
                  <div className={styles.mainInfo}>
                    <div className={styles.titleLine}>
                      <div>
                        <small>{item.category.name}</small>
                        <h2>{item.title ?? "Annonce sans titre"}</h2>
                      </div>
                      <span className={`${styles.badge} ${styles[item.status.toLowerCase()]}`}>{labels[item.status]}</span>
                    </div>
                    <strong className={styles.price}>{price(item.priceMinor, item.currency)}</strong>
                    <div className={styles.meta}>
                      <span>{item.city ?? "Localisation à compléter"}</span>
                      <span>Mis à jour le {new Date(item.updatedAt).toLocaleDateString("fr-FR")}</span>
                    </div>
                  </div>
                  <div className={styles.actions}>
                    {item.slug && <a href={`/annonce/${item.slug}`}>Voir</a>}
                    <a href={`/deposer-une-annonce?listingId=${encodeURIComponent(item.id)}`}>Modifier</a>
                    {item.status === "PUBLISHED" && <button onClick={() => void changeStatus(item.id, "SUSPENDED")}>Mettre en pause</button>}
                    {item.status === "PUBLISHED" && <button onClick={() => void changeStatus(item.id, "SOLD")}>Marquer vendue</button>}
                    {(item.status === "SUSPENDED" || item.status === "EXPIRED") && <button onClick={() => void changeStatus(item.id, "PENDING")}>Republier</button>}
                    {item.status === "DRAFT" && <button className={styles.danger} onClick={() => void removeDraft(item.id)}>Supprimer</button>}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
