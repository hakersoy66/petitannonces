export default function AnalyticsPage() {
  return <main style={{ padding: 36, maxWidth: 1200, margin: "0 auto" }}>
    <a href="/" style={{ color: "#5b4cf0" }}>← Operations Center</a>
    <h1>Analytics</h1>
    <p style={{ color: "#6c6c7d" }}>Acquisition, activité marketplace, revenus, litiges, support et modération.</p>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginTop: 24 }}>
      {["Nouveaux utilisateurs","Annonces publiées","Commandes payées","GMV","Revenus plateforme","Taux de litige"].map((x) => <div key={x} style={{ border: "1px solid #e5e5ec", borderRadius: 16, padding: 18 }}><small>{x}</small><strong style={{ display: "block", fontSize: 26, marginTop: 8 }}>—</strong></div>)}
    </div>
    <section style={{ marginTop: 28, border: "1px solid #e5e5ec", borderRadius: 18, padding: 22 }}><h2>Historique</h2><p>Source API : <code>/admin/analytics/daily?days=30</code></p><p>Le rollup quotidien est généré via l’endpoint interne protégé <code>/internal/analytics/rollup</code>.</p></section>
  </main>;
}
