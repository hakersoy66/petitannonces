export const metadata = {
  title: "Centre de conformité | Petit Annonces",
  description: "Vos droits, la sécurité des produits, la fiscalité vendeurs et les mécanismes DSA sur Petit Annonces.",
};

const cards = [
  ["Vie privée & RGPD", "Accès, export, rectification, opposition et suppression de vos données depuis votre compte."],
  ["Cookies & CNIL", "Les traceurs non essentiels restent désactivés tant que vous ne les avez pas acceptés. Vos choix peuvent être modifiés à tout moment."],
  ["DSA — contenu illicite", "Un mécanisme distinct permet de signaler un contenu potentiellement illicite, même sans compte, puis de suivre la décision."],
  ["Sécurité des produits — GPSR", "Les annonces concernées peuvent contenir le fabricant, la personne responsable dans l’UE, l’identifiant produit et les avertissements de sécurité."],
  ["Vendeurs professionnels", "Le statut professionnel est clairement distingué du particulier afin d’afficher les informations et droits consommateurs applicables."],
  ["DAC7", "Lorsque les règles fiscales l’exigent, les informations d’identification et les montants annuels des vendeurs sont préparés pour le reporting réglementaire."],
];

export default function CompliancePage() {
  return (
    <main className="shell" style={{ paddingBlock: 56 }}>
      <p style={{ color: "#5b4cf0", fontWeight: 900, textTransform: "uppercase", letterSpacing: ".1em", fontSize: 12 }}>Confiance & conformité</p>
      <h1 style={{ marginTop: 12, fontSize: "clamp(2.4rem,5vw,4.7rem)", letterSpacing: "-.055em", lineHeight: 1 }}>Vos droits sont intégrés au produit.</h1>
      <p style={{ maxWidth: 760, marginTop: 18, color: "#6c6c7d", lineHeight: 1.7 }}>Petit Annonces sépare les obligations de confidentialité, modération, sécurité produit, consommation et fiscalité pour conserver des décisions traçables et des parcours compréhensibles.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 16, marginTop: 34 }}>
        {cards.map(([title, text]) => <section key={title} style={{ border: "1px solid #e7e7ee", borderRadius: 22, padding: 22, background: "#fff" }}><h2 style={{ fontSize: 18 }}>{title}</h2><p style={{ marginTop: 10, color: "#6c6c7d", lineHeight: 1.6 }}>{text}</p></section>)}
      </div>
      <section style={{ marginTop: 28, borderRadius: 24, padding: 26, background: "#17172b", color: "white" }}>
        <h2>Documents et démarches</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 16 }}>
          <a href="/conditions-generales" style={{ padding: "11px 15px", borderRadius: 999, background: "white", color: "#17172b", fontWeight: 800 }}>Conditions générales</a>
          <a href="/confidentialite" style={{ padding: "11px 15px", borderRadius: 999, background: "white", color: "#17172b", fontWeight: 800 }}>Confidentialité</a>
          <a href="/cookies" style={{ padding: "11px 15px", borderRadius: 999, background: "white", color: "#17172b", fontWeight: 800 }}>Cookies</a>
          <a href="/signaler-contenu-illicite" style={{ padding: "11px 15px", borderRadius: 999, background: "#5b4cf0", color: "white", fontWeight: 800 }}>Signaler un contenu illicite</a>
        </div>
      </section>
    </main>
  );
}
