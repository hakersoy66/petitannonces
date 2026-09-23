"use client";

import {ProfessionalWorkspace} from "../../../components/professional-workspace";
import {useEffect,useState} from "react";
import styles from "../pro-tools.module.css";
import {fetchWithRetry} from "../../../lib/fetch-resilient";

type PlanCode=string;
type Plan={id:string;code:PlanCode;name:string;monthlyPriceMinor:number;currency:string;maxActiveListings:number|null;maxStores:number;analyticsEnabled:boolean;autoRenewListings:boolean;prioritySupport:boolean;featuredCreditsMonthly:number;bulkImportEnabled:boolean;apiFeedEnabled:boolean};
type Subscription={status:string;trialEndsAt:string|null;currentPeriodStart:string|null;currentPeriodEnd:string|null;cancelAtPeriodEnd:boolean;createdAt:string;externalProvider:string|null;plan:Plan};
type Me={id:string;email:string;subscriptions:Subscription[]};
type Invoice={id:string;number:string|null;status:string|null;amountDueMinor:number;amountPaidMinor:number;currency:string;createdAt:string|null;periodStart:string|null;periodEnd:string|null;hostedInvoiceUrl:string|null;invoicePdfUrl:string|null};
type PaymentMethodSummary={type:string;brand:string|null;last4:string|null;expMonth:number|null;expYear:number|null};
type UpcomingInvoice={amountDueMinor:number;currency:string;chargeAt:string|null;periodStart:string|null;periodEnd:string|null};
type PendingChange={planCode:PlanCode;effectiveAt:string|null;scheduleId:string};
type BillingSummary={stripeReachable:boolean;paymentMethod:PaymentMethodSummary|null;upcomingInvoice:UpcomingInvoice|null;invoices:Invoice[];pendingChange:PendingChange|null};

function api(){return (process.env.NEXT_PUBLIC_API_URL??"/api").replace(/\/$/,"")}
function money(n:number,c="EUR"){return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c}).format(n/100)}
function date(value:string|null){return value?new Date(value).toLocaleDateString("fr-FR"):"—"}
function statusLabel(v:string){return ({ACTIVE:"Actif",TRIALING:"Période d’essai",PAST_DUE:"Paiement à régulariser",CANCELED:"Résilié",EXPIRED:"Expiré"} as Record<string,string>)[v]??"Mise à jour en cours"}
function invoiceStatusLabel(v:string|null){return ({paid:"Payée",open:"À payer",draft:"Brouillon",void:"Annulée",uncollectible:"Impayée"} as Record<string,string>)[v??""]??"En cours"}
function paymentMethodLabel(pm:PaymentMethodSummary|null){if(!pm)return"Non disponible";const brand=(pm.brand??"").toLowerCase();const label=brand==="visa"?"Visa":brand==="mastercard"?"Mastercard":brand==="amex"?"American Express":brand==="sepa"?"Prélèvement SEPA":pm.type==="card"?"Carte bancaire":pm.type.replaceAll("_"," ");return pm.last4?`${label} •••• ${pm.last4}`:label}
function paymentExpiry(pm:PaymentMethodSummary|null){return pm?.expMonth&&pm?.expYear?`Expire ${String(pm.expMonth).padStart(2,"0")}/${String(pm.expYear).slice(-2)}`:"Géré de façon sécurisée par Stripe"}
function daysLeft(value:string|null){if(!value)return null;return Math.max(0,Math.ceil((new Date(value).getTime()-Date.now())/86400000))}
function planPitch(code:PlanCode){if(code==="ESSENTIEL")return"Pour démarrer avec une vitrine professionnelle claire.";if(code==="PROFESSIONNEL")return"Le meilleur équilibre pour développer une activité régulière.";if(code==="PREMIUM")return"Pour les catalogues importants et les équipes qui veulent tout débloquer.";return"Une formule professionnelle adaptée à votre activité."}

