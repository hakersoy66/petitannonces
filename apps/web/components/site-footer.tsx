const footerGroups = [
  {
    title: "Petit Annonces",
    links: [
      { label: "À propos", href: "/bienvenue" },
      { label: "Comment ça marche", href: "/bienvenue" },
      { label: "Sécurité", href: "/conformite" },
      { label: "Centre d'aide", href: "/signaler-contenu-illicite" },
    ],
  },
  {
    title: "Acheter & vendre",
    links: [
      { label: "Déposer une annonce", href: "/deposer-une-annonce" },
      { label: "Paiement sécurisé", href: "/conditions-generales" },
      { label: "Livraison", href: "/conditions-generales" },
      { label: "Boutiques pro", href: "/boutique" },
    ],
  },
  {
    title: "Informations",
    links: [
      { label: "Conditions", href: "/conditions-generales" },
      { label: "Confidentialité", href: "/confidentialite" },
      { label: "Cookies", href: "/cookies" },
      { label: "Accessibilité", href: "/conformite" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="shell footer-grid">
        <div className="footer-brand">
          <a className="brand brand-footer" href="/" aria-label="Petit Annonces, accueil">
            <span className="brand-mark" aria-hidden="true">pa</span>
            <span className="brand-copy"><strong>Petit Annonces</strong><small>France</small></span>
          </a>
          <p>Achetez, vendez et trouvez près de chez vous, simplement et en confiance.</p>
        </div>
        {footerGroups.map((group) => (
          <div key={group.title} className="footer-column">
            <h3>{group.title}</h3>
            {group.links.map((link) => <a key={link.label} href={link.href}>{link.label}</a>)}
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
