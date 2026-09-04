const navItems = [
  { label: "Acheter", href: "/#annonces" },
  { label: "Catégories", href: "/#categories" },
  { label: "Boutiques", href: "/#boutiques" },
];

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="shell header-inner">
        <a className="brand" href="/" aria-label="Petit Annonces, accueil">
          <span className="brand-mark" aria-hidden="true">pa</span>
          <span className="brand-copy">
            <strong>Petit Annonces</strong>
            <small>France</small>
          </span>
        </a>

        <nav className="desktop-nav" aria-label="Navigation principale">
          {navItems.map((item) => (
            <a key={item.label} href={item.href}>{item.label}</a>
          ))}
        </nav>

        <div className="header-actions">
          <a className="icon-action" href="/#favoris" aria-label="Mes favoris">♡</a>
          <a className="account-link" href="/connexion">Connexion</a>
          <a className="button button-primary button-compact" href="/deposer-une-annonce">
            <span className="button-plus" aria-hidden="true">+</span>
            Déposer une annonce
          </a>
        </div>
      </div>
    </header>
  );
}