export default function Abonnement(){
  const[plans,setPlans]=useState<Plan[]>([]);
  const[me,setMe]=useState<Me|null>(null);
  const[billing,setBilling]=useState<BillingSummary|null>(null);
  const[stripeState,setStripeState]=useState("");
  const[desiredPlan,setDesiredPlan]=useState("");
  const[portalBusy,setPortalBusy]=useState(false);
  const[portalMsg,setPortalMsg]=useState("");
  const[checkoutBusy,setCheckoutBusy]=useState("");
  const[checkoutMsg,setCheckoutMsg]=useState("");
  const[changeTarget,setChangeTarget]=useState<Plan|null>(null);
  const[changeBusy,setChangeBusy]=useState(false);
  const[changeMsg,setChangeMsg]=useState("");
  const[cancelConfirm,setCancelConfirm]=useState(false);
  const[cancelBusy,setCancelBusy]=useState(false);
  const[cancelMsg,setCancelMsg]=useState("");

  async function load(){
    const[a,b,c]=await Promise.all([
      fetchWithRetry(`${api()}/pro/plans`,{cache:"no-store"},{timeoutMs:7000,retries:1}).then(r=>r.json()),
      fetchWithRetry(`${api()}/pro/me`,{credentials:"include",cache:"no-store"},{timeoutMs:7000,retries:1}).then(async r=>{if(r.status===401){location.href="/connexion?next=%2Fespace-pro%2Fabonnement";return null}return r.json()}),
      fetchWithRetry(`${api()}/billing/stripe/subscription/summary`,{credentials:"include",cache:"no-store"},{timeoutMs:7000,retries:1}).then(r=>r.ok?r.json():null).catch(()=>null),
    ]);
    setPlans(a.plans??[]);
    if(b)setMe(b.professional);
    if(c)setBilling({stripeReachable:Boolean(c.stripeReachable),paymentMethod:c.paymentMethod??null,upcomingInvoice:c.upcomingInvoice??null,invoices:Array.isArray(c.invoices)?c.invoices:[],pendingChange:c.pendingChange??null});
  }

  async function startCheckout(planCode:PlanCode){
    setCheckoutBusy(planCode);setCheckoutMsg("");
    const r=await fetch(`${api()}/billing/stripe/subscription/checkout`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({planCode})});
    const p=await r.json().catch(()=>({}));setCheckoutBusy("");
    if(r.ok&&p.url){window.location.href=p.url;return}
    if(p.error==="stripe_subscription_already_active")setCheckoutMsg("Un abonnement Stripe est déjà actif sur ce compte.");
    else if(p.error==="professional_plan_not_found")setCheckoutMsg("Cette formule n’est plus disponible.");
    else setCheckoutMsg("Impossible d’ouvrir le paiement Stripe pour le moment.");
  }

  async function openPortal(){
    setPortalBusy(true);setPortalMsg("");
    const r=await fetch(`${api()}/billing/stripe/portal`,{method:"POST",credentials:"include"});
    const p=await r.json().catch(()=>({}));setPortalBusy(false);
    if(r.ok&&p.url){window.location.href=p.url;return}
    setPortalMsg(p.error==="stripe_subscription_not_found"?"Aucun abonnement Stripe actif n’est associé à ce compte.":"Le portail de gestion de l’abonnement est momentanément indisponible. Réessayez dans quelques instants.");
  }

  async function confirmPlanChange(){
    if(!changeTarget)return;
    setChangeBusy(true);setChangeMsg("");setCheckoutMsg("");
    const r=await fetch(`${api()}/billing/stripe/subscription/change`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({planCode:changeTarget.code})});
    const p=await r.json().catch(()=>({}));setChangeBusy(false);
    if(!r.ok){
      if(p.error==="subscription_change_already_scheduled")setChangeMsg("Un changement de formule est déjà programmé. Annulez-le d’abord pour en choisir un autre.");
      else if(p.error==="plan_already_active")setChangeMsg("Cette formule est déjà active.");
      else if(p.error==="stripe_subscription_required_for_change")setChangeMsg("Cette formule n’est pas encore reliée à Stripe. Utilisez le paiement Stripe pour migrer vers la nouvelle formule.");
      else setChangeMsg("Le changement de formule n’a pas pu être appliqué pour le moment.");
      return;
    }
    setChangeTarget(null);
    await load();
    if(p.mode==="period_end")setCheckoutMsg(`Changement programmé : la formule ${changeTarget.name} prendra effet le ${date(p.effectiveAt??null)}.`);
    else if(p.pendingPayment)setCheckoutMsg("Le changement est en attente de confirmation du paiement. Ouvrez « Moyen de paiement » pour finaliser si nécessaire.");
    else setCheckoutMsg(`Votre formule ${changeTarget.name} est maintenant active.`);
  }

  async function cancelScheduledChange(){
    setChangeBusy(true);setCheckoutMsg("");
    const r=await fetch(`${api()}/billing/stripe/subscription/change/cancel`,{method:"POST",credentials:"include"});
    const p=await r.json().catch(()=>({}));setChangeBusy(false);
    if(!r.ok){setCheckoutMsg(p.error==="scheduled_change_not_found"?"Aucun changement programmé n’a été trouvé.":"Impossible d’annuler le changement programmé pour le moment.");return}
    await load();setCheckoutMsg("Le changement de formule programmé a été annulé.");
  }

  async function scheduleCancellation(){
    setCancelBusy(true);setCancelMsg("");setCheckoutMsg("");
    const r=await fetch(`${api()}/billing/stripe/subscription/cancel`,{method:"POST",credentials:"include"});
    const p=await r.json().catch(()=>({}));setCancelBusy(false);
    if(!r.ok){
      if(p.error==="external_subscription_schedule")setCancelMsg("Un calendrier Stripe externe est associé à cet abonnement. Gérez d’abord ce calendrier depuis Stripe.");
      else setCancelMsg("La résiliation n’a pas pu être programmée pour le moment.");
      return;
    }
    setCancelConfirm(false);
    await load();
    setCheckoutMsg(`Résiliation programmée : votre formule restera active jusqu’au ${date(p.effectiveAt??null)}.`);
  }

  async function reactivateSubscription(){
    setCancelBusy(true);setCancelMsg("");setCheckoutMsg("");
    const r=await fetch(`${api()}/billing/stripe/subscription/reactivate`,{method:"POST",credentials:"include"});
    const p=await r.json().catch(()=>({}));setCancelBusy(false);
    if(!r.ok){setCancelMsg("La réactivation n’a pas pu être effectuée pour le moment.");return}
    await load();
    setCheckoutMsg("Votre abonnement a été réactivé. Le renouvellement automatique est de nouveau actif.");
  }

  useEffect(()=>{
    const q=new URLSearchParams(window.location.search);setStripeState(q.get("stripe")??"");
    const requested=q.get("plan");if(requested&&/^[A-Z0-9_-]{2,60}$/.test(requested))setDesiredPlan(requested);
    void load().catch(()=>setCheckoutMsg("Impossible de charger les informations d’abonnement pour le moment."));
  },[]);

  const current=me?.subscriptions?.[0];
  const trialDays=daysLeft(current?.trialEndsAt??null);
  const subscriptionStart=current?.createdAt??current?.currentPeriodStart??null;
  const periodStart=current?.currentPeriodStart??current?.createdAt??null;
  const periodEnd=current?.currentPeriodEnd??current?.trialEndsAt??null;
  const remainingDays=daysLeft(periodEnd);
  const nextDateLabel=current?.cancelAtPeriodEnd?"Fin de l’abonnement":current?.status==="TRIALING"?"Fin de l’essai":"Prochain renouvellement";
  const pendingPlan=billing?.pendingChange?plans.find(p=>p.code===billing.pendingChange?.planCode)??null:null;
  const isUpgrade=Boolean(current&&changeTarget&&changeTarget.monthlyPriceMinor>current.plan.monthlyPriceMinor);
  const isTrialChange=current?.status==="TRIALING";
  const monthlyDifference=current&&changeTarget?changeTarget.monthlyPriceMinor-current.plan.monthlyPriceMinor:0;

  return <ProfessionalWorkspace><main className={`${styles.shell} ${styles.membershipPage}`}>
    <a className={styles.back} href="/espace-pro">← Retour à l’Espace Pro</a>
    <header className={styles.hero}><div><span className={styles.kicker}>Formule professionnelle</span><h1>Abonnement</h1><p>Consultez votre formule actuelle, vos dates de facturation et changez de formule sans créer un second abonnement.</p></div><span className={styles.status}>{current?.plan.name??"Aucune formule active"}</span></header>

    {current&&<section className={styles.section}>
      <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap"}}><h2 style={{margin:0}}>Votre abonnement</h2><button type="button" className={styles.button} onClick={()=>void openPortal()} disabled={portalBusy}>{portalBusy?"Ouverture…":"Gérer mon abonnement"}</button></div>
      <div className={styles.subscriptionOverview}>
        <article><span>Formule actuelle</span><strong>{current.plan.name}</strong><small>{money(current.plan.monthlyPriceMinor,current.plan.currency)} / mois</small></article>
        <article><span>Statut</span><strong>{statusLabel(current.status)}</strong><small>{current.status==="TRIALING"&&trialDays!=null?`${trialDays} jour${trialDays>1?"s":""} d’essai restant${trialDays>1?"s":""}`:current.cancelAtPeriodEnd?"Résiliation programmée":"Abonnement en cours"}</small></article>
        <article><span>Date d’activation</span><strong>{date(subscriptionStart)}</strong><small>Début de votre abonnement</small></article>
        <article><span>{nextDateLabel}</span><strong>{date(periodEnd)}</strong><small>{remainingDays!=null?`${remainingDays} jour${remainingDays>1?"s":""} restant${remainingDays>1?"s":""}`:"Date non disponible"}</small></article>
      </div>
      <div className={styles.subscriptionMeta}><div><span>Renouvellement</span><b>{current.cancelAtPeriodEnd?"Arrêt programmé":"Automatique"}</b></div><div><span>Période</span><b>{periodStart&&periodEnd?`${date(periodStart)} → ${date(periodEnd)}`:"—"}</b></div>{current.status==="TRIALING"&&<div><span>Fin d’essai</span><b>{date(current.trialEndsAt)}</b></div>}</div>
      {portalMsg&&<div className={`${styles.notice} ${styles.danger}`}>{portalMsg}</div>}
    </section>}

    {billing?.pendingChange&&pendingPlan&&<section className={styles.scheduledChange}>
      <div><span>Changement programmé</span><strong>{current?.plan.name} → {pendingPlan.name}</strong><p>Votre formule actuelle reste active jusqu’au <b>{date(billing.pendingChange.effectiveAt)}</b>. La nouvelle formule sera ensuite appliquée automatiquement.</p></div>
      <button type="button" className={`${styles.button} ${styles.secondary}`} onClick={()=>void cancelScheduledChange()} disabled={changeBusy}>{changeBusy?"Annulation…":"Annuler le changement"}</button>
    </section>}

    {current?.externalProvider==="stripe"&&<section className={`${styles.subscriptionControl} ${current.cancelAtPeriodEnd?styles.subscriptionControlCancel:""}`}>
      <div>
        <span>{current.cancelAtPeriodEnd?"Résiliation programmée":"Gestion du renouvellement"}</span>
        <strong>{current.cancelAtPeriodEnd?`Votre abonnement prendra fin le ${date(periodEnd)}`:"Votre abonnement se renouvelle automatiquement"}</strong>
        <p>{current.cancelAtPeriodEnd?"Vous conservez tous les avantages de votre formule jusqu’à cette date. Vous pouvez annuler la résiliation à tout moment avant la fin de la période.":`La prochaine période commencera le ${date(periodEnd)}. Vous pouvez arrêter le renouvellement sans perdre immédiatement vos avantages actuels.`}</p>
      </div>
      {current.cancelAtPeriodEnd?<button type="button" className={styles.button} onClick={()=>void reactivateSubscription()} disabled={cancelBusy}>{cancelBusy?"Réactivation…":"Réactiver l’abonnement"}</button>:<button type="button" className={`${styles.button} ${styles.cancelSubscriptionButton}`} onClick={()=>setCancelConfirm(true)} disabled={cancelBusy}>{cancelBusy?"Traitement…":"Résilier mon abonnement"}</button>}
      {cancelMsg&&<div className={`${styles.notice} ${styles.danger}`}>{cancelMsg}</div>}
    </section>}

    {current&&<section className={styles.section}>
      <div className={styles.billingHead}><div><span className={styles.kickerDark}>Facturation</span><h2>Factures & paiements</h2><p>Retrouvez vos dernières factures d’abonnement et accédez à votre espace de paiement sécurisé.</p></div>{current.externalProvider==="stripe"&&<button type="button" className={`${styles.button} ${styles.secondary}`} onClick={()=>void openPortal()} disabled={portalBusy}>{portalBusy?"Ouverture…":"Moyen de paiement"}</button>}</div>
      {billing&&current.externalProvider==="stripe"&&<div className={styles.billingSnapshot}>
        <article className={styles.billingSnapshotCard}>
          <span>Moyen de paiement</span>
          <strong>{paymentMethodLabel(billing.paymentMethod)}</strong>
          <small>{billing.paymentMethod?paymentExpiry(billing.paymentMethod):billing.stripeReachable?"Ajoutez ou mettez à jour votre moyen de paiement depuis Stripe.":"Impossible de contacter Stripe pour le moment."}</small>
          <button type="button" onClick={()=>void openPortal()} disabled={portalBusy}>{portalBusy?"Ouverture…":"Modifier sur Stripe"}</button>
        </article>
        <article className={`${styles.billingSnapshotCard} ${styles.billingNextCharge}`}>
          <span>{current.cancelAtPeriodEnd?"Fin de l’abonnement":"Prochain prélèvement"}</span>
          {current.cancelAtPeriodEnd?<><strong>Aucun renouvellement prévu</strong><small>Votre formule reste active jusqu’au {date(periodEnd)}.</small></>:billing.upcomingInvoice?<><strong>{money(billing.upcomingInvoice.amountDueMinor,billing.upcomingInvoice.currency)}</strong><small>Prévu le {date(billing.upcomingInvoice.chargeAt??periodEnd)}{billing.upcomingInvoice.periodStart&&billing.upcomingInvoice.periodEnd?` · période ${date(billing.upcomingInvoice.periodStart)} → ${date(billing.upcomingInvoice.periodEnd)}`:""}</small></>:<><strong>Aperçu indisponible</strong><small>{billing.stripeReachable?`Tarif actuel : ${money(current.plan.monthlyPriceMinor,current.plan.currency)} / mois. Le montant exact sera confirmé par Stripe.`:"Impossible de calculer le prochain prélèvement pour le moment."}</small></>}
        </article>
      </div>}
      {billing===null?<div className={styles.billingEmpty}>Chargement de votre historique de facturation…</div>:billing.invoices.length>0?<div className={styles.invoiceList}>{billing.invoices.map(inv=><article className={styles.invoiceRow} key={inv.id}><div className={styles.invoiceMain}><strong>{inv.number??"Facture Stripe"}</strong><small>{date(inv.createdAt)}{inv.periodStart&&inv.periodEnd?` · ${date(inv.periodStart)} → ${date(inv.periodEnd)}`:""}</small></div><span className={`${styles.invoiceBadge} ${inv.status==="paid"?styles.invoicePaid:inv.status==="open"||inv.status==="uncollectible"?styles.invoiceDue:""}`}>{invoiceStatusLabel(inv.status)}</span><b className={styles.invoiceAmount}>{money(inv.status==="paid"?inv.amountPaidMinor:inv.amountDueMinor,inv.currency)}</b><div className={styles.invoiceActions}>{inv.hostedInvoiceUrl&&<a href={inv.hostedInvoiceUrl} target="_blank" rel="noreferrer">Voir</a>}{inv.invoicePdfUrl&&<a href={inv.invoicePdfUrl} target="_blank" rel="noreferrer">PDF</a>}</div></article>)}</div>:<div className={styles.billingEmpty}><strong>Aucune facture disponible</strong><span>{current.externalProvider==="stripe"?(billing.stripeReachable?"Aucune facture n’a encore été émise pour cet abonnement.":"L’historique Stripe est momentanément indisponible. Réessayez plus tard."):"Votre formule actuelle n’est pas facturée via Stripe. Aucune facture bancaire n’est donc associée pour le moment."}</span></div>}
    </section>}

    {stripeState==="success"&&<div className={styles.notice}>Paiement reçu par Stripe. Votre abonnement est synchronisé automatiquement; l’état affiché peut se mettre à jour dans quelques secondes.</div>}
    {stripeState==="cancelled"&&<div className={styles.notice}>Paiement annulé. Aucune nouvelle formule n’a été activée.</div>}
    {checkoutMsg&&<div className={styles.notice}>{checkoutMsg}</div>}
    {current?.status==="PAST_DUE"&&<div className={`${styles.notice} ${styles.danger}`}>Votre dernier paiement n’a pas abouti. Votre formule reste affichée, mais certaines fonctions pourront être limitées si la situation n’est pas régularisée.</div>}
    {current?.cancelAtPeriodEnd&&<div className={styles.notice}>Votre abonnement est programmé pour s’arrêter à la fin de la période en cours.</div>}
    {current&&<div className={styles.notice}>Un changement de formule utilise toujours votre abonnement Stripe existant afin d’éviter toute double facturation.</div>}

    <details className={styles.section} open={!current}>
      <summary style={{cursor:"pointer",fontWeight:850}}>{current?"Comparer et changer de formule":"Choisir une formule professionnelle"}</summary>
      <section className={`${styles.plans} ${styles.membershipPlans}`} style={{marginTop:18}}>{plans.map(p=>{
        const isCurrent=current?.plan.code===p.code;
        const isDesired=!current&&desiredPlan===p.code;
        const isPending=billing?.pendingChange?.planCode===p.code;
        return <article className={`${styles.plan} ${styles.membershipPlan} ${p.code==="PROFESSIONNEL"?styles.recommendedPlan:""} ${isCurrent||isDesired||isPending?styles.current:""}`} key={p.id}>
          {p.code==="PROFESSIONNEL"&&<span className={styles.recommendedBadge}>Le plus choisi</span>}
          <span className={styles.kicker}>{isCurrent?"Formule actuelle":isPending?"Changement programmé":isDesired?"Votre choix":"Formule"}</span>
          <h2>{p.name}</h2><p className={styles.planPitch}>{planPitch(p.code)}</p><div className={styles.price}>{money(p.monthlyPriceMinor,p.currency)}<small>/mois</small></div>
          <ul className={styles.features}><li>{p.maxActiveListings??"Illimité"} annonces actives</li><li>{p.maxStores} boutique(s)</li><li>Analytics {p.analyticsEnabled?"avancés":"de base"}</li><li>Renouvellement automatique {p.autoRenewListings?"inclus":"non inclus"}</li>{p.featuredCreditsMonthly>0&&<li>{p.featuredCreditsMonthly} crédits À la une / mois</li>}{p.bulkImportEnabled&&<li>Import en masse</li>}{p.prioritySupport&&<li>Support prioritaire</li>}{p.apiFeedEnabled&&<li>Flux API</li>}</ul>
          {isCurrent?<button type="button" className={styles.button} onClick={()=>void openPortal()} disabled={portalBusy}>{portalBusy?"Ouverture…":"Gérer cette formule"}</button>:current?<button type="button" className={styles.button} onClick={()=>current.externalProvider==="stripe"?setChangeTarget(p):void startCheckout(p.code)} disabled={current.cancelAtPeriodEnd||Boolean(billing?.pendingChange)||checkoutBusy!==""}>{current.cancelAtPeriodEnd?"Réactivez d’abord l’abonnement":isPending?"Changement programmé":billing?.pendingChange?"Un changement est déjà prévu":checkoutBusy===p.code?"Ouverture du paiement…":"Changer vers cette formule"}</button>:<button type="button" className={styles.button} onClick={()=>void startCheckout(p.code)} disabled={checkoutBusy!==""}>{checkoutBusy===p.code?"Ouverture du paiement…":"Choisir cette formule"}</button>}
        </article>
      })}</section>
    </details>

    {cancelConfirm&&current&&<div className={styles.planChangeOverlay} role="dialog" aria-modal="true" aria-label="Confirmer la résiliation de l’abonnement">
      <div className={`${styles.planChangeModal} ${styles.cancelModal}`}>
        <div className={styles.planChangeHead}><div><span className={styles.kickerDark}>Résiliation</span><h2>Confirmer la fin de l’abonnement</h2></div><button type="button" onClick={()=>!cancelBusy&&setCancelConfirm(false)} aria-label="Fermer">×</button></div>
        <div className={styles.cancelSummary}>
          <span>Votre formule</span><strong>{current.plan.name}</strong><b>Active jusqu’au {date(periodEnd)}</b>
        </div>
        <div className={styles.planChangeTiming}><strong>Aucune coupure immédiate</strong><p>Votre abonnement restera entièrement actif jusqu’au <b>{date(periodEnd)}</b>. Après cette date, il ne sera plus renouvelé automatiquement. Vous pourrez revenir sur cette décision avant la fin de la période.</p></div>
        {billing?.pendingChange&&<div className={styles.cancelWarning}>Le changement de formule programmé sera annulé en même temps que la résiliation.</div>}
        {cancelMsg&&<div className={`${styles.notice} ${styles.danger}`}>{cancelMsg}</div>}
        <div className={styles.planChangeActions}><button type="button" className={`${styles.button} ${styles.secondary}`} onClick={()=>setCancelConfirm(false)} disabled={cancelBusy}>Conserver mon abonnement</button><button type="button" className={`${styles.button} ${styles.cancelSubscriptionButton}`} onClick={()=>void scheduleCancellation()} disabled={cancelBusy}>{cancelBusy?"Programmation…":"Confirmer la résiliation"}</button></div>
      </div>
    </div>}

    {changeTarget&&current&&<div className={styles.planChangeOverlay} role="dialog" aria-modal="true" aria-label="Confirmer le changement de formule">
      <div className={styles.planChangeModal}>
        <div className={styles.planChangeHead}><div><span className={styles.kickerDark}>Changement de formule</span><h2>Confirmer votre choix</h2></div><button type="button" onClick={()=>!changeBusy&&setChangeTarget(null)} aria-label="Fermer">×</button></div>
        <div className={styles.planChangeCompare}><article><span>Formule actuelle</span><strong>{current.plan.name}</strong><b>{money(current.plan.monthlyPriceMinor,current.plan.currency)}/mois</b></article><i>→</i><article><span>Nouvelle formule</span><strong>{changeTarget.name}</strong><b>{money(changeTarget.monthlyPriceMinor,changeTarget.currency)}/mois</b></article></div>
        <div className={styles.planChangeTiming}><strong>{isTrialChange||isUpgrade?"Application immédiate":"Application en fin de période"}</strong><p>{isTrialChange?"Votre période d’essai continue avec les droits de la nouvelle formule, sans prorata pendant l’essai.":isUpgrade?"Les nouveaux avantages sont activés immédiatement. Stripe calcule automatiquement le montant proratisé restant pour la période en cours.":`Votre formule actuelle reste inchangée jusqu’au ${date(periodEnd)}. Aucun remboursement intermédiaire n’est créé; le nouveau tarif commence au prochain cycle.`}</p></div>
        <div className={styles.planChangePrice}><span>Écart mensuel</span><b className={monthlyDifference>=0?styles.planChangePlus:styles.planChangeMinus}>{monthlyDifference>=0?"+":"−"}{money(Math.abs(monthlyDifference),changeTarget.currency)}/mois</b></div>
        {changeMsg&&<div className={`${styles.notice} ${styles.danger}`}>{changeMsg}</div>}
        <div className={styles.planChangeActions}><button type="button" className={`${styles.button} ${styles.secondary}`} onClick={()=>setChangeTarget(null)} disabled={changeBusy}>Annuler</button><button type="button" className={styles.button} onClick={()=>void confirmPlanChange()} disabled={changeBusy}>{changeBusy?"Mise à jour…":isTrialChange||isUpgrade?"Confirmer et appliquer":"Programmer le changement"}</button></div>
      </div>
    </div>}
  </main></ProfessionalWorkspace>
}