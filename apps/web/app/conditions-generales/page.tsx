export const metadata = { title: "Conditions générales | Petit Annonces" };

export default function TermsPage() {
  return <main className="shell" style={{ paddingBlock: 56, maxWidth: 900 }}>
    <h1>Conditions générales d’utilisation et de marketplace</h1>
    <p style={{ marginTop: 14, color: "#6c6c7d", lineHeight: 1.7 }}>Version produit 2026-09. Cette page constitue la structure fonctionnelle des conditions générales et devra recevoir la validation juridique finale avant mise en production.</p>
    {[
      ["1. Objet", "Petit Annonces permet aux particuliers et professionnels de publier des annonces, échanger, faire des offres et, lorsque disponible, conclure une transaction protégée."],
      ["2. Comptes", "L’utilisateur fournit des informations exactes, protège son compte et respecte les règles de sécurité et de vérification applicables."],
      ["3. Annonces", "Les contenus illicites, trompeurs, dangereux, contrefaits ou interdits sont prohibés. Des contrôles automatiques et humains peuvent être appliqués."],
      ["4. Transactions", "Les paiements protégés sont traités par un prestataire de paiement agréé. Les règles de livraison, litige, remboursement et versement vendeur sont liées au numéro de commande."],
      ["5. Professionnels", "Les vendeurs professionnels doivent fournir leurs informations d’entreprise et les informations précontractuelles et consommateurs requises."],
      ["6. Modération et recours", "Toute restriction significative peut donner lieu à une motivation. Les décisions éligibles peuvent être contestées via le mécanisme interne prévu."],
      ["7. Responsabilité", "Chaque utilisateur reste responsable des contenus, produits et informations qu’il publie, sous réserve des obligations légales propres à la plateforme."],
    ].map(([h,p]) => <section key={h} style={{ marginTop: 28 }}><h2>{h}</h2><p style={{ marginTop: 8, color: "#555568", lineHeight: 1.7 }}>{p}</p></section>)}
  </main>;
}
