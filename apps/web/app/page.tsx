export default function HomePage() {
  return (
    <main>
      <section className="hero">
        <p className="eyebrow">Petit Annonces 2.0</p>
        <h1>Tout ce que la France cherche, au même endroit.</h1>
        <p className="lead">La nouvelle plateforme française pour acheter, vendre et échanger en toute simplicité.</p>
        <div className="actions">
          <button type="button">Déposer une annonce</button>
          <button type="button" className="secondary">Explorer les annonces</button>
        </div>
      </section>
    </main>
  );
}
