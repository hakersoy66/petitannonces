import type { Metadata } from "next";
import { SiteHeader } from "../../../components/site-header";
import styles from "./page.module.css";

type Props = { params: Promise<{ slug: string }> };

function titleFromSlug(slug: string) {
  return decodeURIComponent(slug).replace(/-\d+$/, "").replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const title = titleFromSlug(slug);
  return {
    title: `${title} | Petit Annonces`,
    description: `Consultez cette annonce ${title} sur Petit Annonces.`,
    alternates: { canonical: `/annonce/${slug}` },
  };
}

const specs = [
  ["État", "Très bon état"],
  ["Marque", "Apple"],
  ["Modèle", "iPhone 15 Pro"],
  ["Stockage", "256 Go"],
  ["Couleur", "Titane naturel"],
  ["Garantie", "Oui"],
];

const related = [
  ["iPhone 15 Pro 128 Go", "749 €"],
  ["Samsung Galaxy S25", "699 €"],
  ["iPhone 14 Pro Max", "679 €"],
];

export default async function ListingPage({ params }: Props) {
  const { slug } = await params;
  const title = titleFromSlug(slug);

  return (
    <div className={styles.page}>
      <SiteHeader />
      <main className={styles.shell}>
        <nav className={styles.breadcrumb} aria-label="Fil d’Ariane">Accueil › High-tech › Téléphones › {title}</nav>

        <div className={styles.layout}>
          <section className={styles.main}>
            <div className={styles.gallery}>
              <div className={styles.heroImage}>Photo principale<span className={styles.photoBadge}>1 / 8 photos</span></div>
              <div className={styles.thumbs}>
                <div className={styles.thumb}>Photo 2</div>
                <div className={styles.thumb}>Photo 3</div>
                <div className={styles.thumb}>+5</div>
              </div>
            </div>

            <div className={styles.topline}>
              <div className={styles.titleBlock}>
                <h1>{title}</h1>
                <div className={styles.meta}>
                  <span>📍 Saint-Étienne (42000)</span>
                  <span>🕒 Publiée aujourd’hui</span>
                  <span>👁 128 vues</span>
                </div>
              </div>
              <div className={styles.actions}>
                <button className={styles.iconBtn} type="button" aria-label="Ajouter aux favoris">♡</button>
                <button className={styles.iconBtn} type="button" aria-label="Partager">↗</button>
              </div>
            </div>

            <section className={styles.card}>
              <h2>Caractéristiques</h2>
              <div className={styles.specGrid}>
                {specs.map(([label, value]) => (
                  <div className={styles.spec} key={label}><small>{label}</small><strong>{value}</strong></div>
                ))}
              </div>
            </section>

            <section className={styles.card}>
              <h2>Description</h2>
              <p className={styles.description}>iPhone en excellent état, toujours protégé par coque et verre trempé. Batterie en très bon état. Vendu avec boîte d’origine et câble.\n\nRemise en main propre possible à Saint-Étienne ou expédition via la livraison sécurisée Petit Annonces.</p>
            </section>

            <section className={styles.card}>
              <h2>Livraison & paiement</h2>
              <div className={styles.safety}><span>🛡️</span><div><strong>Paiement sécurisé Petit Annonces</strong><br />Votre paiement est protégé jusqu’à la bonne réception de l’article lorsque la transaction sécurisée est utilisée.</div></div>
              <div className={styles.deliveryRows}>
                <div className={styles.deliveryRow}><span>Remise en main propre</span><strong>Disponible</strong></div>
                <div className={styles.deliveryRow}><span>Mondial Relay</span><strong>À partir de 4,49 €</strong></div>
                <div className={styles.deliveryRow}><span>Colissimo</span><strong>À partir de 6,99 €</strong></div>
              </div>
            </section>

            <section className={styles.card}>
              <h2>Localisation</h2>
              <div className={styles.locationBox}>Zone approximative · Saint-Étienne</div>
            </section>

            <section className={styles.card}>
              <h2>À propos du vendeur</h2>
              <div className={styles.sellerMini}>
                <div className={styles.avatar}>HE</div>
                <div><strong>Hakan E.</strong><div className={styles.meta}><span>⭐ 4,9/5</span><span>Membre depuis 2025</span><span>Identité vérifiée</span></div></div>
              </div>
            </section>

            <section>
              <h2>Vous pourriez aussi aimer</h2>
              <div className={styles.related}>
                {related.map(([name, price]) => (
                  <article className={styles.relatedCard} key={name}>
                    <div className={styles.relatedImage} />
                    <div className={styles.relatedBody}><strong>{name}</strong><span>{price}</span></div>
                  </article>
                ))}
              </div>
            </section>
          </section>

          <aside className={styles.sidebar}>
            <div className={styles.priceCard}>
              <div className={styles.priceLabel}>Prix</div>
              <div className={styles.price}>799 €</div>
              <button className={styles.primary} type="button">Acheter en toute sécurité</button>
              <button className={styles.secondary} type="button">Contacter le vendeur</button>
              <button className={styles.ghost} type="button">Faire une offre</button>
              <div className={styles.secure}>🔒 Paiement protégé, suivi de commande et assistance en cas de problème lorsque la transaction Petit Annonces est disponible.</div>
            </div>

            <div className={styles.sellerCard}>
              <div className={styles.sellerHead}><div className={styles.avatar}>HE</div><div><strong>Hakan E.</strong><div className={styles.meta}><span>⭐ 4,9</span><span>Vérifié</span></div></div></div>
              <div className={styles.sellerStats}>
                <div><b>24</b><small>annonces</small></div>
                <div><b>18</b><small>ventes</small></div>
                <div><b>&lt; 1h</b><small>réponse</small></div>
              </div>
              <button className={styles.ghost} type="button">Voir le profil vendeur</button>
            </div>
          </aside>
        </div>
      </main>

      <div className={styles.mobileBar}>
        <div className={styles.mobileBarInner}><div><small>Prix</small><strong>799 €</strong></div><button type="button">Contacter</button></div>
      </div>
    </div>
  );
}
