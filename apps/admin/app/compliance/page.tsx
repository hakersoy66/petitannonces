export const metadata = { title: "Compliance Center | Petit Annonces Admin" };

const items = [
  ["Privacy requests", "Demandes d’accès, export, effacement, rectification et opposition avec échéance de traitement."],
  ["DSA notices", "Notifications de contenu potentiellement illicite, décisions et références de suivi."],
  ["Product safety", "Annonces GPSR à revoir, produits restreints ou rappelés et informations de sécurité manquantes."],
  ["DAC7", "Profils fiscaux vendeurs, due diligence et synthèses annuelles à préparer pour le reporting."],
  ["B2C disclosures", "Contrôle des mentions vendeur professionnel, rétractation, garanties et médiation."],
  ["Legal versions", "Versions actives des CGU, confidentialité et cookies ainsi que les acceptations enregistrées."],
];

export default function ComplianceAdminPage() {
  return <main style={{ padding: 32 }}>
    <p style={{ color: "#5b4cf0", fontWeight: 900, fontSize: 12, textTransform: "uppercase" }}>Administration</p>
    <h1 style={{ marginTop: 8 }}>Compliance Center</h1>
    <p style={{ marginTop: 10, color: "#6c6c7d", maxWidth: 760, lineHeight: 1.6 }}>Vue opérationnelle des obligations France/UE. Les décisions réglementaires sensibles restent traçables et réservées aux rôles autorisés.</p>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 16, marginTop: 28 }}>
      {items.map(([title, text]) => <section key={title} style={{ border: "1px solid #e7e7ee", borderRadius: 20, padding: 20, background: "#fff" }}><h2 style={{ fontSize: 18 }}>{title}</h2><p style={{ marginTop: 8, color: "#6c6c7d", lineHeight: 1.55 }}>{text}</p></section>)}
    </div>
  </main>;
}
