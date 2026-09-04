"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./listing-publication-review.module.css";

type PublicationCheck = {
  ready: boolean;
  errors: string[];
  warnings: string[];
  summary: {
    title: string | null;
    priceMinor: number | null;
    currency: string;
    category: { name: string; slug: string; domain: string };
    mediaCount: number;
    commerce: {
      securePaymentEnabled: boolean;
      handDeliveryEnabled: boolean;
      mondialRelayEnabled: boolean;
      colissimoEnabled: boolean;
    } | null;
  };
};

const labels: Record<string, string> = {
  title_required: "Ajoutez un titre d’au moins 5 caractères.",
  description_required: "Ajoutez une description suffisamment détaillée.",
  price_required: "Indiquez le prix de l’annonce.",
  vehicle_details_required: "Complétez les informations du véhicule.",
  property_details_required: "Complétez les informations du bien immobilier.",
  energy_performance_required: "Renseignez les informations DPE / GES.",
  dpe_number_required: "Ajoutez le numéro DPE.",
  valid_dpe_date_required: "Vérifiez la date du DPE.",
  energy_class_required: "Indiquez la classe énergie.",
  climate_class_required: "Indiquez la classe climat / GES.",
  annual_energy_cost_required: "Indiquez l’estimation des dépenses énergétiques.",
  energy_price_reference_years_required: "Indiquez les années de référence des prix de l’énergie.",
  dpe_exemption_reason_required: "Précisez le motif d’exemption DPE.",
  package_dimensions_required: "Complétez le poids et les dimensions du colis.",
  no_ready_photo: "Aucune photo n’est prête. Vous pouvez publier, mais une photo est fortement recommandée.",
  no_delivery_method: "Aucun mode de remise n’est sélectionné.",
  rental_dpe_g_requires_eligibility_review: "Ce logement classé G nécessite une vérification d’éligibilité avant location.",
};

