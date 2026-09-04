import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Mes messages | Petit Annonces",
  description: "Retrouvez vos conversations, offres et échanges sécurisés sur Petit Annonces.",
};

export default function MessagesPage() {
  return (
    <main className="shell" style={{ paddingBlock: "32px 64px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 20, marginBottom: 24 }}>
        <div>
          <p style={{ margin: 0, color: "var(--muted)" }}>Messagerie sécurisée</p>
          <h1 style={{ margin: "6px 0 0" }}>Mes messages</h1>
        </div>
        <Link className="button button-primary button-compact" href="/recherche">Voir les annonces</Link>
      </div>

      <section style={{ display: "grid", gridTemplateColumns: "minmax(260px, 360px) 1fr", minHeight: 560, border: "1px solid var(--border)", borderRadius: 24, overflow: "hidden", background: "var(--surface)" }}>
        <aside style={{ borderRight: "1px solid var(--border)", padding: 20 }}>
          <strong>Conversations</strong>
          <p style={{ color: "var(--muted)", lineHeight: 1.5 }}>Vos conversations apparaîtront ici dès que vous contactez un vendeur ou recevez un message sur une annonce.</p>
        </aside>
        <div style={{ display: "grid", placeItems: "center", padding: 32, textAlign: "center" }}>
          <div style={{ maxWidth: 480 }}>
            <div style={{ fontSize: 44, marginBottom: 12 }} aria-hidden="true">💬</div>
            <h2>Échangez sans quitter Petit Annonces</h2>
            <p style={{ color: "var(--muted)", lineHeight: 1.65 }}>
              Messages, pièces jointes et offres sont regroupés dans une seule conversation. Les demandes de paiement hors plateforme peuvent être bloquées pour votre sécurité.
            </p>
            <p style={{ color: "var(--muted)", lineHeight: 1.65 }}>
              Les offres acceptées seront reliées au paiement sécurisé lors de la phase marketplace.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
