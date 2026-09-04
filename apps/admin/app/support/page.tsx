export default function SupportPage() {
  return <main style={{ padding: 36, maxWidth: 1200, margin: "0 auto" }}>
    <a href="/" style={{ color: "#5b4cf0" }}>← Operations Center</a>
    <h1>Support Center</h1>
    <p style={{ color: "#6c6c7d" }}>File d’attente client, priorités, assignation agent, réponses et notes internes.</p>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginTop: 24 }}>
      {["Urgent","Ouverts","En attente client","Résolus aujourd’hui"].map((x) => <div key={x} style={{ border: "1px solid #e5e5ec", borderRadius: 16, padding: 18 }}><small>{x}</small><strong style={{ display: "block", fontSize: 26, marginTop: 8 }}>—</strong></div>)}
    </div>
    <section style={{ marginTop: 28, border: "1px solid #e5e5ec", borderRadius: 18, padding: 22 }}><h2>Tickets</h2><p>Source API : <code>/admin/support/tickets</code></p><p>Réponse agent : <code>POST /admin/support/tickets/:id/reply</code></p></section>
  </main>;
}
