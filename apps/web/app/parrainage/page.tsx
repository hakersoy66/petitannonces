export const metadata = {
  title: "Parrainage | Petit Annonces",
  description: "Invitez vos proches et gagnez des crédits de mise en avant quand un filleul devient éligible.",
};

export default function ReferralPage() {
  return <main className="shell" style={{ paddingBlock: 56, maxWidth: 900 }}>
    <p style={{ color: "#5b4cf0", fontWeight: 900, textTransform: "uppercase", fontSize: 12 }}>Parrainage</p>
    <h1 style={{ marginTop: 8 }}>Invitez. Gagnez des crédits.</h1>
    <p style={{ marginTop: 12, color: "#6c6c7d", lineHeight: 1.7 }}>Chaque membre dispose d’un code personnel. Lorsqu’un filleul remplit les conditions d’éligibilité définies par Petit Annonces, le parrain reçoit des crédits de mise en avant.</p>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: 16, marginTop: 28 }}>
      {[['1','Partagez votre code','Votre code est généré automatiquement dans votre espace.'],['2','Votre filleul rejoint Petit Annonces','Le code ne peut être appliqué qu’une fois par compte.'],['3','La condition est validée','La qualification peut dépendre d’une action réelle comme une annonce publiée ou une transaction conforme.'],['4','Recevez vos crédits','Les crédits apparaissent dans votre portefeuille promotionnel.']].map(([n,title,text]) => <article key={n} style={{ border: "1px solid #e7e7ee", borderRadius: 20, padding: 20 }}><strong style={{ color: "#5b4cf0" }}>{n}</strong><h2 style={{ fontSize: 18, marginTop: 8 }}>{title}</h2><p style={{ color: "#6c6c7d", lineHeight: 1.55 }}>{text}</p></article>)}
    </div>
    <div style={{ marginTop: 26, padding: 22, background: "#f6f6f9", borderRadius: 20 }}>
      <strong>Anti-abus</strong>
      <p style={{ color: "#6c6c7d", lineHeight: 1.6 }}>Les auto-parrainages, comptes multiples et récompenses artificielles sont bloqués. Les récompenses sont accordées uniquement après qualification.</p>
    </div>
  </main>;
}
