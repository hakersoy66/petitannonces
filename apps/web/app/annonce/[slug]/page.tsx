import type { Metadata } from "next";
import { SiteHeader } from "../../../components/site-header";
import { getListingDetailPreset } from "../../../lib/listing-detail-presets";
import styles from "./page.module.css";

type Props = { params: Promise<{ slug: string }> };

function titleFromSlug(slug: string) {
  return decodeURIComponent(slug).replace(/-\d+$/, "").replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const title = titleFromSlug(slug);
  const preset = getListingDetailPreset(slug);
  return {
    title: `${title} | Petit Annonces`,
    description: `${title} — ${preset.location}. Consultez cette annonce sur Petit Annonces.`,
    alternates: { canonical: `/annonce/${slug}` },
  };
}

const related = [
  ["Annonce similaire", "12 490 €"],
  ["Sélection proche", "13 490 €"],
  ["Autre annonce", "14 900 €"],
];

export default async function ListingPage({ params }: Props) {
  const { slug } = await params;
  const title = titleFromSlug(slug);
  const preset = getListingDetailPreset(slug);
  const isVehicle = preset.variant === "VEHICLE";
  const isProperty = preset.variant === "REAL_ESTATE";

  return (
    <div className={styles.page}>
      <SiteHeader />
      <main className={styles.shell}>
        <nav className={styles.breadcrumb} aria-label="Fil d’Ariane">
          Accueil › {preset.breadcrumb.join(" › ")} › {title}
        </nav>

        <div className={styles.layout}>
          <section className={styles.main}>
            <div className={styles.gallery}>
              <div className={styles.heroImage}>
                Photo principale
                <span className={styles.photoBadge}>1 / {isProperty ? 12 : isVehicle ? 18 : 8} photos</span>
              </div>
              <div className={styles.thumbs}>
                <div className={styles.thumb}>Photo 2</div>
                <div className={styles.thumb}>Photo 3</div>
                <div className={styles.thumb}>+{isProperty ? 9 : isVehicle ? 15 : 5}</div>
              </div>
            </div>

            <div className={styles.topline}>
              <div className={styles.titleBlock}>
                <h1>{title}</h1>
                <div className={styles.meta}>
                  <span>📍 {preset.location}</span>
                  {preset.meta.map((item) => <span key={item}>{item}</span>)}
                </div>
              </div>
              <div className={styles.actions}>
                <button className={styles.iconBtn} type="button" aria-label="Ajouter aux favoris">♡</button>
                <button className={styles.iconBtn} type="button" aria-label="Partager">↗</button>
              </div>
            </div>

            <section className={styles.card}>
              <h2>{isVehicle ? "Caractéristiques du véhicule" : isProperty ? "Caractéristiques du bien" : "Caractéristiques"}</h2>
              <div className={styles.specGrid}>
                {preset.specs.map((spec) => (
                  <div className={styles.spec} key={spec.label}><small>{spec.label}</small><strong>{spec.value}</strong></div>
                ))}
              </div>
            </section>

            {preset.extraSection && (
              <section className={styles.card}>
                <h2>{preset.extraSection.title}</h2>
                <div className={styles.deliveryRows}>
                  {preset.extraSection.items.map((item) => (
                    <div className={styles.deliveryRow} key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>
                  ))}
                </div>
              </section>
            )}

            <section className={styles.card}>
              <h2>Description</h2>
              <p className={styles.description}>{preset.description}</p>
            </section>

            <section className={styles.card}>
              <h2>{isVehicle ? "Confiance & documents" : isProperty ? "Diagnostics & transparence" : "Livraison & paiement"}</h2>
              <div className={styles.safety}>
                <span>🛡️</span>
                <div><strong>{preset.trustTitle}</strong><br />{preset.trustText}</div>
              </div>
              {!isVehicle && !isProperty && (
                <div className={styles.deliveryRows}>
                  <div className={styles.deliveryRow}><span>Remise en main propre</span><strong>Disponible</strong></div>
                  <div className={styles.deliveryRow}><span>Mondial Relay</span><strong>À partir de 4,49 €</strong></div>
                  <div className={styles.deliveryRow}><span>Colissimo</span><strong>À partir de 6,99 €</strong></div>
                </div>
              )}
              {isVehicle && (
                <div className={styles.deliveryRows}>
                  <div className={styles.deliveryRow}><span>Carte grise</span><strong>À vérifier avec le vendeur</strong></div>
                  <div className={styles.deliveryRow}><span>Contrôle technique</span><strong>Document disponible si applicable</strong></div>
                  <div className={styles.deliveryRow}><span>Historique d’entretien</span><strong>Sur demande</strong></div>
                </div>
              )}
              {isProperty && (
                <div className={styles.deliveryRows}>
                  <div className={styles.deliveryRow}><span>DPE / GES</span><strong>Affichés ci-dessus</strong></div>
                  <div className={styles.deliveryRow}><span>Visite</span><strong>Sur rendez-vous</strong></div>
                  <div className={styles.deliveryRow}><span>Annonceur</span><strong>{preset.seller}</strong></div>
                </div>
              )}
            </section>

            <section className={styles.card}>
              <h2>Localisation</h2>
              <div className={styles.locationBox}>Zone approximative · {preset.location}</div>
            </section>

            <section className={styles.card}>
              <h2>À propos de l’annonceur</h2>
              <div className={styles.sellerMini}>
                <div className={styles.avatar}>{preset.seller.split(" ").map((item) => item[0]).join("").slice(0, 2)}</div>
                <div><strong>{preset.seller}</strong><div className={styles.meta}><span>⭐ 4,9/5</span><span>Membre vérifié</span><span>Réponse rapide</span></div></div>
              </div>
            </section>

            <section>
              <h2>{isProperty ? "Biens similaires" : isVehicle ? "Véhicules similaires" : "Vous pourriez aussi aimer"}</h2>
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
              <div className={styles.priceLabel}>{isProperty ? "Prix de vente" : "Prix"}</div>
              <div className={styles.price}>{preset.price}</div>
              <button className={styles.primary} type="button">{preset.primaryCta}</button>
              <button className={styles.secondary} type="button">{preset.secondaryCta}</button>
              {preset.tertiaryCta && <button className={styles.ghost} type="button">{preset.tertiaryCta}</button>}
              <div className={styles.secure}>{isVehicle ? "🚘 Échangez avec le vendeur, vérifiez les documents et organisez l’essai avant la transaction." : isProperty ? "🏠 Contactez l’annonceur et vérifiez les diagnostics et informations du bien avant engagement." : "🔒 Paiement protégé, suivi de commande et assistance lorsque la transaction Petit Annonces est disponible."}</div>
            </div>

            <div className={styles.sellerCard}>
              <div className={styles.sellerHead}><div className={styles.avatar}>{preset.seller.split(" ").map((item) => item[0]).join("").slice(0, 2)}</div><div><strong>{preset.seller}</strong><div className={styles.meta}><span>⭐ 4,9</span><span>Vérifié</span></div></div></div>
              <div className={styles.sellerStats}>
                <div><b>24</b><small>annonces</small></div>
                <div><b>18</b><small>{isProperty ? "biens" : "ventes"}</small></div>
                <div><b>&lt; 1h</b><small>réponse</small></div>
              </div>
              <button className={styles.ghost} type="button">Voir le profil</button>
            </div>
          </aside>
        </div>
      </main>

      <div className={styles.mobileBar}>
        <div className={styles.mobileBarInner}><div><small>{isProperty ? "Prix de vente" : "Prix"}</small><strong>{preset.price}</strong></div><button type="button">{isProperty ? "Contacter" : isVehicle ? "Message" : "Acheter"}</button></div>
      </div>
    </div>
  );
}
