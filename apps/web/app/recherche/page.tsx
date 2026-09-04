export default function SearchPage() {
  return (
    <main className="shell" style={{ padding: "32px 0 64px" }}>
      <section style={{ display: "grid", gap: 24 }}>
        <header>
          <p style={{ color: "#6b7280", marginBottom: 8 }}>Petit Annonces</p>
          <h1 style={{ margin: 0 }}>Rechercher des annonces</h1>
          <p style={{ color: "#6b7280" }}>Recherche par mots-clés, catégorie, ville, prix et distance.</p>
        </header>
        <form action="/recherche" method="get" style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 12 }}>
          <input name="q" placeholder="Que recherchez-vous ?" aria-label="Recherche" />
          <input name="city" placeholder="Ville" aria-label="Ville" />
          <input name="radiusKm" type="number" min="1" max="300" placeholder="Rayon km" aria-label="Rayon" />
          <button className="button button-primary" type="submit">Rechercher</button>
        </form>
        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 24 }}>
          <aside className="card" style={{ padding: 20 }}>
            <h2 style={{ fontSize: 18 }}>Filtres</h2>
            <label>Prix minimum<input name="minPrice" type="number" /></label>
            <label>Prix maximum<input name="maxPrice" type="number" /></label>
            <p style={{ color: "#6b7280", fontSize: 14 }}>Les filtres dynamiques par catégorie seront chargés depuis le moteur d’attributs.</p>
          </aside>
          <section>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2>Résultats</h2>
              <select aria-label="Trier"><option>Plus récentes</option><option>Prix croissant</option><option>Prix décroissant</option><option>Plus proches</option></select>
            </div>
            <div className="card" style={{ padding: 32, textAlign: "center" }}>
              <p>Les résultats sont fournis par l’API de recherche Petit Annonces avec OpenSearch et fallback PostgreSQL.</p>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
