import type { Metadata } from "next";
import { SiteHeader } from "../../components/site-header";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Déposer une annonce | Petit Annonces",
  description: "Créez une annonce sur Petit Annonces avec des formulaires adaptés aux véhicules, à l'immobilier et aux autres catégories.",
};

const steps = ["Catégorie", "Détails", "Photos", "Prix & livraison", "Vérification"];

export default function CreateListingPage() {
  return (
    <div className={styles.page}>
      <SiteHeader />
      <main className={styles.main}>
        <div className={styles.shell}>
          <div className={styles.heading}>
            <p className={styles.eyebrow}>Nouvelle annonce</p>
            <h1>Vendez simplement, avec les bons détails dès le départ.</h1>
            <p>Le formulaire s’adapte automatiquement à la catégorie choisie et vérifie les informations nécessaires avant publication.</p>
          </div>

          <ol className={styles.steps} aria-label="Étapes de création de l'annonce">
            {steps.map((step, index) => (
              <li key={step} className={index === 0 ? styles.activeStep : undefined}>
                <span>{index + 1}</span>
                {step}
              </li>
            ))}
          </ol>

          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <p className={styles.stepLabel}>Étape 1 sur 5</p>
                <h2>Que souhaitez-vous vendre ou proposer ?</h2>
              </div>
              <span className={styles.saved}>Brouillon enregistré</span>
            </div>

            <div className={styles.categoryGrid}>
              <button type="button" className={`${styles.category} ${styles.selected}`}>
                <span>🚗</span><strong>Véhicules</strong><small>Voitures, motos, utilitaires</small>
              </button>
              <button type="button" className={styles.category}>
                <span>🏠</span><strong>Immobilier</strong><small>Vente et location</small>
              </button>
              <button type="button" className={styles.category}>
                <span>💻</span><strong>High-tech</strong><small>Téléphones, informatique</small>
              </button>
              <button type="button" className={styles.category}>
                <span>🛋️</span><strong>Maison & Jardin</strong><small>Meubles et équipement</small>
              </button>
            </div>
          </section>

          <div className={styles.specialGrid}>
            <section className={`${styles.specialCard} ${styles.vehicleCard}`}>
              <div className={styles.icon}>FR</div>
              <div>
                <p className={styles.stepLabel}>Véhicules</p>
                <h2>Ajoutez votre plaque, on pré-remplit le véhicule.</h2>
                <p>Marque, modèle, date de première immatriculation, énergie, puissance, CO₂ et autres données techniques peuvent être récupérés auprès du fournisseur agréé configuré.</p>
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
                <p>Les annonces immobilières demandent les informations énergétiques nécessaires avant envoi en modération.</p>
                <div className={styles.energyRows}>
                  <span><b>Classe énergie</b><i>A → G</i></span>
                  <span><b>Classe climat / GES</b><i>A → G</i></span>
                  <span><b>Dépenses annuelles estimées</b><i>Min / Max €</i></span>
                  <span><b>Année(s) de référence</b><i>Obligatoire</i></span>
                </div>
              </div>
            </section>
          </div>

          <div className={styles.actions}>
            <a href="/" className={styles.secondaryButton}>Annuler</a>
            <button type="button" className={styles.primaryButton}>Continuer</button>
          </div>
        </div>
      </main>
    </div>
  );
}