function apiBase() {
  return (process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");
}

function readable(code: string) {
  if (code.startsWith("required_attribute:")) return `Complétez le champ obligatoire « ${code.split(":")[1]} ».`;
  return labels[code] ?? code.replaceAll("_", " ");
}

function formatPrice(value: number | null, currency: string) {
  if (value === null) return "Non renseigné";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(value / 100);
}

export function ListingPublicationReview({ listingId }: { listingId?: string }) {
  const [check, setCheck] = useState<PublicationCheck | null>(null);
  const [loading, setLoading] = useState(Boolean(listingId));
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState(listingId ? "" : "Créez d’abord le brouillon pour lancer la vérification complète.");
  const [terms, setTerms] = useState(false);
  const [rules, setRules] = useState(false);
  const [accuracy, setAccuracy] = useState(false);
  const [disclosure, setDisclosure] = useState(false);

  async function refresh() {
    if (!listingId) return;
    setLoading(true);
    try {
      const response = await fetch(`${apiBase()}/listings/${encodeURIComponent(listingId)}/publication-check`, { credentials: "include" });
      if (!response.ok) throw new Error(`publication_check_${response.status}`);
      const payload = await response.json() as PublicationCheck;
      setCheck(payload);
      setMessage(payload.ready ? "Votre annonce est prête à être envoyée en modération." : "Corrigez les points bloquants avant publication.");
    } catch {
      setMessage("La vérification n’a pas pu être chargée pour le moment.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [listingId]);

  const allConsents = terms && rules && accuracy && disclosure;
  const canPublish = Boolean(listingId && check?.ready && allConsents && !publishing);
  const deliveryLabel = useMemo(() => {
    const commerce = check?.summary.commerce;
    if (!commerce) return "Non configuré";
    const modes = [commerce.handDeliveryEnabled && "Remise en main propre", commerce.mondialRelayEnabled && "Mondial Relay", commerce.colissimoEnabled && "Colissimo"].filter(Boolean);
    return modes.length ? modes.join(" · ") : "Aucun mode";
  }, [check]);

  async function publish() {
    if (!listingId || !canPublish) return;
    setPublishing(true);
    setMessage("");
    try {
      const response = await fetch(`${apiBase()}/listings/${encodeURIComponent(listingId)}/publish`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ termsAccepted: true, rulesAccepted: true, accuracyConfirmed: true, professionalDisclosureConfirmed: true }),
      });
      const payload = await response.json() as { status?: string; errors?: string[]; listing?: { slug?: string | null } };
      if (!response.ok) {
        if (payload.errors?.length) setMessage(payload.errors.map(readable).join(" "));
        else setMessage("La publication a été refusée. Vérifiez l’annonce puis réessayez.");
        await refresh();
        return;
      }
      setMessage("Annonce envoyée en modération avec succès.");
      if (payload.listing?.slug) window.location.href = `/annonce/${payload.listing.slug}?submitted=1`;
    } catch {
      setMessage("Une erreur réseau empêche la publication pour le moment.");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className={styles.wrapper}>
      {loading && <div className={styles.loading}>Vérification de l’annonce…</div>}

      {check && (
        <>
          <div className={styles.summaryGrid}>
            <div><span>Annonce</span><strong>{check.summary.title ?? "Sans titre"}</strong></div>
            <div><span>Catégorie</span><strong>{check.summary.category.name}</strong></div>
            <div><span>Prix</span><strong>{formatPrice(check.summary.priceMinor, check.summary.currency)}</strong></div>
            <div><span>Photos</span><strong>{check.summary.mediaCount}</strong></div>
            <div className={styles.wide}><span>Remise</span><strong>{deliveryLabel}</strong></div>
            <div><span>Paiement sécurisé</span><strong>{check.summary.commerce?.securePaymentEnabled ? "Activé" : "Désactivé"}</strong></div>
          </div>

          <div className={styles.statusGrid}>
            <section className={`${styles.statusCard} ${check.errors.length ? styles.blocked : styles.ok}`}>
              <div className={styles.statusTitle}><span>{check.errors.length ? "!" : "✓"}</span><strong>{check.errors.length ? `${check.errors.length} point(s) à corriger` : "Aucun blocage"}</strong></div>
              {check.errors.length ? <ul>{check.errors.map((error) => <li key={error}>{readable(error)}</li>)}</ul> : <p>Les contrôles obligatoires sont validés.</p>}
            </section>

            <section className={`${styles.statusCard} ${styles.warning}`}>
              <div className={styles.statusTitle}><span>i</span><strong>{check.warnings.length ? `${check.warnings.length} recommandation(s)` : "Aucun avertissement"}</strong></div>
              {check.warnings.length ? <ul>{check.warnings.map((warning) => <li key={warning}>{readable(warning)}</li>)}</ul> : <p>Votre annonce ne présente pas d’avertissement particulier.</p>}
            </section>
          </div>
        </>
      )}

      <div className={styles.consentBox}>
        <h3>Dernières confirmations</h3>
        <label><input type="checkbox" checked={accuracy} onChange={(e) => setAccuracy(e.target.checked)} /><span>Je confirme que les informations, le prix et les photos décrivent fidèlement l’annonce.</span></label>
        <label><input type="checkbox" checked={rules} onChange={(e) => setRules(e.target.checked)} /><span>Je respecte les règles de diffusion et les produits ou services interdits de Petit Annonces.</span></label>
        <label><input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} /><span>J’accepte les Conditions Générales d’Utilisation et la politique applicable à la publication.</span></label>
        <label><input type="checkbox" checked={disclosure} onChange={(e) => setDisclosure(e.target.checked)} /><span>Je confirme que mon statut particulier ou professionnel est correctement déclaré.</span></label>
      </div>

      <div className={styles.footer}>
        <div><strong>{check?.ready ? "Prêt pour modération" : "Vérification nécessaire"}</strong><span>{message}</span></div>
        <div className={styles.buttons}>
          <button type="button" className={styles.secondary} onClick={() => void refresh()} disabled={!listingId || loading}>Revérifier</button>
          <button type="button" className={styles.primary} disabled={!canPublish} onClick={() => void publish()}>{publishing ? "Publication…" : "Publier mon annonce"}</button>
        </div>
      </div>
      <p className={styles.moderationNote}>Après envoi, l’annonce passe au statut <b>En modération</b>. Elle ne devient publique qu’après validation selon les règles de la plateforme.</p>
    </div>
  );
}
