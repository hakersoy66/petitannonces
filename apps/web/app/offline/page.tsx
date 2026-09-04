export default function OfflinePage() {
  return <main className="shell" style={{ minHeight: "70vh", display: "grid", placeItems: "center", paddingBlock: 60 }}>
    <section style={{ maxWidth: 560, textAlign: "center" }}>
      <div style={{ fontSize: 56 }}>📴</div>
      <h1 style={{ marginTop: 14 }}>Vous êtes hors connexion</h1>
      <p style={{ marginTop: 12, color: "#6c6c7d", lineHeight: 1.7 }}>Certaines pages déjà consultées peuvent rester disponibles. Reconnectez-vous pour actualiser les annonces, messages, paiements et commandes.</p>
      <a href="/" className="button button-primary" style={{ marginTop: 22 }}>Réessayer</a>
    </section>
  </main>;
}
