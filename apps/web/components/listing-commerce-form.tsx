"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import styles from "./listing-commerce-form.module.css";
import { AppIcon } from "./app-icon";
import { listingPriceCopy } from "../lib/listing-price";

type Domain = "GENERAL" | "VEHICLE" | "REAL_ESTATE" | "JOB" | "SERVICE" | "ANIMAL";

type CommerceState = {
  priceEuros: string;
  freeListing: boolean;
  acceptsOffers: boolean;
  securePaymentEnabled: boolean;
  commissionPayer: "SELLER" | "BUYER";
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
  freeListing: false,
  acceptsOffers: true,
  securePaymentEnabled: true,
  commissionPayer: "SELLER",
  handDeliveryEnabled: true,
  mondialRelayEnabled: false,
  colissimoEnabled: false,
  packageWeightG: "",
  packageLengthCm: "",
  packageWidthCm: "",
  packageHeightCm: "",
};

function apiBase() {
  return (process.env.NEXT_PUBLIC_API_URL ?? "/api").replace(/\/$/, "");
}

function nullableInt(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export type ListingCommerceFormHandle = { save: () => Promise<boolean> };

type ListingCommerceFormProps = { listingId?: string; onSaved?: () => void; onDirty?: () => void };
type PackagePresetKey = "SMALL" | "MEDIUM" | "LARGE";
const PACKAGE_PRESETS:Record<PackagePresetKey,{label:string;range:string;startingPrice:string;hint:string;weightG:string;lengthCm:string;widthCm:string;heightCm:string}> = {
  SMALL:{label:"Petit colis",range:"100 g – 3 kg",startingPrice:"3,99 €",hint:"Vêtements, chaussures, petits objets",weightG:"3000",lengthCm:"30",widthCm:"20",heightCm:"15"},
  MEDIUM:{label:"Colis moyen",range:"> 3 kg – 10 kg",startingPrice:"8,99 €",hint:"Électroménager léger, lots, objets moyens",weightG:"10000",lengthCm:"45",widthCm:"35",heightCm:"25"},
  LARGE:{label:"Grand colis",range:"> 10 kg – 30 kg",startingPrice:"14,99 €",hint:"Objets lourds ou volumineux",weightG:"30000",lengthCm:"60",widthCm:"40",heightCm:"40"},
};
function presetFromWeight(value:string):PackagePresetKey|null{
  const weight=nullableInt(value);if(!weight)return null;
  if(weight<=3000)return "SMALL";
  if(weight<=10000)return "MEDIUM";
  return "LARGE";
}
type PriceInsight =
  | { available:false; sampleSize:number; reason:string }
  | { available:true; sampleSize:number; basis:string; basisLabel:string; confidence:"high"|"medium"|"low"; medianMinor:number; rangeLowMinor:number; rangeHighMinor:number; enteredPriceMinor:number|null; position:"unknown"|"very_low"|"low"|"fair"|"high"|"very_high"; differencePercent:number|null; message:string };

function priceInsightLabel(position:PriceInsight extends infer _T ? "unknown"|"very_low"|"low"|"fair"|"high"|"very_high" : never){
  return ({unknown:"Analyse du marché",very_low:"Prix très bas",low:"Prix plutôt bas",fair:"Prix cohérent",high:"Prix plutôt élevé",very_high:"Prix très élevé"} as const)[position];
}

export const ListingCommerceForm = forwardRef<ListingCommerceFormHandle, ListingCommerceFormProps>(function ListingCommerceForm({ listingId, onSaved, onDirty }, ref) {
  const [form, setForm] = useState<CommerceState>(initialState);
  const [domain, setDomain] = useState<Domain>("GENERAL");
  const [transactionType, setTransactionType] = useState<"SALE" | "RENTAL" | null>(null);
  const [isVacation,setIsVacation]=useState(false);
  const [status, setStatus] = useState(listingId ? "Chargement…" : "Les réglages seront enregistrés dès que le brouillon sera créé.");
  const [dirty, setDirty] = useState(false);
  const [importedPrice, setImportedPrice] = useState(false);
  const [sellerPaymentReady, setSellerPaymentReady] = useState(true);
  const [priceInsight,setPriceInsight]=useState<PriceInsight|null>(null);
  const [priceInsightLoading,setPriceInsightLoading]=useState(false);
  const [validationAttempted,setValidationAttempted]=useState(false);
  const [packagePreset,setPackagePreset]=useState<PackagePresetKey|null>(null);

  const securePaymentAllowed = !isVacation && !["VEHICLE", "REAL_ESTATE"].includes(domain);
  const shippable = !isVacation && !["VEHICLE", "REAL_ESTATE", "JOB", "SERVICE"].includes(domain);
  const shippingSelected = form.mondialRelayEnabled || form.colissimoEnabled;
  const priceCopy = listingPriceCopy({ domain, transactionType, isVacation });
  const priceOptional = domain === "SERVICE";
  const priceMinor = useMemo(() => {
    if (form.freeListing) return 0;
    const normalized = form.priceEuros.replace(",", ".").trim();
    if (!normalized) return null;
    const amount = Number(normalized);
    return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null;
  }, [form.priceEuros, form.freeListing]);
  const noPriceService = priceOptional && priceMinor == null;
  const commissionMinor = priceMinor != null && priceMinor > 0 ? Math.round(priceMinor * 0.10) : 0;
  const sellerNetMinor = priceMinor == null ? null : Math.max(0, form.commissionPayer === "SELLER" ? priceMinor - commissionMinor : priceMinor);
  const buyerServiceFeeMinor = form.commissionPayer === "BUYER" ? commissionMinor : 0;
  const money = (minor:number) => new Intl.NumberFormat("fr-FR", { style:"currency", currency:"EUR" }).format(minor / 100);

  useEffect(() => {
    if (!listingId) return;
    let cancelled = false;
    fetch(`${apiBase()}/listings/${encodeURIComponent(listingId)}/commerce-settings`, { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`commerce_${response.status}`);
        return response.json() as Promise<{
          listing: { priceMinor: number | null; domain: Domain; transactionType: "SALE" | "RENTAL" | null; isVacation?:boolean };
          importInfo?: { sourceType: string; sourceUrl: string | null; createdAt: string } | null;
          configured?: boolean;
          sellerPaymentReady?: boolean;
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
        setTransactionType(payload.listing.transactionType ?? null);
        setIsVacation(Boolean(payload.listing.isVacation));
        const paymentReady = payload.sellerPaymentReady !== false;
        setSellerPaymentReady(paymentReady);
        const loadedWeight=payload.settings.packageWeightG?.toString() ?? "";
        setPackagePreset(presetFromWeight(loadedWeight));
        setForm({
          priceEuros: payload.listing.priceMinor == null || payload.listing.priceMinor===0 ? "" : (payload.listing.priceMinor / 100).toFixed(payload.listing.priceMinor % 100 === 0 ? 0 : 2),
      freeListing: payload.listing.priceMinor === 0,
          acceptsOffers: payload.listing.domain === "SERVICE" && payload.listing.priceMinor == null ? false : payload.settings.acceptsOffers,
          securePaymentEnabled: payload.listing.domain === "SERVICE" && payload.listing.priceMinor == null ? false : payload.settings.securePaymentEnabled,
          commissionPayer: payload.settings.commissionPayer === "BUYER" ? "BUYER" : "SELLER",
          handDeliveryEnabled: payload.settings.handDeliveryEnabled,
          mondialRelayEnabled: payload.settings.mondialRelayEnabled,
          colissimoEnabled: payload.settings.colissimoEnabled,
          packageWeightG: loadedWeight,
          packageLengthCm: payload.settings.packageLengthCm?.toString() ?? "",
          packageWidthCm: payload.settings.packageWidthCm?.toString() ?? "",
          packageHeightCm: payload.settings.packageHeightCm?.toString() ?? "",
        });
        setStatus("Réglages chargés.");
        setImportedPrice(Boolean(payload.importInfo && payload.listing.priceMinor != null));
        setDirty(false);
        if (payload.listing.priceMinor != null || (payload.listing.domain === "SERVICE" && payload.configured)) onSaved?.();
      })
      .catch(() => { if (!cancelled) setStatus("Impossible de charger les réglages pour le moment."); });
    return () => { cancelled = true; };
  }, [listingId]);

  useEffect(()=>{
    if(!listingId||form.freeListing||priceMinor==null||priceMinor<=0){setPriceInsight(null);setPriceInsightLoading(false);return}
    let cancelled=false;
    const timer=window.setTimeout(()=>{
      setPriceInsightLoading(true);
      fetch(`${apiBase()}/listings/${encodeURIComponent(listingId)}/price-insight?priceMinor=${priceMinor}`,{credentials:"include"})
        .then(async response=>{if(!response.ok)throw new Error(`price_insight_${response.status}`);return response.json() as Promise<PriceInsight>})
        .then(payload=>{if(!cancelled)setPriceInsight(payload)})
        .catch(()=>{if(!cancelled)setPriceInsight(null)})
        .finally(()=>{if(!cancelled)setPriceInsightLoading(false)});
    },550);
    return()=>{cancelled=true;window.clearTimeout(timer)};
  },[listingId,priceMinor,form.freeListing]);

  function updateForm(updater: (current: CommerceState) => CommerceState) {
    onDirty?.();
    setDirty(true);
    setForm(updater);
  }

  function toggle(key: keyof CommerceState) {
    updateForm((current) => ({ ...current, [key]: !current[key] }));
  }

  function selectPackagePreset(key:PackagePresetKey){
    const preset=PACKAGE_PRESETS[key];
    setPackagePreset(key);
    updateForm(current=>({
      ...current,
      packageWeightG:preset.weightG,
      packageLengthCm:preset.lengthCm,
      packageWidthCm:preset.widthCm,
      packageHeightCm:preset.heightCm,
    }));
  }

  function applySuggestedPrice(minor:number){
    setImportedPrice(false);
    updateForm(current=>({...current,freeListing:false,priceEuros:(minor/100).toFixed(minor%100===0?0:2)}));
  }

  async function saveCurrent({ silent = false }: { silent?: boolean } = {}) {
    if(!silent)setValidationAttempted(true);
    if ((!priceOptional && priceMinor == null) || !listingId) { if (!silent) setStatus("Indiquez un prix valide avant de continuer."); return false; }
    if (shippingSelected && !nullableInt(form.packageWeightG)) { if (!silent) setStatus("Choisissez la taille du colis pour proposer la livraison."); return false; }
    try {
      const withoutPrice=priceMinor==null;
      const response = await fetch(`${apiBase()}/listings/${encodeURIComponent(listingId)}/commerce-settings`, {
        method: "PUT", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          priceMinor, acceptsOffers: withoutPrice || form.freeListing ? false : form.acceptsOffers, securePaymentEnabled: securePaymentAllowed && !withoutPrice && !form.freeListing ? form.securePaymentEnabled : false,
          commissionPayer: form.commissionPayer,
          handDeliveryEnabled: shippable ? form.handDeliveryEnabled : true,
          mondialRelayEnabled: shippable ? form.mondialRelayEnabled : false, colissimoEnabled: shippable ? form.colissimoEnabled : false,
          packageWeightG: shippable ? nullableInt(form.packageWeightG) : null, packageLengthCm: shippable ? nullableInt(form.packageLengthCm) : null,
          packageWidthCm: shippable ? nullableInt(form.packageWidthCm) : null, packageHeightCm: shippable ? nullableInt(form.packageHeightCm) : null,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        const labels: Record<string,string> = {
          seller_payment_account_required: "Ajoutez votre IBAN dans Mon compte > Paiements avant le versement vendeur.",
          price_required: "Indiquez un prix valide pour cette catégorie.",
          secure_payment_requires_price: "Ajoutez un prix pour activer le paiement sécurisé.",
          package_weight_required: "Choisissez Petit, Moyen ou Grand colis pour proposer la livraison.",
          fulfillment_method_required: "Choisissez au moins un mode de remise ou désactivez le paiement sécurisé.",
          shipping_not_supported_for_category: "La livraison n’est pas disponible pour cette catégorie.",
          invalid_request: "Vérifiez le prix et les informations de livraison.",
        };
        setStatus(labels[payload.error ?? ""] ?? "Impossible d’enregistrer ces réglages. Vérifiez les champs puis réessayez.");
        return false;
      }
      setValidationAttempted(false); setDirty(false); setStatus("Prix et réglages enregistrés."); onSaved?.(); return true;
    } catch { setStatus("Connexion interrompue pendant l’enregistrement. Vos autres informations restent dans le brouillon ; réessayez en continuant vers la vérification."); return false; }
  }

  useImperativeHandle(ref, () => ({ save: () => saveCurrent() }));

  useEffect(() => {
    if (!dirty || !listingId || (!priceOptional && priceMinor == null)) return;
    if (shippingSelected && !nullableInt(form.packageWeightG)) return;
    const timer = window.setTimeout(() => { void saveCurrent({ silent: true }).then((ok) => { if (!ok) setStatus("Enregistrement automatique impossible. Le prix sera vérifié lorsque vous continuerez."); }); }, 700);
    return () => window.clearTimeout(timer);
  }, [dirty, listingId, priceMinor, priceOptional, form.acceptsOffers, form.securePaymentEnabled, form.commissionPayer, form.handDeliveryEnabled, form.mondialRelayEnabled, form.colissimoEnabled, form.packageWeightG, form.packageLengthCm, form.packageWidthCm, form.packageHeightCm, shippable, shippingSelected]);


  const showStatus = /Impossible|Indiquez|Connexion|Vérifiez|Choisissez|Ajoutez/.test(status);
  const priceInsightTone=priceInsight?.available?(priceInsight.position==="very_low"||priceInsight.position==="low"?styles.priceInsightLow:priceInsight.position==="very_high"||priceInsight.position==="high"?styles.priceInsightHigh:priceInsight.position==="fair"?styles.priceInsightFair:styles.priceInsightNeutral):styles.priceInsightNeutral;

  return (
    <div className={styles.form}>
      <div className={styles.pricePanel}>
        <label className={validationAttempted&&!priceOptional&&priceMinor==null?styles.validationError:undefined} data-validation-error={validationAttempted&&!priceOptional&&priceMinor==null?"true":undefined}>
          <span>{priceCopy.label}{importedPrice && <small className={styles.importBadge}>Importé</small>}</span>
          <div className={styles.priceInput}><input inputMode="decimal" value={form.priceEuros} disabled={form.freeListing} onChange={(event) => { setImportedPrice(false); updateForm((current) => ({ ...current, freeListing:false, priceEuros: event.target.value })); }} placeholder={form.freeListing?"Gratuit":priceCopy.placeholder} /><b>{form.freeListing?"Offert":priceCopy.inputSuffix}</b></div>
          <small className={styles.priceHelp}>{form.freeListing?"Vous donnez cet article gratuitement. Aucun montant ne sera demandé à l’acheteur.":priceCopy.help}</small>{validationAttempted&&!priceOptional&&priceMinor==null&&<small className={styles.validationText}>Indiquez un prix valide.</small>}
          {!form.freeListing&&priceMinor!=null&&priceMinor>0&&<div className={`${styles.priceInsight} ${priceInsightTone}`}>
            <div className={styles.priceInsightHead}><span><AppIcon name="gauge"/></span><div><strong>{priceInsight?.available?priceInsightLabel(priceInsight.position):"Comparaison de prix"}</strong><small>{priceInsight?.available?`${priceInsight.sampleSize} annonce${priceInsight.sampleSize>1?"s":""} comparée${priceInsight.sampleSize>1?"s":""} · ${priceInsight.basisLabel}`:priceInsightLoading?"Analyse des annonces similaires…":"Analyse des prix disponibles sur Petit Annonces."}</small></div>{priceInsight?.available&&priceInsight.differencePercent!=null&&<em>{priceInsight.differencePercent>0?"+":""}{priceInsight.differencePercent}%</em>}</div>
            {priceInsightLoading?<div className={styles.priceInsightLoading}><i/><span>Recherche de prix comparables…</span></div>:priceInsight?.available?<><p>{priceInsight.message}</p><div className={styles.priceInsightStats}><span><small>Fourchette observée</small><b>{money(priceInsight.rangeLowMinor)} – {money(priceInsight.rangeHighMinor)}</b></span><span><small>Prix médian</small><b>{money(priceInsight.medianMinor)}</b></span></div>{priceInsight.position!=="fair"&&priceInsight.position!=="unknown"&&<button type="button" className={styles.applyMarketPrice} onClick={()=>applySuggestedPrice(priceInsight.medianMinor)}><AppIcon name="sparkles"/>Utiliser le prix conseillé : {money(priceInsight.medianMinor)}</button>}</>:priceInsight&&<p>Pas encore assez d’annonces comparables pour proposer un prix fiable.</p>}
          </div>}
          {priceCopy.basis==="TOTAL"&&<button type="button" className={`${styles.freeToggle} ${form.freeListing?styles.freeToggleActive:""}`} onClick={()=>{setImportedPrice(false);updateForm(current=>({...current,freeListing:!current.freeListing,priceEuros:current.freeListing?current.priceEuros:"",acceptsOffers:current.freeListing?current.acceptsOffers:false,securePaymentEnabled:current.freeListing?current.securePaymentEnabled:false}))}}><strong>{form.freeListing?"✓ Offert":"Offrir gratuitement"}</strong><span>{form.freeListing?"L’annonce sera affichée comme Gratuit.":"Aucun prix demandé à l’acheteur."}</span></button>}
        </label>
        {!isVacation&&<label className={styles.switchRow}>
          <input type="checkbox" checked={form.acceptsOffers} disabled={form.freeListing||noPriceService} onChange={() => toggle("acceptsOffers")} />
          <span className={styles.switchIcon} aria-hidden="true"><AppIcon name="handshake"/></span>
          <span className={styles.switchCopy}><b>Accepter les offres</b><small>{noPriceService?"Ajoutez un tarif pour recevoir des offres de prix.":"Les acheteurs pourront proposer un autre prix."}</small></span>
        </label>}
        {isVacation&&<div className={styles.vacationPriceHint}><AppIcon name="calendar"/><div><b>Tarif de séjour</b><span>Ce montant correspond à une nuit. Les disponibilités et périodes fermées sont gérées dans les détails de l’hébergement.</span></div></div>}
        {securePaymentAllowed&&<label className={styles.switchRow}>
          <input type="checkbox" checked={form.securePaymentEnabled} disabled={form.freeListing||noPriceService} onChange={() => toggle("securePaymentEnabled")} />
          <span className={`${styles.switchIcon} ${styles.switchIconSecure}`} aria-hidden="true"><AppIcon name="shield"/></span>
          <span className={styles.switchCopy}><b>Paiement sécurisé Petit Annonces</b><small>{noPriceService?"Ajoutez un tarif pour activer le paiement sécurisé.":sellerPaymentReady?"À activer lorsque la catégorie et le moyen de remise sont éligibles.":"Vous pouvez l’activer maintenant ; l’IBAN sera requis uniquement avant votre versement."}</small></span>
        </label>}
        {securePaymentAllowed&&!sellerPaymentReady&&<div className={styles.paymentHint}><AppIcon name="info"/><span>Votre annonce peut être vendue avec le paiement sécurisé. Ajoutez votre IBAN avant le versement vendeur depuis <a href="/mon-compte/paiements">Mon compte → Paiements</a>.</span></div>}
        {securePaymentAllowed&&form.securePaymentEnabled&&!form.freeListing&&priceMinor!=null&&priceMinor>0&&<section className={styles.commissionPanel}>
          <div className={styles.commissionHead}><div><span>Frais de service Petit Annonces</span><h3>Qui prend en charge les 10 % ?</h3></div><b>10 %</b></div>
          <div className={styles.commissionChoices}>
            <button type="button" className={form.commissionPayer==="SELLER"?styles.commissionSelected:""} onClick={()=>updateForm(current=>({...current,commissionPayer:"SELLER"}))}><span><strong>Je prends les frais en charge</strong><small>La commission est retenue sur le prix de vente.</small></span><em>{form.commissionPayer==="SELLER"?"✓ Sélectionné":"Choisir"}</em></button>
            <button type="button" className={form.commissionPayer==="BUYER"?styles.commissionSelected:""} onClick={()=>updateForm(current=>({...current,commissionPayer:"BUYER"}))}><span><strong>L’acheteur prend les frais en charge</strong><small>Les 10 % apparaissent dans son récapitulatif comme frais de service TTC.</small></span><em>{form.commissionPayer==="BUYER"?"✓ Sélectionné":"Choisir"}</em></button>
          </div>
          <div className={styles.netPreview}><div><span>Prix de vente</span><b>{money(priceMinor)}</b></div><div><span>Frais Petit Annonces (10 %)</span><b>{money(commissionMinor)}</b></div>{form.commissionPayer==="BUYER"&&<div><span>Frais de service facturés à l’acheteur</span><b>{money(buyerServiceFeeMinor)}</b></div>}<div className={styles.netTotal}><span>Vous recevrez net</span><strong>{sellerNetMinor!=null?money(sellerNetMinor):"—"}</strong></div></div>
          <p className={styles.commissionNote}><AppIcon name="shield"/><span>Les frais de traitement du paiement, notamment Stripe, sont absorbés par Petit Annonces dans ces 10 %. Aucun frais de paiement supplémentaire n’est ajouté au vendeur ou à l’acheteur. Le versement vendeur reste prévu à partir du 21e jour après livraison, sous réserve d’absence de litige, retour ou blocage de sécurité.</span></p>
        </section>}
      </div>

      {shippable && <div className={`${styles.deliveryPanel} ${validationAttempted&&form.securePaymentEnabled&&!form.handDeliveryEnabled&&!shippingSelected?styles.validationError:""}`} data-validation-error={validationAttempted&&form.securePaymentEnabled&&!form.handDeliveryEnabled&&!shippingSelected?"true":undefined}>
        <div className={styles.sectionTitle}><div><span>Remise & livraison</span><h3>Comment l’acheteur récupère-t-il l’article ?</h3></div><small>{shippable ? "Plusieurs choix possibles" : "Remise adaptée à la catégorie"}</small></div>

        <div className={styles.methods}>
          <label className={`${styles.method} ${form.handDeliveryEnabled ? styles.selected : ""}`}>
            <input type="checkbox" checked={form.handDeliveryEnabled} onChange={() => toggle("handDeliveryEnabled")} />
            <span className={styles.methodIcon}><AppIcon name="handshake"/></span><span><b>Remise en main propre</b><small>Vous convenez du lieu avec l’acheteur.</small></span>
          </label>
          {shippable && <label className={`${styles.method} ${form.mondialRelayEnabled ? styles.selected : ""}`}>
            <input type="checkbox" checked={form.mondialRelayEnabled} onChange={() => toggle("mondialRelayEnabled")} />
            <span className={styles.methodIcon}><AppIcon name="box"/></span><span><span className={styles.carrierBrand}><img src="/brands/mondial-relay.jpg" alt="Mondial Relay"/></span><b>Livraison en point relais</b><small>Proposez un retrait dans un point relais disponible.</small></span>
          </label>}
          {shippable && <label className={`${styles.method} ${form.colissimoEnabled ? styles.selected : ""}`}>
            <input type="checkbox" checked={form.colissimoEnabled} onChange={() => toggle("colissimoEnabled")} />
            <span className={styles.methodIcon}><AppIcon name="truck"/></span><span><span className={styles.carrierBrand}><img src="/brands/chronopost.svg" alt="Chronopost"/></span><b>Livraison à domicile</b><small>Proposez une livraison suivie à l’adresse de l’acheteur.</small></span>
          </label>}
        </div>
        {validationAttempted&&form.securePaymentEnabled&&!form.handDeliveryEnabled&&!shippingSelected&&<small className={styles.validationText}>Choisissez au moins un mode de remise ou désactivez le paiement sécurisé.</small>}

        {shippable && shippingSelected && <div className={`${styles.packageBox} ${validationAttempted&&shippingSelected&&!packagePreset?styles.validationError:""}`} data-validation-error={validationAttempted&&shippingSelected&&!packagePreset?"true":undefined}>
          <div><b>Choisissez la taille du colis</b><p>Pas besoin de saisir le poids ni les dimensions : choisissez simplement la tranche qui correspond à votre colis.</p></div>
          <div className={styles.packagePresetGrid}>
            {(Object.entries(PACKAGE_PRESETS) as Array<[PackagePresetKey,(typeof PACKAGE_PRESETS)[PackagePresetKey]]>).map(([key,preset])=><button type="button" key={key} className={`${styles.packagePreset} ${packagePreset===key?styles.packagePresetSelected:""}`} onClick={()=>selectPackagePreset(key)}>
              <div className={styles.packagePresetTop}><span className={styles.packageRange}>{preset.range}</span><span className={styles.packageStartPrice}><small>À partir de</small><b>{preset.startingPrice}</b></span></div>
              <span className={styles.packagePresetIcon}><AppIcon name={key==="SMALL"?"box":"truck"}/></span>
              <strong>{preset.label}</strong>
              <small>{preset.hint}</small>
              <em>{packagePreset===key?"✓ Sélectionné":"Choisir"}</em>
            </button>)}
          </div>
          {validationAttempted&&shippingSelected&&!packagePreset&&<small className={styles.validationText}>Choisissez Petit, Moyen ou Grand colis pour continuer.</small>}
          <div className={styles.packagePresetNote}><AppIcon name="info"/><span>Le tarif de livraison sera calculé au paiement selon l’adresse de l’acheteur et le transporteur disponible.</span></div>
        </div>}
      </div>}

      {showStatus&&<div className={styles.paymentHint}><AppIcon name="info"/><span>{status}</span></div>}
    </div>
  );
});
