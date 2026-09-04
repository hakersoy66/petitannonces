export const metadata = {
  title: "Moderation Center | Petit Annonces",
};

const queues = [
  { title: "Priorité critique", text: "Fraude, sécurité, produits interdits et signalements multiples." },
  { title: "À examiner", text: "Annonces, comptes, messages et boutiques en attente d’une décision humaine." },
  { title: "Appels", text: "Contestations des décisions de modération et réexamens." },
];

export default function ModerationCenterPage() {
  return (
    <main style={{ padding: 32, maxWidth: 1180, margin: "0 auto" }}>
      <p style={{ fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", fontSize: 12 }}>Trust & Safety</p>
      <h1>Moderation Center</h1>
      <p>File de traitement des signalements, scores de risque, décisions motivées et appels.</p>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 16, marginTop: 28 }}>
        {queues.map((queue) => (
          <article key={queue.title} style={{ border: "1px solid #e5e7eb", borderRadius: 16, padding: 20 }}>
            <h2 style={{ fontSize: 18 }}>{queue.title}</h2>
            <p>{queue.text}</p>
          </article>
        ))}
      </section>

      <section style={{ marginTop: 28, border: "1px solid #e5e7eb", borderRadius: 16, padding: 24 }}>
        <h2>Vue d’un dossier</h2>
        <p>Le modérateur verra les signalements liés, le score de risque et ses signaux explicables, l’historique des actions, la décision, le motif communiqué à l’utilisateur et l’état d’un éventuel appel.</p>
      </section>
    </main>
  );
}
