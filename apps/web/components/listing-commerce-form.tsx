"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import styles from "./listing-commerce-form.module.css";

type Domain = "GENERAL" | "VEHICLE" | "REAL_ESTATE" | "JOB" | "SERVICE" | "ANIMAL";

type CommerceState = {
  priceEuros: string;
  acceptsOffers: boolean;
  securePaymentEnabled: boolean;
  handDeliveryEnabled: boolean;
  mondialRelayEnabled: boolean;
  colissimoEnabled: boolean;
  packageWeightG: string;
  packageLengthCm: string;
  packageWidthCm: string;
  packageHeightCm: string;
};

const initialState: CommerceState = {
  priceEuros: "",
  acceptsOffers: true,
  securePaymentEnabled: true,
  handDeliveryEnabled: true,
  mondialRelayEnabled: false,
  colissimoEnabled: false,
  packageWeightG: "",
  packageLengthCm: "",
  packageWidthCm: "",
  packageHeightCm: "",
};

function apiBase() {
  return (process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");
}

function nullableInt(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function ListingCommerceForm({ listingId }: { listingId?: string }) {
  const [form, setForm] = useState<CommerceState>(initialState);
  const [domain, setDomain] = useState<Domain>("GENERAL");
  const [status, setStatus] = useState(listingId ? "Chargement…" : "Les réglages seront enregistrés dès que le brouillon sera créé.");
  const [saving, setSaving] = useState(false);

  const shippable = !["VEHICLE", "REAL_ESTATE", "JOB", "SERVICE"].includes(domain);
  const shippingSelected = form.mondialRelayEnabled || form.colissimoEnabled;
  const priceMinor = useMemo(() => {
    const normalized = form.priceEuros.replace(",", ".").trim();
    const amount = Number(normalized);
    return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null;
  }, [form.priceEuros]);

  useEffect(() => {
    if (!listingId) return;
    let cancelled = false;
    fetch(`${apiBase()}/listings/${encodeURIComponent(listingId)}/commerce-settings`, { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`commerce_${response.status}`);
        return response.json() as Promise<{
          listing: { priceMinor: number | null; domain: Domain };
          settings: Omit<CommerceState, "priceEuros" | "packageWeightG" | "packageLengthCm" | "packageWidthCm" | "packageHeightCm"> & {
            packageWeightG: number | null;
            packageLengthCm: number | null;
            packageWidthCm: number | null;
            packageHeightCm: number | null;
          };
        }>;
      })
      .then((payload) => {
        if (cancelled) return;
        setDomain(payload.listing.domain);
        setForm({
          priceEuros: payload.listing.priceMinor == null ? "" : (payload.listing.priceMinor / 100).toFixed(payload.listing.priceMinor % 100 === 0 ? 0 : 2),
          acceptsOffers: payload.settings.acceptsOffers,
          securePaymentEnabled: payload.settings.securePaymentEnabled,
          handDeliveryEnabled: payload.settings.handDeliveryEnabled,
          mondialRelayEnabled: payload.settings.mondialRelayEnabled,
          colissimoEnabled: payload.settings.colissimoEnabled,
          packageWeightG: payload.settings.packageWeightG?.toString() ?? "",
          packageLengthCm: payload.settings.packageLengthCm?.toString() ?? "",
          packageWidthCm: payload.settings.packageWidthCm?.toString() ?? "",
          packageHeightCm: payload.settings.packageHeightCm?.toString() ?? "",
        });
        setStatus("Réglages chargés.");
      })
      .catch(() => { if (!cancelled) setStatus("Impossible de charger les réglages pour le moment."); });
    return () => { cancelled = true; };
  }, [listingId]);

  function toggle(key: keyof CommerceState) {
    setForm((current) => ({ ...current, [key]: !current[key] }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (priceMinor == null) {
      setStatus("Indiquez un prix valide.");
      return;
    }
    if (shippingSelected && [form.packageWeightG, form.packageLengthCm, form.packageWidthCm, form.packageHeightCm].some((value) => !nullableInt(value))) {
      setStatus("Poids et dimensions sont requis pour l’envoi.");
      return;
    }
    if (!listingId) {
      setStatus("Réglages prêts. Ils seront enregistrés après création du brouillon.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`${apiBase()}/listings/${encodeURIComponent(listingId)}/commerce-settings`, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          priceMinor,
          acceptsOffers: form.acceptsOffers,
          securePaymentEnabled: form.securePaymentEnabled,
          handDeliveryEnabled: form.handDeliveryEnabled,
          mondialRelayEnabled: shippable ? form.mondialRelayEnabled : false,
          colissimoEnabled: shippable ? form.colissimoEnabled : false,
          packageWeightG: shippable ? nullableInt(form.packageWeightG) : null,
          packageLengthCm: shippable ? nullableInt(form.packageLengthCm) : null,
          packageWidthCm: shippable ? nullableInt(form.packageWidthCm) : null,
          packageHeightCm: shippable ? nullableInt(form.packageHeightCm) : null,
        }),
      });
      if (!response.ok) throw new Error(`commerce_${response.status}`);
      setStatus("Prix et livraison enregistrés.");
    } catch {
      setStatus("Impossible d’enregistrer ces réglages. Vérifiez les champs puis réessayez.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.pricePanel}>
        <label>
          <span>Prix de l’annonce</span>
          <div className={styles.priceInput}><input inputMode="decimal" value={form.priceEuros} onChange={(event) => setForm((current) => ({ ...current, priceEuros: event.target.value }))} placeholder="120" /><b>€</b></div>
        </label>
        <label className={styles.switchRow}>
          <input type="checkbox" checked={form.acceptsOffers} onChange={() => toggle("acceptsOffers")} />
          <span><b>Accepter les offres</b><small>Les acheteurs pourront proposer un autre prix.</small></span>
        </label>
        <label className={styles.switchRow}>
          <input type="checkbox" checked={form.securePaymentEnabled} onChange={() => toggle("securePaymentEnabled")} />
          <span><b>Paiement sécurisé Petit Annonces</b><small>À activer lorsque la catégorie et le moyen de remise sont éligibles.</small></span>
        </label>
      </div>

      <div className={styles.deliveryPanel}>
        <div className={styles.sectionTitle}><div><span>Remise & livraison</span><h3>Comment l’acheteur récupère-t-il l’article ?</h3></div><small>{shippable ? "Plusieurs choix possibles" : "Remise adaptée à la catégorie"}</small></div>

        <div className={styles.methods}>
          <label className={`${styles.method} ${form.handDeliveryEnabled ? styles.selected : ""}`}>
            <input type="checkbox" checked={form.handDeliveryEnabled} onChange={() => toggle("handDeliveryEnabled")} />
            <span className={styles.methodIcon}>🤝</span><span><b>Remise en main propre</b><small>Vous convenez du lieu avec l’acheteur.</small></span>
          </label>
          {shippable && <label className={`${styles.method} ${form.mondialRelayEnabled ? styles.selected : ""}`}>
            <input type="checkbox" checked={form.mondialRelayEnabled} onChange={() => toggle("mondialRelayEnabled")} />
            <span className={styles.methodIcon}>📦</span><span><b>Mondial Relay</b><small>Livraison en Point Relais lorsque le transporteur est configuré.</small></span>
          </label>}
          {shippable && <label className={`${styles.method} ${form.colissimoEnabled ? styles.selected : ""}`}>
            <input type="checkbox" checked={form.colissimoEnabled} onChange={() => toggle("colissimoEnabled")} />
            <span className={styles.methodIcon}>🚚</span><span><b>Colissimo</b><small>Livraison suivie lorsque l’intégration transporteur est active.</small></span>
          </label>}
        </div>

        {shippable && shippingSelected && <div className={styles.packageBox}>
          <div><b>Dimensions du colis</b><p>Ces informations serviront au calcul et à la validation du transport.</p></div>
          <div className={styles.packageGrid}>
            <label><span>Poids</span><div><input type="number" min="1" max="30000" value={form.packageWeightG} onChange={(event) => setForm((current) => ({ ...current, packageWeightG: event.target.value }))} /><i>g</i></div></label>
            <label><span>Longueur</span><div><input type="number" min="1" max="200" value={form.packageLengthCm} onChange={(event) => setForm((current) => ({ ...current, packageLengthCm: event.target.value }))} /><i>cm</i></div></label>
            <label><span>Largeur</span><div><input type="number" min="1" max="200" value={form.packageWidthCm} onChange={(event) => setForm((current) => ({ ...current, packageWidthCm: event.target.value }))} /><i>cm</i></div></label>
            <label><span>Hauteur</span><div><input type="number" min="1" max="200" value={form.packageHeightCm} onChange={(event) => setForm((current) => ({ ...current, packageHeightCm: event.target.value }))} /><i>cm</i></div></label>
          </div>
        </div>}
      </div>

      <div className={styles.footer}><span>{status}</span><button type="submit" disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer prix & livraison"}</button></div>
    </form>
  );
}
