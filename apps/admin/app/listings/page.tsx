export default function ListingsPage() {
  return <main style={{ padding: 36, maxWidth: 1200, margin: "0 auto" }}>
    <a href="/" style={{ color: "#5b4cf0" }}>← Operations Center</a>
    <h1>Annonces</h1>
    <p style={{ color: "#6c6c7d" }}>Vue opérationnelle des annonces récentes, statuts, vendeur, catégorie et localisation.</p>
    <section style={{ marginTop: 24, border: "1px solid #e5e5ec", borderRadius: 18, padding: 22 }}>
      <h2>Catalogue opérationnel</h2>
      <p>Source API : <code>GET /admin/listings</code></p>
      <p>Les actions sensibles restent historisées dans la modération ou l’audit admin.</p>
    </section>
  </main>;
}
