import type { Metadata } from "next";
import { ListingWizard } from "../../components/listing-wizard";
import { SiteHeader } from "../../components/site-header";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Déposer une annonce | Petit Annonces",
  description: "Créez une annonce étape par étape sur Petit Annonces.",
};

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
            <h1>Publiez votre annonce étape par étape.</h1>
            <p>Choisissez une catégorie, décrivez votre annonce, ajoutez vos photos, configurez le prix puis vérifiez avant envoi en modération.</p>
          </div>
          <ListingWizard initialListingId={listingId} />
        </div>
      </main>
    </div>
  );
}
