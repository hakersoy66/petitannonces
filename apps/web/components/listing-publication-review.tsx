"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./listing-publication-review.module.css";
import { AppIcon } from "./app-icon";
import { sendSiteAnalyticsEvent, trackSiteConversion } from "./site-telemetry";
import { formatListingPrice, listingPriceCopy } from "../lib/listing-price";
import { navigateApp } from "../lib/app-navigation";

type PublicationCheck = {
  ready: boolean;
  phoneVerified?: boolean;
  phoneVerificationRequired?: boolean;
  manualModerationRequired?: boolean;
  renewalRequired?: boolean;
  renewal?: { expiresAt:string; freeRenewalAvailable:boolean; costMinor:number; currency:string } | null;
  duplicate?: { id:string; title:string|null; status:string; slug:string|null; actionUrl:string } | null;
  errors: string[];
  warnings: string[];
  sellerKind?: string;
  compliance?: {
    productSafety?: { manufacturerName:string|null; productIdentifier:string|null; model:string|null; ean:string|null } | null;
    consumerDisclosure?: { sellerIsTrader:boolean; withdrawalRightApplies:boolean|null; withdrawalPeriodDays:number|null; withdrawalExceptionCode:string|null } | null;
  };
  issues?: { errors:Array<{code:string;step:number}>; warnings:Array<{code:string;step:number}> };
  quality?: {score:number;level:"EXCELLENT"|"GOOD"|"FAIR"|"WEAK";issues:Array<{code:string;label:string;step:number;severity:"HIGH"|"MEDIUM"|"LOW"}>};
  summary: {
    title: string | null;
    description: string | null;
    city: string | null;
    postalCode: string | null;
    coverUrl: string | null;
    priceMinor: number | null;
    currency: string;
    category: { name: string; slug: string; domain: string };
    propertyTransactionType: "SALE" | "RENTAL" | null;
    mediaCount: number;
    importInfo?: { sourceType: string; sourceUrl: string | null; createdAt: string } | null;
    isVacation?: boolean;
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
  city_required: "Indiquez la ville où se trouve l’annonce.",
  postal_code_required: "Indiquez le code postal de l’annonce.",
  price_required: "Indiquez le prix de l’annonce.",
  monthly_rent_required: "Indiquez le loyer mensuel demandé.",
  hourly_rate_required: "Indiquez la rémunération horaire proposée.",
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
  ready_photo_required: "Ajoutez au moins une photo avant de publier l’annonce.",
  no_delivery_method: "Aucun mode de remise n’est sélectionné.",
  rental_dpe_g_requires_eligibility_review: "Ce logement classé G nécessite une vérification d’éligibilité avant location.",
  consumer_return_policy_required: "Renseignez la politique de retour applicable à cette annonce professionnelle.",
};

function apiBase() {
  return (process.env.NEXT_PUBLIC_API_URL ?? "/api").replace(/\/$/, "");
}

function readable(code: string) {
  if (code.startsWith("required_attribute:")) return `Complétez le champ obligatoire « ${code.split(":")[1]} ».`;
  return labels[code] ?? code.replaceAll("_", " ");
}

export function ListingPublicationReview({ listingId, promotionCode="", promotionName="Sans option", onFixStep }: { listingId?: string; promotionCode?:string; promotionName?:string; onFixStep?: (step:number)=>void }) {
  const router = useRouter();
  const [check, setCheck] = useState<PublicationCheck | null>(null);
  const [loading, setLoading] = useState(Boolean(listingId));
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState(listingId ? "" : "Créez d’abord le brouillon pour lancer la vérification complète.");
  const [terms, setTerms] = useState(false);
  const [rules, setRules] = useState(false);
  const [accuracy, setAccuracy] = useState(false);
  const [disclosure, setDisclosure] = useState(false);
  const [manufacturerName, setManufacturerName] = useState("");
  const [productIdentifier, setProductIdentifier] = useState("");
  const [productModel, setProductModel] = useState("");
  const [ean, setEan] = useState("");
  const [returnMode, setReturnMode] = useState<""|"yes"|"no">("");
  const [returnDays, setReturnDays] = useState("");
  const [returnException, setReturnException] = useState("");

  async function refresh() {
    if (!listingId) return;
    setLoading(true);
    try {
      const response = await fetch(`${apiBase()}/listings/${encodeURIComponent(listingId)}/publication-check`, { credentials: "include" });
      if (!response.ok) throw new Error(`publication_check_${response.status}`);
      const payload = await response.json() as PublicationCheck;
      setCheck(payload);
      const safety=payload.compliance?.productSafety;const consumer=payload.compliance?.consumerDisclosure;
      setManufacturerName(safety?.manufacturerName??"");setProductIdentifier(safety?.productIdentifier??"");setProductModel(safety?.model??"");setEan(safety?.ean??"");
      setReturnMode(consumer?.withdrawalRightApplies===true?"yes":consumer?.withdrawalRightApplies===false?"no":"");setReturnDays(consumer?.withdrawalPeriodDays!=null?String(consumer.withdrawalPeriodDays):"");setReturnException(consumer?.withdrawalExceptionCode??"");
      setMessage(payload.duplicate ? "Cette annonce existe déjà dans votre compte. Ouvrez l’annonce existante au lieu d’en publier une seconde." : payload.renewalRequired ? (payload.renewal?.freeRenewalAvailable ? "Cette annonce a expiré. Votre prolongation gratuite doit être activée avant la remise en ligne." : "Cette annonce a expiré. Une prolongation est nécessaire avant la remise en ligne.") : payload.ready ? (payload.manualModerationRequired ? "Votre annonce est prête. Elle sera contrôlée par un modérateur avant sa mise en ligne." : "Votre annonce est prête à être envoyée en modération.") : "Corrigez les points bloquants avant publication.");
    } catch {
      setMessage("La vérification n’a pas pu être chargée pour le moment.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [listingId]);

  const allConsents = terms && rules && accuracy && disclosure;
  const productEligible=Boolean(check&&!check.summary.isVacation&&check.summary.priceMinor!==null&&!(["JOB","SERVICE","REAL_ESTATE","VEHICLE"] as string[]).includes(check.summary.category.domain));
  const proProduct=Boolean(productEligible&&check?.sellerKind==="PROFESSIONNEL");
  const returnPolicyReady=!proProduct||(returnMode==="yes"&&Number.isInteger(Number(returnDays))&&Number(returnDays)>0)||(returnMode==="no"&&returnException.trim().length>=3);
  const canPublish = Boolean(listingId && check?.ready && !check?.renewalRequired && !check?.duplicate && allConsents && returnPolicyReady && !publishing);
  const deliveryLabel = useMemo(() => {
    const commerce = check?.summary.commerce;
    if (!commerce) return "Non configuré";
    const modes = [commerce.handDeliveryEnabled && "Remise en main propre", commerce.mondialRelayEnabled && "Point relais", commerce.colissimoEnabled && "Livraison à domicile"].filter(Boolean);
    return modes.length ? modes.join(" · ") : "Aucun mode";
  }, [check]);

  async function saveCompliance(){
    if(!listingId)return false;
    if(productEligible){
      const digits=ean.replace(/\D/g,"");
      if(ean.trim()&&![8,12,13,14].includes(digits.length)){setMessage("Le code EAN / GTIN doit contenir 8, 12, 13 ou 14 chiffres.");return false}
      const response=await fetch(`${apiBase()}/listings/${encodeURIComponent(listingId)}/product-safety`,{method:"PUT",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({manufacturerName:manufacturerName.trim()||undefined,productIdentifier:productIdentifier.trim()||undefined,model:productModel.trim()||undefined,ean:digits||undefined})});
      if(!response.ok){setMessage("Les informations d’identification du produit n’ont pas pu être enregistrées.");return false}
    }
    if(proProduct){
      if(!returnPolicyReady){setMessage("Renseignez la politique de retour applicable à cette annonce professionnelle.");return false}
      const response=await fetch(`${apiBase()}/listings/${encodeURIComponent(listingId)}/consumer-disclosure`,{method:"PUT",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({sellerIsTrader:true,withdrawalRightApplies:returnMode==="yes",withdrawalPeriodDays:returnMode==="yes"?Number(returnDays):undefined,withdrawalExceptionCode:returnMode==="no"?returnException.trim():undefined})});
      if(!response.ok){setMessage("La politique de retour n’a pas pu être enregistrée.");return false}
    }
    return true;
  }

  async function publish() {
    if (!listingId || !canPublish) return;
    setPublishing(true);
    setMessage("");
    try {
      if(!await saveCompliance())return;
      if(promotionCode){
        const response=await fetch(apiBase()+"/listings/"+encodeURIComponent(listingId)+"/promotions/checkout",{
          method:"POST",credentials:"include",headers:{"content-type":"application/json"},
          body:JSON.stringify({productCode:promotionCode,publishAfterPayment:true,publicationConsents:{termsAccepted:true,rulesAccepted:true,accuracyConfirmed:true,professionalDisclosureConfirmed:true}}),
        });
        const payload=await response.json().catch(()=>({})) as {url?:string;activated?:boolean;submitted?:boolean;paidWith?:string;status?:string;error?:string;message?:string;redirect?:string;errors?:string[];duplicate?:{id:string;title:string|null;status:string;slug:string|null;actionUrl?:string};creditBalanceMinor?:number};
        if(!response.ok){
          void sendSiteAnalyticsEvent("LISTING_PUBLISH_FAILED",typeof window!=="undefined"?window.location.pathname:"/deposer-une-annonce");
          if(payload.error==="listing_content_policy_violation"||payload.error==="account_security_hold"){
            setMessage(payload.message??"Votre annonce contient un contenu interdit ou des coordonnées directes.");
            navigateApp(router,payload.redirect??"/compte-suspendu",{replace:true});return;
          }
          if(payload.error==="duplicate_listing_exists")setMessage(payload.message??"Cette annonce existe déjà dans votre compte.");
          else if(payload.error==="consumer_return_policy_required")setMessage("Renseignez la politique de retour applicable à cette annonce professionnelle.");
          else if(payload.error==="promotion_product_not_found")setMessage("L’option de visibilité sélectionnée n’est plus disponible. Revenez à l’étape Visibilité.");
          else if(payload.error==="promotion_checkout_unavailable")setMessage("Le paiement de l’option de visibilité est momentanément indisponible. Réessayez dans quelques instants.");
          else if(payload.error==="promotion_checkout_edit_unsupported")setMessage("Enregistrez d’abord les modifications de l’annonce avant d’ajouter une option de visibilité.");
          else if(payload.error==="listing_not_ready"&&payload.errors?.length)setMessage(payload.errors.map(readable).join(" "));
          else setMessage("La mise en avant n’a pas pu être préparée. Vérifiez l’annonce puis réessayez.");
          await refresh();return;
        }
        if(payload.url){window.location.assign(payload.url);return}
        if(payload.activated&&payload.submitted){
          trackSiteConversion("LISTING_SUBMITTED","listing_submitted",{status:"PENDING",listing_id:listingId,promotion_code:promotionCode,promotion_name:promotionName,payment_method:payload.paidWith??"PROMOTION"});
          setMessage("Visibilité activée. Annonce envoyée en modération.");
          navigateApp(router,"/annonce-ajoutee?status=PENDING&promotion=success&listingId="+encodeURIComponent(listingId));return;
        }
        setMessage("L’option de visibilité a été préparée mais l’annonce n’a pas pu être envoyée en modération. Réessayez.");
        return;
      }
      const response = await fetch(apiBase()+"/listings/"+encodeURIComponent(listingId)+"/publish", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ termsAccepted: true, rulesAccepted: true, accuracyConfirmed: true, professionalDisclosureConfirmed: true }),
      });
      const payload = await response.json() as { status?: string; error?:string; message?:string; redirect?:string; freeRenewalAvailable?:boolean; amountMinor?:number; errors?: string[]; listing?: { slug?: string | null }; duplicate?:{id:string;title:string|null;status:string;slug:string|null;actionUrl:string} };
      if (!response.ok) {
        void sendSiteAnalyticsEvent("LISTING_PUBLISH_FAILED",typeof window!=="undefined"?window.location.pathname:"/deposer-une-annonce");
        if(payload.error==="listing_content_policy_violation"||payload.error==="account_security_hold"){
          setMessage(payload.message??"Votre annonce contient un contenu interdit ou des coordonnées directes. Elle n’a pas été publiée ni conservée comme brouillon.");
          navigateApp(router,payload.redirect??"/compte-suspendu",{replace:true});
          return;
        }
        if(payload.error==="duplicate_listing_exists")setMessage(payload.message??"Cette annonce existe déjà dans votre compte. Ouvrez l’annonce existante au lieu d’en publier une seconde.");
        else if(payload.error==="listing_renewal_required")setMessage(payload.freeRenewalAvailable!==false?"Cette annonce a expiré. Activez votre prolongation gratuite depuis Mes annonces avant de la remettre en ligne.":`Cette annonce a expiré. Une prolongation de ${((payload.amountMinor??99)/100).toFixed(2).replace(".",",")} € est requise depuis Mes annonces.`);
        else if(payload.error==="consumer_return_policy_required")setMessage(payload.message??"Renseignez la politique de retour applicable à cette annonce professionnelle.");
        else if (payload.errors?.length) setMessage(payload.errors.map(readable).join(" "));
        else setMessage("La publication a été refusée. Vérifiez l’annonce puis réessayez.");
        await refresh();
        return;
      }
      trackSiteConversion("LISTING_SUBMITTED","listing_submitted",{status:payload.status??"PENDING",listing_id:listingId});
      setMessage("Annonce envoyée en modération avec succès.");
      navigateApp(router,`/annonce-ajoutee?status=${encodeURIComponent(payload.status??"PENDING")}${payload.listing?.slug?`&slug=${encodeURIComponent(payload.listing.slug)}`:""}`);
    } catch {
      void sendSiteAnalyticsEvent("LISTING_PUBLISH_FAILED",typeof window!=="undefined"?window.location.pathname:"/deposer-une-annonce");
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
            <div><span>{listingPriceCopy({domain:check.summary.category.domain,transactionType:check.summary.propertyTransactionType}).shortLabel}</span><strong>{formatListingPrice(check.summary.priceMinor, check.summary.currency,{domain:check.summary.category.domain,transactionType:check.summary.propertyTransactionType},"Non renseigné")}</strong></div>
            <div><span>Photos</span><strong>{check.summary.mediaCount}</strong></div>
            <div><span>Origine</span><strong>{check.summary.importInfo ? "Annonce importée" : "Saisie manuelle"}</strong></div>
            <div className={styles.wide}><span>Remise</span><strong>{deliveryLabel}</strong></div>
            <div><span>Paiement sécurisé</span><strong>{check.summary.commerce?.securePaymentEnabled ? "Activé" : "Désactivé"}</strong></div>
          </div>

          {check.summary.importInfo && <div className={styles.importReview}><AppIcon name="sparkles"/><div><strong>Données importées puis vérifiées dans Petit Annonces</strong><span>Vos modifications dans le wizard sont prioritaires. La source externe n’est jamais réappliquée automatiquement.</span></div></div>}

          {check.quality&&<section className={styles.readinessCard}><div className={styles.readinessHead}><div><span>Publish Readiness Score</span><strong>{check.quality.score}<small>/100</small></strong></div><em className={styles[`quality${check.quality.level}`]}>{({EXCELLENT:"Excellent",GOOD:"Très bien",FAIR:"À améliorer",WEAK:"Incomplet"} as const)[check.quality.level]}</em></div><div className={styles.readinessBar}><i style={{width:`${check.quality.score}%`}}/></div>{check.quality.issues.length>0?<div className={styles.qualityIssues}>{check.quality.issues.map(issue=><div key={issue.code}><span><AppIcon name={issue.severity==="HIGH"?"info":"sparkles"}/>{issue.label}</span>{onFixStep&&<button type="button" onClick={()=>onFixStep(issue.step)}>Améliorer</button>}</div>)}</div>:<div className={styles.qualityPerfect}><AppIcon name="circle-check"/>Votre annonce est complète et bien optimisée.</div>}</section>}

          <section className={styles.publicPreview}><div className={styles.previewMedia}>{check.summary.coverUrl?<img src={check.summary.coverUrl} alt="Aperçu de l’annonce"/>:<AppIcon name="image"/>}</div><div className={styles.previewBody}><span>Aperçu avant publication</span><h3>{check.summary.title??"Votre annonce"}</h3><strong>{formatListingPrice(check.summary.priceMinor,check.summary.currency,{domain:check.summary.category.domain,transactionType:check.summary.propertyTransactionType},"Prix non renseigné")}</strong><p>{check.summary.category.name} · {[check.summary.postalCode,check.summary.city].filter(Boolean).join(" ")||"Localisation à compléter"}</p>{check.summary.description&&<small>{check.summary.description.slice(0,220)}{check.summary.description.length>220?"…":""}</small>}</div></section>

          {check.duplicate&&<section className={`${styles.statusCard} ${styles.blocked}`} style={{marginBottom:16}}><div className={styles.statusTitle}><span><b>!</b></span><strong>Annonce déjà présente dans votre compte</strong></div><p>Une annonce identique « {check.duplicate.title??"Sans titre"} » existe déjà. Modifiez ou continuez cette annonce au lieu d’en créer une seconde.</p><a className={styles.fixButton} href={check.duplicate.actionUrl}>Ouvrir l’annonce existante</a></section>}

          <div className={styles.statusGrid}>
            <section className={`${styles.statusCard} ${(check.errors.length||check.renewalRequired||check.duplicate) ? styles.blocked : styles.ok}`}>
              <div className={styles.statusTitle}><span>{check.errors.length||check.renewalRequired||check.duplicate ? <b>!</b> : <AppIcon name="circle-check"/>}</span><strong>{check.duplicate?"Doublon détecté":check.renewalRequired?"Prolongation requise":check.errors.length ? `${check.errors.length} point(s) à corriger` : check.manualModerationRequired?"Contrôle modérateur":"Aucun blocage"}</strong></div>
              {check.duplicate?<p>La publication est bloquée afin d’éviter deux annonces identiques sur le même compte.</p>:check.renewalRequired?<><p>{check.renewal?.freeRenewalAvailable!==false?"La durée de 30 jours est terminée. Activez votre première prolongation gratuite avant de remettre l’annonce en ligne.":`La durée de 30 jours est terminée. Une prolongation de ${((check.renewal?.costMinor??99)/100).toFixed(2).replace(".",",")} € est nécessaire avant la remise en ligne.`}</p><a className={styles.fixButton} href="/mon-compte/annonces?status=DRAFT">Gérer la prolongation</a></>:check.errors.length ? <ul>{check.errors.map((error) => {const issue=check.issues?.errors.find(x=>x.code===error);return <li key={error}><span>{readable(error)}</span>{issue&&onFixStep&&<button type="button" className={styles.fixButton} onClick={()=>onFixStep(issue.step)}>Corriger</button>}</li>})}</ul> : check.manualModerationRequired?<p>Vous pouvez publier sans vérifier votre téléphone. L’annonce sera examinée par un modérateur avant sa mise en ligne.</p>:<p>Les contrôles obligatoires sont validés.</p>}
            </section>

            <section className={`${styles.statusCard} ${styles.warning}`}>
              <div className={styles.statusTitle}><span><AppIcon name="info"/></span><strong>{check.warnings.length ? `${check.warnings.length} recommandation(s)` : "Aucun avertissement"}</strong></div>
              {check.warnings.length ? <ul>{check.warnings.map((warning) => <li key={warning}>{readable(warning)}</li>)}</ul> : <p>Votre annonce ne présente pas d’avertissement particulier.</p>}
            </section>
          </div>
        </>
      )}

      {proProduct&&<section className={`${styles.seoCompliance} ${!returnPolicyReady?styles.seoRequired:""}`}><div className={styles.seoHead}><div><span>Vendeur professionnel</span><h3>Politique de retour</h3></div><b>Obligatoire</b></div><p className={styles.seoIntro}>Indiquez la politique réellement applicable à cette vente. Petit Annonces ne choisit pas cette information à votre place : elle doit correspondre à vos obligations et aux éventuelles exceptions applicables au produit.</p><div className={styles.returnChoices}><label className={returnMode==="yes"?styles.choiceOn:""}><input type="radio" name="withdrawal-right" checked={returnMode==="yes"} onChange={()=>setReturnMode("yes")}/><span><strong>Droit de rétractation applicable</strong><small>Indiquez ci-dessous le délai réellement proposé.</small></span></label><label className={returnMode==="no"?styles.choiceOn:""}><input type="radio" name="withdrawal-right" checked={returnMode==="no"} onChange={()=>setReturnMode("no")}/><span><strong>Retour non applicable / exception</strong><small>Précisez brièvement la raison ou l’exception applicable.</small></span></label></div>{returnMode==="yes"&&<label className={styles.singleField}><span>Délai de rétractation / retour (jours)</span><input type="number" min="1" max="365" value={returnDays} onChange={e=>setReturnDays(e.target.value)} placeholder="Ex. 14"/></label>}{returnMode==="no"&&<label className={styles.singleField}><span>Motif / exception</span><input value={returnException} onChange={e=>setReturnException(e.target.value)} maxLength={120} placeholder="Ex. produit personnalisé, exception légale applicable…"/></label>}{!returnPolicyReady&&<p className={styles.requiredText}><AppIcon name="info"/>Complétez cette politique avant de publier l’annonce professionnelle.</p>}</section>}

      {promotionCode&&<section className={styles.promotionSummary}><span><AppIcon name="sparkles"/></span><div><small>Visibilité sélectionnée</small><strong>{promotionName}</strong><p>Après confirmation, votre crédit Petit Annonces sera utilisé s’il couvre entièrement cette option. Sinon, vous serez redirigé vers le paiement sécurisé. Le badge sera activé avant l’envoi en modération.</p></div></section>}

      <div className={styles.consentBox}>
        <h3>Dernières confirmations</h3>
        <label><input type="checkbox" checked={accuracy} onChange={(e) => setAccuracy(e.target.checked)} /><span>Je confirme que les informations, le prix et les photos décrivent fidèlement l’annonce.</span></label>
        <label><input type="checkbox" checked={rules} onChange={(e) => setRules(e.target.checked)} /><span>Je respecte les <a href="/conformite" target="_blank" rel="noopener noreferrer">règles de diffusion et de conformité</a> ainsi que les produits ou services interdits de Petit Annonces.</span></label>
        <label><input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} /><span>J’accepte les <a href="/conditions-generales" target="_blank" rel="noopener noreferrer">Conditions générales</a> et reconnais avoir pris connaissance de la <a href="/confidentialite" target="_blank" rel="noopener noreferrer">Politique de confidentialité</a> et de la <a href="/cookies" target="_blank" rel="noopener noreferrer">Politique de cookies</a>.</span></label>
        <label><input type="checkbox" checked={disclosure} onChange={(e) => setDisclosure(e.target.checked)} /><span>Je confirme que mon statut particulier ou professionnel est correctement déclaré.</span></label>
      </div>

      {check?.ready&&!allConsents&&<div className={styles.publishHint}><AppIcon name="info"/><div><strong>Dernière étape avant publication</strong><span>Pour activer « Publier mon annonce », cochez les 4 confirmations ci-dessus.</span></div></div>}
      <div className={styles.footer}>
        <div><strong>{check?.duplicate?"Annonce déjà existante":check?.renewalRequired?"Prolongation requise":check?.ready ? (promotionCode?"Prêt pour visibilité & modération":"Prêt pour modération") : "Vérification nécessaire"}</strong><span>{message}</span></div>
        <div className={styles.buttons}>
          <button type="button" className={styles.secondary} onClick={() => void refresh()} disabled={!listingId || loading}>Revérifier</button>
          <button type="button" className={styles.primary} disabled={!canPublish} onClick={() => void publish()}>{publishing ? (promotionCode?"Préparation du paiement…":"Publication…") : promotionCode?"Confirmer la visibilité et publier":"Publier mon annonce"}</button>
        </div>
      </div>
      <p className={styles.moderationNote}>Après envoi, l’annonce passe au statut <b>En modération</b>. Elle ne devient publique qu’après validation selon les règles de la plateforme.</p>
    </div>
  );
}
