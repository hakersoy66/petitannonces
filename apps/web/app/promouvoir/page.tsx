export const metadata = {
  title: "Booster une annonce | Petit Annonces",
  description: "Augmentez la visibilité de vos annonces avec Urgent, À la une, Remonter, Sponsorisé et Galerie.",
};

const offers = [
  { code: "URGENT_7D", name: "Urgent", price: "2,99 €", duration: "7 jours", credits: "1 crédit", description: "Ajoute un badge Urgent visible dans la fiche et les résultats." },
  { code: "BUMP_NOW", name: "Remonter", price: "1,99 €", duration: "Immédiat", credits: "1 crédit", description: "Replace votre annonce plus haut dans les résultats éligibles." },
  { code: "GALLERY_7D", name: "Galerie", price: "4,99 €", duration: "7 jours", credits: "2 crédits", description: "Affichage visuel premium pour mieux mettre en valeur vos photos." },
  { code: "FEATURED_7D", name: "À la une", price: "6,99 €", duration: "7 jours", credits: "3 crédits", description: "Renforce la visibilité dans les emplacements de mise en avant." },
  { code: "SPONSORED_7D", name: "Sponsorisé", price: "9,99 €", duration: "7 jours", credits: "5 crédits", description: "Diffusion sponsorisée clairement identifiée dans les zones prévues." },
];

export default function PromotePage() {
  return <main className="shell" style={{ paddingBlock: 56 }}>
    <p style={{ color: "#5b4cf0", fontWeight: 900, textTransform: "uppercase", fontSize: 12 }}>Visibilité</p>
    <h1 style={{ fontSize: "clamp(2.2rem,5vw,4.2rem)", marginTop: 8, letterSpacing: "-.05em" }}>Booster mon annonce</h1>
    <p style={{ maxWidth: 720, color: "#6c6c7d", lineHeight: 1.7, marginTop: 14 }}>Choisissez une mise en avant adaptée à votre objectif. Les avantages professionnels peuvent aussi être réglés avec des crédits inclus dans votre formule.</p>
    <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 16, marginTop: 30 }}>
      {offers.map((offer) => <article key={offer.code} style={{ border: "1px solid #e7e7ee", borderRadius: 22, padding: 22, background: "white" }}>
        <small style={{ color: "#77778a", fontWeight: 800 }}>{offer.duration}</small>
        <h2 style={{ marginTop: 8 }}>{offer.name}</h2>
        <p style={{ color: "#6c6c7d", minHeight: 72, lineHeight: 1.55 }}>{offer.description}</p>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "end", marginTop: 18 }}>
          <div><strong style={{ fontSize: 25 }}>{offer.price}</strong><small style={{ display: "block", color: "#77778a", marginTop: 4 }}>ou {offer.credits}</small></div>
          <button type="button" className="primary-button">Choisir</button>
        </div>
      </article>)}
    </section>
    <section style={{ marginTop: 28, padding: 24, borderRadius: 22, background: "#17172b", color: "white" }}>
      <h2>Crédits professionnels</h2>
      <p style={{ color: "#c9c9d5", lineHeight: 1.65 }}>Les crédits peuvent être inclus dans les offres Professionnel et Premium, accordés via une campagne ou obtenus avec un code promotionnel. Le solde et l’historique sont disponibles via votre portefeuille promotionnel.</p>
    </section>
  </main>;
}
