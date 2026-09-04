import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Suivi de commande | Petit Annonces",
  description: "Suivez la livraison, confirmez la réception ou ouvrez un litige depuis votre commande Petit Annonces.",
};

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="site-shell" style={{ paddingBlock: 48 }}>
      <section style={{ maxWidth: 980, margin: "0 auto" }}>
        <p className="eyebrow">Commande {id}</p>
        <h1>Suivi de votre commande</h1>
        <p className="muted">Retrouvez ici le transport, la protection acheteur et les actions disponibles selon l’état de la transaction.</p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 18, marginTop: 28 }}>
          <article className="panel" style={{ padding: 24 }}>
            <strong>Livraison</strong>
            <ol style={{ margin: "18px 0 0", paddingLeft: 20, display: "grid", gap: 12 }}>
              <li>Commande payée</li>
              <li>Colis expédié</li>
              <li>En cours d’acheminement</li>
              <li>Livré</li>
            </ol>
            <p className="muted" style={{ marginTop: 18 }}>Le numéro de suivi et le transporteur sont affichés dès que le vendeur expédie le colis.</p>
          </article>

          <article className="panel" style={{ padding: 24 }}>
            <strong>Protection acheteur</strong>
            <p className="muted" style={{ marginTop: 12 }}>Après la livraison, une période de protection s’ouvre avant le déblocage du paiement vendeur. Vous pouvez confirmer plus tôt si tout est conforme.</p>
            <button type="button" className="primary-button" style={{ marginTop: 18 }}>Tout est conforme</button>
          </article>
        </div>

        <article className="panel" style={{ padding: 24, marginTop: 18 }}>
          <strong>Un problème avec la commande ?</strong>
          <p className="muted" style={{ marginTop: 10 }}>Article non reçu, endommagé, non conforme, mauvais article ou suspicion de contrefaçon : ouvrez un litige avant la fin de la protection acheteur.</p>
          <button type="button" className="secondary-button" style={{ marginTop: 16 }}>Ouvrir un litige</button>
        </article>
      </section>
    </main>
  );
}
