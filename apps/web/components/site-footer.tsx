const footerGroups = [
  {
    title: "Petit Annonces",
    links: ["À propos", "Comment ça marche", "Sécurité", "Centre d'aide"],
  },
  {
    title: "Acheter & vendre",
    links: ["Déposer une annonce", "Paiement sécurisé", "Livraison", "Boutiques pro"],
  },
  {
    title: "Informations",
    links: ["Conditions", "Confidentialité", "Cookies", "Accessibilité"],
  },
];

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="shell footer-grid">
        <div className="footer-brand">
          <a className="brand brand-footer" href="#top" aria-label="Petit Annonces, accueil">
            <span className="brand-mark" aria-hidden="true">pa</span>
            <span className="brand-copy"><strong>Petit Annonces</strong><small>France</small></span>
          </a>
          <p>Achetez, vendez et trouvez près de chez vous, simplement et en confiance.</p>
        </div>
        {footerGroups.map((group) => (
          <div key={group.title} className="footer-column">
            <h3>{group.title}</h3>
            {group.links.map((link) => <a key={link} href="#">{link}</a>)}
          </div>
        ))}
      </div>
      <div className="shell footer-bottom">
        <span>© 2026 Petit Annonces</span>
        <span>Marketplace pensée pour la France 🇫🇷</span>
      </div>
    </footer>
  );
}
