export const metadata = {
  title: "Paiement sécurisé | Petit Annonces",
  description: "Finalisez votre achat avec paiement protégé sur Petit Annonces.",
};

export default function CheckoutPage() {
  return (
    <main className="site-shell" style={{ paddingBlock: 48 }}>
      <section className="panel" style={{ maxWidth: 920, margin: "0 auto", padding: 28 }}>
        <p className="eyebrow">Paiement protégé</p>
        <h1>Finaliser votre achat</h1>
        <p className="muted">Le paiement est traité par un prestataire de paiement agréé. Petit Annonces ne stocke jamais les données de carte bancaire.</p>
        <div style={{ display: "grid", gap: 16, marginTop: 28 }}>
          <div className="panel" style={{ padding: 20 }}>
            <strong>Récapitulatif</strong>
            <p className="muted">Prix de l’article, livraison éventuelle et frais de protection acheteur sont détaillés avant validation.</p>
          </div>
          <div className="panel" style={{ padding: 20 }}>
            <strong>Protection acheteur</strong>
            <p className="muted">Le vendeur n’est payé qu’après les étapes prévues de la transaction. Les remboursements et litiges utilisent le même numéro de commande.</p>
          </div>
          <button type="button" className="primary-button">Continuer vers le paiement sécurisé</button>
        </div>
      </section>
    </main>
  );
}
