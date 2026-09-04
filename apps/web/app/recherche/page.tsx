import { CatalogFilterPanel } from "../../components/catalog-filter-panel";
import { SiteHeader } from "../../components/site-header";
import styles from "./page.module.css";

const mockResults = [
  { title: "Peugeot 3008 Allure", price: "18 900 €", meta: "2021 · 63 000 km · Diesel", city: "Saint-Étienne" },
  { title: "iPhone 15 Pro 256 Go", price: "799 €", meta: "Très bon état · Garantie", city: "Lyon" },
  { title: "Appartement T3 avec balcon", price: "189 000 €", meta: "67 m² · DPE C · 3 pièces", city: "Saint-Chamond" },
];

export default function SearchPage() {
  return (
    <div className={styles.page}>
      <SiteHeader />
      <main className={styles.shell}>
        <header className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>Explorer Petit Annonces</p>
            <h1>Trouvez exactement ce que vous cherchez.</h1>
            <p>Les filtres se réorganisent automatiquement selon la catégorie sélectionnée.</p>
          </div>
          <form action="/recherche" method="get" className={styles.searchbar}>
            <input name="q" placeholder="Que recherchez-vous ?" aria-label="Recherche" />
            <input name="city" placeholder="Ville ou code postal" aria-label="Ville" />
            <button type="submit">Rechercher</button>
          </form>
        </header>

        <div className={styles.layout}>
          <CatalogFilterPanel />
          <section className={styles.results}>
            <div className={styles.toolbar}>
              <div><b>1 248 annonces</b><span> autour de votre recherche</span></div>
              <select aria-label="Trier"><option>Plus récentes</option><option>Prix croissant</option><option>Prix décroissant</option><option>Plus proches</option></select>
            </div>

            <div className={styles.suggestions}>
              <span>Suggestions</span><button>Livraison disponible</button><button>Professionnels</button><button>Urgent</button><button>Avec photos</button>
            </div>

            <div className={styles.grid}>
              {mockResults.map((item, index) => (
                <article className={styles.card} key={item.title}>
                  <div className={styles.image}><span>{index === 0 ? "🚗" : index === 1 ? "📱" : "🏠"}</span><button aria-label="Ajouter aux favoris">♡</button></div>
                  <div className={styles.cardBody}>
                    <div className={styles.cardTop}><h2>{item.title}</h2>{index === 0 && <em>À la une</em>}</div>
                    <strong>{item.price}</strong>
                    <p>{item.meta}</p>
                    <footer><span>{item.city}</span><small>Il y a 2 h</small></footer>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
