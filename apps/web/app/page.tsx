import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";

const categories = [
  { icon: "🚗", label: "Véhicules", count: "124k annonces", slug: "vehicules" },
  { icon: "🏠", label: "Immobilier", count: "86k annonces", slug: "immobilier" },
  { icon: "💻", label: "High-tech", count: "58k annonces", slug: "high-tech" },
  { icon: "🛋️", label: "Maison", count: "74k annonces", slug: "maison-jardin" },
  { icon: "👕", label: "Mode", count: "92k annonces", slug: "mode" },
  { icon: "⚽", label: "Sports", count: "31k annonces", slug: "sports-loisirs" },
  { icon: "🧸", label: "Enfants", count: "43k annonces", slug: "enfants" },
  { icon: "🛠️", label: "Services", count: "21k annonces", slug: "services" },
];

const listings = [
  { title: "iPhone 16 Pro · 256 Go", price: "829 €", city: "Lyon 2e", meta: "Comme neuf", tone: "violet" },
  { title: "Peugeot 3008 GT Hybrid", price: "27 490 €", city: "Bordeaux", meta: "2024 · 18 400 km", tone: "sand" },
  { title: "Canapé bouclette 3 places", price: "420 €", city: "Paris 11e", meta: "Très bon état", tone: "sage" },
  { title: "MacBook Air M4 · 15 pouces", price: "1 199 €", city: "Nantes", meta: "Sous garantie", tone: "blue" },
  { title: "Vélo électrique Moustache", price: "1 690 €", city: "Annecy", meta: "1 200 km", tone: "mint" },
  { title: "Sony PlayStation 5 Slim", price: "399 €", city: "Lille", meta: "Excellent état", tone: "rose" },
] as const;

const categoryRows = [
  { title: "High-tech à la une", slug: "high-tech", items: listings.slice(0, 3) },
  { title: "Auto & mobilité", slug: "vehicules", items: [listings[1]!, listings[4]!, listings[0]!] },
  { title: "Maison & quotidien", slug: "maison-jardin", items: [listings[2]!, listings[5]!, listings[3]!] },
];

const trustItems = [
  { icon: "✓", title: "Paiement protégé", text: "Vos transactions restent sécurisées du paiement à la réception." },
  { icon: "⌁", title: "Vendeurs vérifiés", text: "Profils, boutiques et professionnels disposent de niveaux de vérification clairs." },
  { icon: "↗", title: "Livraison suivie", text: "Suivez votre colis et gardez toutes les étapes d'achat au même endroit." },
];

function ListingCard({ listing, index = 0, compact = false }: { listing: (typeof listings)[number]; index?: number; compact?: boolean }) {
  return <article className={`listing-card${compact ? " listing-card-compact" : ""}`}>
    <div className={`listing-visual listing-visual-${listing.tone}`}>
      <span className="visual-watermark">{index % 3 === 0 ? "PA" : index % 3 === 1 ? "PRO" : "NEW"}</span>
      <a className="favorite-button" href="/connexion?next=%2Fmon-compte%2Ffavoris" aria-label={`Ajouter ${listing.title} aux favoris`}>♡</a>
      {index % 4 === 1 && <span className="pro-badge">PRO</span>}
    </div>
    <div className="listing-content">
      <div className="listing-topline"><span>{listing.meta}</span><span>il y a {index + 1} h</span></div>
      <h3>{listing.title}</h3>
      <p className="listing-city">⌖ {listing.city}</p>
      <div className="listing-price-row"><strong>{listing.price}</strong>{index % 3 === 0 && <span className="protected-label">✓ Protégé</span>}</div>
    </div>
  </article>;
}

