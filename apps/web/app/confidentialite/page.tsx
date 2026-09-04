export const metadata = { title: "Politique de confidentialité | Petit Annonces" };

export default function PrivacyPage() {
  const sections = [
    ["Données traitées", "Compte, profil, annonces, messages, commandes, paiements de référence, sécurité, modération, support et données fiscales lorsque la loi l’exige."],
    ["Finalités", "Fournir le service, sécuriser la plateforme, exécuter les transactions, respecter les obligations légales, prévenir la fraude et améliorer le produit selon les bases juridiques applicables."],
    ["Minimisation", "Petit Annonces limite les données au nécessaire. Les données de carte bancaire ne sont pas stockées par la plateforme lorsque le paiement est traité par le prestataire agréé."],
    ["Vos droits", "Vous pouvez demander l’accès, l’export, la rectification, l’effacement, la limitation ou l’opposition selon les conditions prévues par le RGPD."],
    ["Conservation", "Les durées sont définies par catégorie de données, obligations comptables, sécurité, prévention de la fraude et exigences légales."],
    ["Sous-traitants", "Les prestataires techniques, paiement, hébergement, email, anti-fraude et support ne reçoivent que les données nécessaires à leur mission et sont encadrés contractuellement."],
  ];
  return <main className="shell" style={{ paddingBlock: 56, maxWidth: 900 }}><h1>Politique de confidentialité</h1><p style={{ marginTop: 14, color: "#6c6c7d", lineHeight: 1.7 }}>Version produit 2026-09. La version de production devra être complétée avec l’identité juridique finale du responsable de traitement, les coordonnées de contact/DPO le cas échéant, les durées détaillées et les prestataires effectivement retenus.</p>{sections.map(([h,p]) => <section key={h} style={{ marginTop: 28 }}><h2>{h}</h2><p style={{ marginTop: 8, color: "#555568", lineHeight: 1.7 }}>{p}</p></section>)}</main>;
}
