import type { Metadata } from "next";

type Props = { params: Promise<{ slug: string }> };

function titleFromSlug(slug: string) {
  return decodeURIComponent(slug).replace(/-\d+$/, "").replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const title = titleFromSlug(slug);
  return {
    title: `${title} | Petit Annonces`,
    description: `Consultez cette annonce ${title} sur Petit Annonces.`,
    alternates: { canonical: `/annonce/${slug}` },
  };
}

export default async function ListingPage({ params }: Props) {
  const { slug } = await params;
  const title = titleFromSlug(slug);
  return (
    <main className="shell" style={{ padding: "28px 0 72px" }}>
      <nav aria-label="Fil d’Ariane" style={{ color: "#6b7280", marginBottom: 16 }}>Accueil › Annonces › {title}</nav>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 360px", gap: 28 }}>
        <section>
          <div className="card" style={{ minHeight: 440, display: "grid", placeItems: "center", marginBottom: 24 }}>
            <span style={{ color: "#6b7280" }}>Galerie photos de l’annonce</span>
          </div>
          <h1>{title}</h1>
          <div className="card" style={{ padding: 24 }}>
            <h2>Description</h2>
            <p>Les données publiques de cette page sont fournies par l’endpoint <code>/public/listings/:slug</code>, avec les attributs de catégorie, informations véhicule ou immobilier et DPE/GES lorsque concernés.</p>
          </div>
        </section>
        <aside>
          <div className="card" style={{ padding: 24, position: "sticky", top: 96 }}>
            <p style={{ color: "#6b7280" }}>Prix</p>
            <h2>— €</h2>
            <button className="button button-primary" style={{ width: "100%" }}>Contacter le vendeur</button>
            <button className="button" style={{ width: "100%", marginTop: 10 }}>Faire une offre</button>
            <hr style={{ margin: "22px 0", border: 0, borderTop: "1px solid #e5e7eb" }} />
            <strong>Vendeur</strong>
            <p style={{ color: "#6b7280" }}>Profil, ancienneté et statut professionnel seront affichés ici.</p>
          </div>
        </aside>
      </div>
    </main>
  );
}
