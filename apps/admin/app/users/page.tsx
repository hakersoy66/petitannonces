export default function UsersPage() {
  return <main style={{ padding: 36, maxWidth: 1200, margin: "0 auto" }}>
    <a href="/" style={{ color: "#5b4cf0" }}>← Operations Center</a>
    <h1>Utilisateurs</h1>
    <p style={{ color: "#6c6c7d" }}>Recherche de comptes, statut, rôles et vérification.</p>
    <section style={{ marginTop: 24, border: "1px solid #e5e5ec", borderRadius: 18, padding: 22 }}>
      <h2>Gestion des comptes</h2>
      <p>Recherche : <code>GET /admin/users?q=...</code></p>
      <p>Changement de statut : <code>POST /admin/users/:id/status</code></p>
      <p>Une suspension ou suppression révoque les sessions actives.</p>
    </section>
  </main>;
}
