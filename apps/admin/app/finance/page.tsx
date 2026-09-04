export default function FinancePage() {
  return <main style={{ padding: 36, maxWidth: 1200, margin: "0 auto" }}>
    <a href="/" style={{ color: "#5b4cf0" }}>← Operations Center</a>
    <h1>Finance Center</h1>
    <p style={{ color: "#6c6c7d" }}>Commandes, paiements, remboursements, commissions et payouts.</p>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginTop: 24 }}>
      {["GMV","Commissions","Remboursements","Payouts en attente"].map((x) => <div key={x} style={{ border: "1px solid #e5e5ec", borderRadius: 16, padding: 18 }}><small>{x}</small><strong style={{ display: "block", fontSize: 26, marginTop: 8 }}>—</strong></div>)}
    </div>
    <section style={{ marginTop: 28, border: "1px solid #e5e5ec", borderRadius: 18, padding: 22 }}><h2>Transactions</h2><p>Source API : <code>/admin/finance/orders</code></p><p>Les statuts payment et payout sont rapprochés avec la commande.</p></section>
  </main>;
}
