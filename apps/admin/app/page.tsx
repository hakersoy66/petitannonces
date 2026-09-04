const cards = [
  ["Utilisateurs", "—", "Comptes, statuts et rôles"],
  ["Annonces actives", "—", "Publication et contrôle"],
  ["GMV", "— €", "Transactions sécurisées"],
  ["Tickets ouverts", "—", "Support client"],
  ["Modération", "—", "Cas à traiter"],
  ["Croissance", "—", "Promotions, crédits et acquisition"],
];

const nav = [
  ["Utilisateurs", "/users"], ["Annonces", "/listings"], ["Finance", "/finance"],
  ["Support", "/support"], ["Modération", "/moderation"], ["Conformité", "/compliance"], ["Analytics", "/analytics"], ["Croissance", "/growth"],
];

export default function AdminHome() {
  return <main style={{ minHeight: "100vh", background: "#f6f7fb", color: "#17172b" }}>
    <header style={{ background: "white", borderBottom: "1px solid #e8e8ef", padding: "18px 28px", display: "flex", alignItems: "center", gap: 24 }}>
      <strong>Petit Annonces · Admin</strong><nav style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>{nav.map(([label, href]) => <a key={href} href={href} style={{ color: "#56566a", textDecoration: "none", fontSize: 14 }}>{label}</a>)}</nav>
    </header>
    <section style={{ maxWidth: 1280, margin: "0 auto", padding: 36 }}>
      <p style={{ color: "#5b4cf0", fontWeight: 800, fontSize: 12, textTransform: "uppercase" }}>Operations Center</p>
      <h1 style={{ fontSize: 38, margin: "8px 0" }}>Vue d’ensemble</h1>
      <p style={{ color: "#717183", marginBottom: 28 }}>Pilotage utilisateurs, marketplace, finance, support, confiance, conformité et croissance.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 16 }}>
        {cards.map(([label, value, hint]) => <article key={label} style={{ background: "white", border: "1px solid #e8e8ef", borderRadius: 18, padding: 20 }}><small style={{ color: "#77778a" }}>{label}</small><div style={{ fontSize: 28, fontWeight: 850, marginTop: 8 }}>{value}</div><p style={{ color: "#8b8b99", fontSize: 13 }}>{hint}</p></article>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 18, marginTop: 22 }}>
        <article style={{ background: "white", border: "1px solid #e8e8ef", borderRadius: 18, padding: 22 }}><h2>Activité marketplace</h2><p style={{ color: "#77778a" }}>Les KPI réels sont fournis par <code>/admin/dashboard</code>, <code>/admin/analytics/daily</code> et <code>/admin/growth/summary</code>.</p></article>
        <article style={{ background: "#17172b", color: "white", borderRadius: 18, padding: 22 }}><h2>Priorités</h2><p>Tickets urgents, litiges actifs, cas critiques, conformité et campagnes apparaîtront ici.</p></article>
      </div>
    </section>
  </main>;
}
