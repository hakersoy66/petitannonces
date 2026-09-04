import type { Metadata } from "next";
import { CatalogBrowser } from "../../components/catalog-browser";
import { ListingCommerceForm } from "../../components/listing-commerce-form";
import { ListingPhotoUploader } from "../../components/listing-photo-uploader";
import { SiteHeader } from "../../components/site-header";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Déposer une annonce | Petit Annonces",
  description: "Créez une annonce sur Petit Annonces avec des formulaires adaptés à chaque catégorie en France.",
};

const steps = ["Catégorie", "Détails", "Photos", "Prix & livraison", "Vérification"];

type Props = { searchParams: Promise<{ listingId?: string }> };

export default async function CreateListingPage({ searchParams }: Props) {
  const { listingId } = await searchParams;
  return (
    <div className={styles.page}>
      <SiteHeader />
      <main className={styles.main}>
        <div className={styles.shell}>
          <div className={styles.heading}>
            <p className={styles.eyebrow}>Nouvelle annonce</p>
            <h1>Choisissez la bonne catégorie, le formulaire fait le reste.</h1>
            <p>Petit Annonces adapte automatiquement les champs, contrôles, photos, prix et options de remise à la catégorie choisie.</p>
          </div>

          <ol className={styles.steps} aria-label="Étapes de création de l'annonce">
            {steps.map((step, index) => (
              <li key={step} className={index <= 3 ? styles.activeStep : undefined}>
                <span>{index + 1}</span>
                {step}
              </li>
            ))}
          </ol>

          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <p className={styles.stepLabel}>Étape 1 · Catégorie & détails</p>
                <h2>Que souhaitez-vous vendre ou proposer ?</h2>
              </div>
              <span className={styles.saved}>Brouillon enregistré</span>
            </div>
            <CatalogBrowser />
          </section>

          <section className={`${styles.card} ${styles.photoSection}`}>
            <div className={styles.cardHeader}>
              <div>
                <p className={styles.stepLabel}>Étape 3 · Photos</p>
                <h2>Des photos nettes donnent plus de confiance.</h2>
                <p className={styles.cardIntro}>Ajoutez, réordonnez et choisissez la photo de couverture. Sur mobile, vous pouvez prendre une photo directement avec l’appareil photo.</p>
              </div>
              <span className={styles.photoTip}>20 photos max</span>
            </div>
            <ListingPhotoUploader listingId={listingId} />
          </section>

          <section className={`${styles.card} ${styles.commerceSection}`}>
            <div className={styles.cardHeader}>
              <div>
                <p className={styles.stepLabel}>Étape 4 · Prix & livraison</p>
                <h2>Définissez le prix et les modes de remise.</h2>
                <p className={styles.cardIntro}>Les options d’expédition sont automatiquement désactivées pour les catégories comme l’immobilier, les véhicules, les emplois et les services.</p>
              </div>
              <span className={styles.photoTip}>Paiement & remise</span>
            </div>
            <ListingCommerceForm listingId={listingId} />
          </section>

          <div className={styles.specialGrid}>
            <section className={`${styles.specialCard} ${styles.vehicleCard}`}>
              <div className={styles.icon}>FR</div>
              <div>
                <p className={styles.stepLabel}>Véhicules</p>
                <h2>Ajoutez votre plaque, on pré-remplit le véhicule.</h2>
                <p>Marque, modèle, mise en circulation, énergie, puissance et informations techniques peuvent être récupérés via le fournisseur agréé configuré.</p>
                <div className={styles.inlineForm}>
                  <input aria-label="Plaque d'immatriculation" placeholder="AB-123-CD" />
                  <button type="button">Identifier le véhicule</button>
                </div>
                <small className={styles.privacy}>La plaque complète n’est pas affichée dans l’annonce.</small>
              </div>
            </section>

            <section className={`${styles.specialCard} ${styles.energyCard}`}>
              <div className={styles.energyBadge}>DPE</div>
              <div>
                <p className={styles.stepLabel}>Immobilier en France</p>
                <h2>DPE et GES intégrés au formulaire.</h2>
                <p>Les informations énergétiques et les attributs du bien sont demandés dans le même parcours.</p>
                <div className={styles.energyRows}>
                  <span><b>Classe énergie</b><i>A → G</i></span>
                  <span><b>Classe climat / GES</b><i>A → G</i></span>
                  <span><b>Dépenses annuelles estimées</b><i>Min / Max €</i></span>
                  <span><b>Année(s) de référence</b><i>Contrôlé</i></span>
                </div>
              </div>
            </section>
          </div>

          <div className={styles.actions}>
            <a href="/" className={styles.secondaryButton}>Annuler</a>
            <button type="button" className={styles.primaryButton}>Continuer vers vérification</button>
          </div>
        </div>
      </main>
    </div>
  );
}
