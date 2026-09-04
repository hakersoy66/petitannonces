import type { Metadata } from "next";
import { notFound } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type StoreResponse = {
  store: {
    name: string;
    slug: string;
    description?: string | null;
    logoUrl?: string | null;
    coverUrl?: string | null;
    city?: string | null;
    postalCode?: string | null;
    isVerified: boolean;
    business?: { legalName: string; tradeName?: string | null; siren?: string | null; siret?: string | null; verificationStatus: string } | null;
    listings: Array<{ id: string; title?: string | null; slug?: string | null; priceMinor?: number | null; currency: string; city?: string | null }>;
  };
};

async function getStore(slug: string): Promise<StoreResponse | null> {
  const response = await fetch(`${API_URL}/public/stores/${encodeURIComponent(slug)}`, { next: { revalidate: 120 } });
  if (!response.ok) return null;
  return response.json();
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const data = await getStore(slug);
  if (!data) return { title: "Boutique introuvable | Petit Annonces" };
  return {
    title: `${data.store.name} - Boutique professionnelle | Petit Annonces`,
    description: data.store.description?.slice(0, 155) ?? `Découvrez les annonces de ${data.store.name} sur Petit Annonces.`,
    alternates: { canonical: `/boutique/${data.store.slug}` },
  };
}

export default async function StorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await getStore(slug);
  if (!data) notFound();
  const { store } = data;

  return (
    <main className="page-shell">
      <section className="panel" style={{ overflow: "hidden" }}>
        <div style={{ minHeight: 180, borderRadius: 24, background: "linear-gradient(135deg,#5b4bdb,#8c7cf4)", backgroundImage: store.coverUrl ? `url(${store.coverUrl})` : undefined, backgroundSize: "cover", backgroundPosition: "center" }} />
        <div style={{ display: "flex", gap: 18, alignItems: "center", marginTop: -32, padding: "0 20px 20px", position: "relative" }}>
          <div style={{ width: 84, height: 84, borderRadius: 22, background: "white", border: "4px solid white", display: "grid", placeItems: "center", overflow: "hidden", boxShadow: "0 10px 30px rgba(0,0,0,.12)" }}>
            {store.logoUrl ? <img src={store.logoUrl} alt={`Logo ${store.name}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <strong>{store.name.slice(0, 2).toUpperCase()}</strong>}
          </div>
          <div>
            <h1 style={{ marginBottom: 4 }}>{store.name} {store.isVerified ? "✓" : ""}</h1>
            <p style={{ margin: 0 }}>{[store.postalCode, store.city].filter(Boolean).join(" ")}</p>
          </div>
        </div>
        {store.description ? <p style={{ padding: "0 20px 20px", maxWidth: 850 }}>{store.description}</p> : null}
      </section>

      <section style={{ marginTop: 32 }}>
        <div className="section-heading"><div><span className="eyebrow">Boutique</span><h2>Les annonces de {store.name}</h2></div><span>{store.listings.length} annonce{store.listings.length > 1 ? "s" : ""}</span></div>
        <div className="listing-grid">
          {store.listings.map((listing) => (
            <a key={listing.id} href={listing.slug ? `/annonce/${listing.slug}` : "#"} className="listing-card">
              <div className="listing-card__media" />
              <div className="listing-card__body">
                <h3>{listing.title ?? "Annonce professionnelle"}</h3>
                <strong>{listing.priceMinor != null ? new Intl.NumberFormat("fr-FR", { style: "currency", currency: listing.currency }).format(listing.priceMinor / 100) : "Prix sur demande"}</strong>
                <p>{listing.city ?? store.city ?? "France"}</p>
              </div>
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}
