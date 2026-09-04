const cards = [
  ["Promotions actives", "—", "Urgent, À la une, Remonter, Sponsorisé, Galerie"],
  ["CA promotions", "— €", "Revenus des options de visibilité"],
  ["Crédits en circulation", "—", "Solde promotionnel utilisateurs/pro"],
  ["Parrainages qualifiés", "—", "Acquisition organique"],
  ["Coupons actifs", "—", "Campagnes et codes promotionnels"],
  ["Conversion boost", "— %", "Activation après consultation"],
];

export default function GrowthPage() {
  return <main style={{ minHeight: "100vh", background: "#f6f7fb", color: "#17172b", padding: 36 }}>
    <div style={{ maxWidth: 1280, margin: "0 auto" }}>
      <a href="/" style={{ color: "#5b4cf0", textDecoration: "none", fontWeight: 800 }}>← Operations Center</a>
      <p style={{ marginTop: 28, color: "#5b4cf0", fontWeight: 900, fontSize: 12, textTransform: "uppercase" }}>Growth & Monetization</p>
      <h1 style={{ fontSize: 38, margin: "8px 0" }}>Croissance</h1>
      <p style={{ color: "#717183" }}>Pilotage des promotions, crédits, coupons, parrainage et acquisition.</p>
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 16, marginTop: 28 }}>
        {cards.map(([title,value,hint]) => <article key={title} style={{ background: "white", border: "1px solid #e8e8ef", borderRadius: 18, padding: 20 }}><small style={{ color: "#7a7a8c" }}>{title}</small><div style={{ fontSize: 27, fontWeight: 850, marginTop: 8 }}>{value}</div><p style={{ color: "#8a8a9a", fontSize: 13 }}>{hint}</p></article>)}
      </section>
      <section style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 18, marginTop: 22 }}>
        <article style={{ background: "white", border: "1px solid #e8e8ef", borderRadius: 18, padding: 22 }}>
          <h2>Catalogue de visibilité</h2>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 16 }}><thead><tr><th align="left">Produit</th><th align="right">Prix</th><th align="right">Crédits</th></tr></thead><tbody>{[['Urgent','2,99 €','1'],['Remonter','1,99 €','1'],['Galerie','4,99 €','2'],['À la une','6,99 €','3'],['Sponsorisé','9,99 €','5']].map((r)=><tr key={r[0]}><td style={{ padding: '11px 0', borderTop: '1px solid #eee' }}>{r[0]}</td><td align="right" style={{ borderTop: '1px solid #eee' }}>{r[1]}</td><td align="right" style={{ borderTop: '1px solid #eee' }}>{r[2]}</td></tr>)}</tbody></table>
        </article>
        <article style={{ background: "#17172b", color: "white", borderRadius: 18, padding: 22 }}>
          <h2>API de pilotage</h2>
          <p style={{ color: "#c8c8d4", lineHeight: 1.6 }}><code>/admin/growth/summary</code> agrège promotions, revenus, événements et parrainages. Les crédits manuels sont auditables via les transactions du portefeuille.</p>
        </article>
      </section>
    </div>
  </main>;
}