export default function HomePage() {
  return (
    <div id="top" className="page-shell">
      <SiteHeader />
      <main>
        <section className="hero-section">
          <div className="shell hero-layout">
            <div className="hero-copy">
              <div className="hero-kicker"><span className="status-dot" /> La marketplace française nouvelle génération</div>
              <h1>Tout ce que vous cherchez.<br /><span>Juste à côté.</span></h1>
              <p className="hero-lead">Achetez, vendez et découvrez des milliers d'annonces partout en France avec une expérience simple, rapide et sécurisée.</p>
              <form className="search-panel" role="search" action="/recherche" method="get">
                <label className="search-field search-field-main"><span className="field-icon" aria-hidden="true">⌕</span><span className="sr-only">Que recherchez-vous ?</span><input name="q" type="search" placeholder="Que recherchez-vous ?" /></label>
                <label className="search-field search-field-location"><span className="field-icon" aria-hidden="true">⌖</span><span className="sr-only">Localisation</span><input name="city" type="text" placeholder="Toute la France" /></label>
                <button className="button button-primary search-button" type="submit">Rechercher</button>
              </form>
              <div className="quick-links" aria-label="Recherches populaires"><span>Populaire :</span><a href="/recherche?q=iPhone">iPhone</a><a href="/recherche?q=Peugeot%203008">Peugeot 3008</a><a href="/recherche?q=Appartement">Appartement</a><a href="/recherche?q=V%C3%A9lo%20%C3%A9lectrique">Vélo électrique</a></div>
            </div>
            <div className="hero-showcase" aria-label="Aperçu de la plateforme">
              <div className="showcase-glow" />
              <article className="showcase-card showcase-main-card"><div className="showcase-photo phone-art"><span className="phone-camera camera-one" /><span className="phone-camera camera-two" /><span className="phone-camera camera-three" /><span className="phone-logo">●</span></div><div className="showcase-card-body"><div><span className="listing-badge">Achat sécurisé</span><h2>iPhone 16 Pro · 256 Go</h2><p>Lyon 2e · Comme neuf</p></div><strong>829 €</strong></div></article>
              <div className="floating-card floating-offer"><span className="floating-icon">€</span><div><small>Nouvelle offre</small><strong>780 €</strong></div><span className="success-pill">+12%</span></div>
              <div className="floating-card floating-trust"><span className="floating-icon verified">✓</span><div><small>Profil</small><strong>Vérifié</strong></div></div>
            </div>
          </div>
        </section>

        <section id="categories" className="section-block categories-section"><div className="shell"><div className="section-heading heading-row"><div><span className="section-eyebrow">Explorer</span><h2>Toutes les catégories</h2></div><a className="text-link" href="/recherche">Voir toutes les catégories <span aria-hidden="true">→</span></a></div><div className="category-grid">{categories.map((category) => <a className="category-card" href={`/categorie/${category.slug}`} key={category.label}><span className="category-icon" aria-hidden="true">{category.icon}</span><strong>{category.label}</strong><small>{category.count}</small></a>)}</div></div></section>

        <section id="annonces" className="section-block listings-section"><div className="shell"><div className="section-heading heading-row"><div><span className="section-eyebrow">Nouveautés</span><h2>Les dernières annonces</h2><p>Six nouvelles opportunités à découvrir dès maintenant.</p></div><a className="text-link" href="/recherche">Voir toutes les annonces <span aria-hidden="true">→</span></a></div><div className="listing-grid listing-grid-six">{listings.map((listing, index) => <ListingCard listing={listing} index={index} key={listing.title} />)}</div></div></section>

        <section className="category-feed-section"><div className="shell category-feed-stack">{categoryRows.map((row, rowIndex) => <section className="category-feed" key={row.title}><div className="category-feed-heading"><div><span className="section-eyebrow">Sélection</span><h2>{row.title}</h2></div><a className="text-link" href={`/categorie/${row.slug}`}>Tout voir →</a></div><div className="category-feed-grid">{row.items.map((item, itemIndex) => <ListingCard listing={item} index={rowIndex * 3 + itemIndex} compact key={`${row.title}-${item.title}`} />)}</div></section>)}</div></section>

        <section className="section-block trust-section"><div className="shell trust-panel"><div className="trust-intro"><span className="section-eyebrow light">La confiance intégrée</span><h2>Achetez et vendez<br />l'esprit tranquille.</h2><p>Petit Annonces réunit paiement, suivi et protection dans une expérience conçue pour réduire les mauvaises surprises.</p><a className="button button-light" href="/conformite">Découvrir notre protection</a></div><div className="trust-list">{trustItems.map((item) => <div className="trust-item" key={item.title}><span className="trust-icon" aria-hidden="true">{item.icon}</span><div><h3>{item.title}</h3><p>{item.text}</p></div></div>)}</div></div></section>

        <section id="boutiques" className="section-block pro-section"><div className="shell pro-panel"><div className="pro-copy"><span className="section-eyebrow">Pour les professionnels</span><h2>Votre boutique.<br />Votre vitrine.<br /><span>Votre croissance.</span></h2><p>Présentez votre activité, publiez vos annonces et pilotez vos ventes depuis un espace professionnel pensé pour le marché français.</p><div className="actions-row"><a className="button button-primary" href="/inscription/pro">Créer une boutique</a><a className="text-link" href="/promouvoir">Découvrir les offres →</a></div></div><div className="pro-mockup" aria-label="Aperçu d'une boutique professionnelle"><div className="browser-top"><span /><span /><span /><div>petitannonces.fr/boutique/atelier-lyon</div></div><div className="store-cover"><div className="store-avatar">AL</div><div><strong>Atelier Lyon</strong><small>Mobilier & décoration · Professionnel vérifié</small></div></div><div className="store-stats"><div><strong>142</strong><small>Annonces</small></div><div><strong>4,9/5</strong><small>Évaluation</small></div><div><strong>&lt; 1 h</strong><small>Réponse</small></div></div><div className="store-products"><span /><span /><span /></div></div></div></section>

        <section id="deposer" className="cta-section"><div className="shell cta-panel"><div><span className="section-eyebrow">C'est parti</span><h2>Vous avez quelque chose à vendre ?</h2><p>Publiez votre annonce en quelques minutes et trouvez le bon acheteur.</p></div><a className="button button-primary button-large" href="/deposer-une-annonce"><span className="button-plus">+</span> Déposer une annonce</a></div></section>
      </main>
      <SiteFooter />
    </div>
  );
}
