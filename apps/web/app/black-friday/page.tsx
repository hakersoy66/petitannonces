import type { Metadata } from "next";
import {notFound} from "next/navigation";
import styles from "./page.module.css";

export const metadata:Metadata={
  title:"Black Friday | PetitAnnonces.fr",
  description:"Découvrez les offres Black Friday des vendeurs sur PetitAnnonces.fr et les avantages proposés aux comptes professionnels.",
  alternates:{canonical:"/black-friday"},
  openGraph:{title:"Black Friday | PetitAnnonces.fr",description:"La sélection spéciale Black Friday, partout en France.",url:"/black-friday"},
};
export const dynamic="force-dynamic";
type Item={id:string;slug:string;title:string;priceMinor:number;currency:string;city:string|null;imageUrl:string|null;referencePriceMinor?:number|null;category:{name:string;slug:string}};
type Data={phase:"disabled"|"upcoming"|"active"|"ended";enabled:boolean;visible:boolean;edition:number;
 startsAt:string;endsAt:string;discountPercent:number;giftMonthsMultiplier:number;maxPrepaidMonths:number;items:Item[];total:number};
async function getCampaign():Promise<Data>{
  const base=(process.env.API_INTERNAL_URL??process.env.NEXT_PUBLIC_API_URL??"http://127.0.0.1:4000").replace(/\/$/,"");
  try{
    const res=await fetch(base+"/public/black-friday",{cache:"no-store"});
    if(!res.ok)throw Error("Campaign service unavailable");
    return await res.json() as Data;
  }catch{return{phase:"disabled",enabled:false,visible:false,edition:2026,startsAt:"",endsAt:"",discountPercent:0,giftMonthsMultiplier:0,maxPrepaidMonths:0,items:[],total:0}}
}
type PublicProPlan={code:string;name:string;monthlyPriceMinor:number;currency:string;maxActiveListings:number|null;maxStores:number;bulkImportEnabled:boolean};
async function getPublicProPlans():Promise<PublicProPlan[]>{
 const base=(process.env.API_INTERNAL_URL??process.env.NEXT_PUBLIC_API_URL??"http://127.0.0.1:4000").replace(/\/$/,"");
 try{
  const res=await fetch(base+"/pro/plans",{cache:"no-store"});
  if(!res.ok)return [];
  const data=await res.json() as {plans?:PublicProPlan[]};
  return Array.isArray(data.plans)?data.plans.filter(p=>p.currency==="EUR"&&/^[A-Z0-9_-]{2,60}$/.test(p.code)&&Number.isInteger(p.monthlyPriceMinor)&&p.monthlyPriceMinor>=0).sort((a,b)=>a.monthlyPriceMinor-b.monthlyPriceMinor).slice(0,3):[];
 }catch{return []}
}
const euro=(minor:number)=>new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR"}).format(minor/100);
const paris=(date:Date,options:Intl.DateTimeFormatOptions)=>new Intl.DateTimeFormat("fr-FR",{timeZone:"Europe/Paris",...options}).format(date);
const parisDate=(value:string)=>paris(new Date(value),{day:"numeric",month:"long",year:"numeric"});
const endDay=(value:string)=>parisDate(new Date(Date.parse(value)-1000).toISOString());
const blackFridayDay=(edition:number)=>{const d=new Date(Date.UTC(edition,10,30));d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+2)%7));return d};
const categories=[
  {label:"High-tech",href:"/categorie/high-tech",icon:"⌁"},
  {label:"Maison & jardin",href:"/categorie/maison-jardin",icon:"⌂"},
  {label:"Mode",href:"/categorie/mode",icon:"✦"},
  {label:"Enfants & bébé",href:"/categorie/enfants-bebe",icon:"♡"},
];
export default async function BlackFridayPage(){
  const data=await getCampaign();
  if(!data.enabled)notFound();
  const live=data.phase==="active";
  const proPlans=data.giftMonthsMultiplier>0?await getPublicProPlans():[];
  const from=parisDate(data.startsAt),to=endDay(data.endsAt);
  const dayBlackFriday=parisDate(blackFridayDay(data.edition).toISOString());
  const startDay=paris(new Date(data.startsAt),{day:"numeric",month:"long"});
  const lastDay=paris(new Date(Date.parse(data.endsAt)-1000),{day:"numeric",month:"long"});
  return <main className={styles.page}>
    <div className={styles.shell}>
      <section className={styles.hero}>
        <div className={styles.visual} aria-hidden="true"><div className={styles.ring}/><div className={styles.seal}><span>BLACK</span><strong>FRIDAY</strong><i>{data.edition}</i></div></div>
        <div className={styles.heroText}>
          <span className={styles.eyebrow}>PETITANNONCES.FR · ÉDITION {data.edition}</span>
          <h1>BLACK <span>FRIDAY</span></h1>
          <p className={styles.lead}>Les bonnes affaires se préparent ici.</p>
          <p className={styles.description}>Du <strong>{from} au {to}</strong>, retrouvez une sélection d’annonces proposée par les vendeurs particuliers et professionnels partout en France.</p>
          <div className={styles.heroActions}><a href={live?"#selection":"/mon-compte/annonces"} className={styles.gold}>{live?"Explorer la sélection":"Inscrire mes annonces"} <span aria-hidden="true">→</span></a><a href="/deposer-annonce-gratuite" className={styles.outline}>Déposer une annonce</a></div>
          <span className={styles.hint}>{live?"La sélection est ouverte":data.phase==="ended"?"Événement terminé":"Les vendeurs peuvent déjà inscrire leurs annonces"} · {startDay} – {lastDay}</span>
        </div>
      </section>
      <section className={styles.milestones} aria-label="Dates de l’événement">
        <div><small>DÈS MAINTENANT</small><strong>Préparez vos annonces</strong><span>Inscription gratuite à la sélection</span></div>
        <div><small>{startDay.toUpperCase()}</small><strong>Ouverture de la sélection</strong><span>Découvrez les publications participantes</span></div>
        <div><small>{dayBlackFriday.toUpperCase()}</small><strong>Black Friday</strong><span>Le rendez-vous shopping</span></div>
        <div><small>{lastDay.toUpperCase()}</small><strong>Fin de l’événement</strong><span>Dernier jour de l’offre</span></div>
      </section>
      <section className={styles.selection} id="selection">
        <div className={styles.sectionHead}><div><span className={styles.sectionKicker}>LA SÉLECTION PETIT ANNONCES</span><h2>{live?"Découvrez les annonces participantes":"Une sélection en préparation"}</h2><p>{live?"Des annonces publiées par de vrais vendeurs, à découvrir directement.":"Les vendeurs préparent leur sélection. Les annonces seront présentées ici dès le "+startDay+"."}</p></div><a href="/mon-compte/annonces">Je suis vendeur <span aria-hidden="true">→</span></a></div>
        {live && data.items.length>0?<div className={styles.cards}>{data.items.map(item=><a key={item.id} className={styles.card} href={"/annonce/"+encodeURIComponent(item.slug)}><div className={styles.photo}>{item.imageUrl?<img src={item.imageUrl} alt={item.title} loading="lazy"/>:<span>{item.category.name}</span>}<em>Sélection Black Friday</em></div><div className={styles.cardText}><small>{item.category.name}</small><h3>{item.title}</h3><div className={styles.priceInfo}>
          {item.referencePriceMinor!=null&&<div className={styles.referencePrice}><del>{(item.referencePriceMinor/100).toLocaleString("fr-FR",{style:"currency",currency:"EUR"})}</del><em>Prix antérieur constaté</em></div>}
          <b>{(item.priceMinor/100).toLocaleString("fr-FR",{style:"currency",currency:"EUR"})}</b>
        </div><p>{item.city??"France"}</p></div></a>)}</div>:<div className={styles.empty}><div className={styles.emptySymbol}>✦</div><h3>{live?"Les premières annonces arrivent":data.phase==="ended"?"Cette édition est terminée":"Rendez-vous le "+startDay+" !"}</h3><p>{live?"Aucune annonce participante pour le moment. Revenez découvrir la sélection.":"En attendant, préparez vos meilleures annonces et rejoignez l’événement."}</p><a href="/mon-compte/annonces">Proposer une annonce <span aria-hidden="true">→</span></a></div>}
      </section>
      <section className={styles.categories}><div className={styles.sectionHead}><div><span className={styles.sectionKicker}>DÉCOUVRIR</span><h2>Explorez vos catégories préférées</h2><p>Vous pouvez aussi parcourir toutes les annonces, avant même le début de l’événement.</p></div></div><div className={styles.categoryGrid}>{categories.map(cat=><a href={cat.href} key={cat.href}><span>{cat.icon}</span><strong>{cat.label}</strong><span aria-hidden="true">→</span></a>)}</div></section>
      {data.discountPercent>0&&<section className={styles.boost}>
        <div className={styles.boostCopy}>
          <span className={styles.sectionKicker}>OFFRE SPÉCIALE VENDEURS · {startDay.toUpperCase()} – {lastDay.toUpperCase()}</span>
          <h2>Plus de visibilité pour vos annonces.</h2>
          <p>Pendant l’événement, profitez de <strong>-{data.discountPercent} % sur les options de visibilité participantes</strong>. Le tarif réduit est automatiquement appliqué au moment du paiement, pendant la période de campagne, sans code promo. Non cumulable avec un autre code de réduction.</p>
          <small>Le prix final, remisé sur les options participantes, s’affiche avant le paiement.</small>
        </div>
        <a href="/mon-compte/visibilite">Découvrir les mises en avant →</a>
      </section>}
      {data.giftMonthsMultiplier>0&&<section className={styles.proOffer} aria-labelledby="black-friday-pro-title">
        <div className={styles.proOfferContent}>
          <span className={styles.proLabel}>BLACK FRIDAY · ABONNEMENTS PRO</span>
          <h2 id="black-friday-pro-title">Votre abonnement Pro : 1 mois acheté = {data.giftMonthsMultiplier} mois offert{data.giftMonthsMultiplier>1?"s":""} !</h2>
          <p className={styles.proIntro}>Cette offre concerne l’achat de <strong>forfaits d’abonnement professionnel Petitannonces</strong> : choisissez votre formule Pro et profitez de mois supplémentaires offerts.</p>
          <div className={styles.proExamples} aria-label="Exemples de durées d’abonnement Pro">
            <div><strong>1 mois payé</strong><b>+ {data.giftMonthsMultiplier} mois offert{data.giftMonthsMultiplier>1?"s":""}</b></div>
            <div><strong>3 mois payés</strong><b>+ {3*data.giftMonthsMultiplier} mois offerts</b></div>
            <div><strong>Jusqu’à {data.maxPrepaidMonths} mois payés</strong><b>+ {data.maxPrepaidMonths*data.giftMonthsMultiplier} mois offerts</b></div>
          </div>
          <div className={styles.proTrial}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="7" width="18" height="14" rx="2"/><path d="M12 7v14M3 12h18M12 7c-7 0-7-5-4-5 2 0 4 3 4 5Zm0 0c7 0 7-5 4-5-2 0-4 3-4 5Z"/></svg>
            <p><strong>Nouveau professionnel ? Vos 90 premiers jours Pro sont offerts !</strong><br/>Essai gratuit sans carte bancaire pour les nouveaux comptes éligibles. Si vous achetez un abonnement Black Friday pendant l’essai, ses mois payés et offerts commenceront après ces 90 jours : votre essai est conservé.</p>
          </div>
          <small>Paiement unique du forfait Black Friday, sans renouvellement mensuel automatique. Offre valable du {from} au {to}. L’essai de 90 jours est soumis aux conditions d’éligibilité des nouveaux comptes Pro.</small>
        </div>
        <div className={styles.proOfferActions}>
          <a href="#forfaits-pro">Comparer les abonnements Pro <span aria-hidden="true">→</span></a>
          <a className={styles.proTrialLink} href="/ouvrir-boutique-pro">Découvrir les 90 jours offerts <span aria-hidden="true">→</span></a>
        </div>
      </section>}
      {data.giftMonthsMultiplier>0&&<section className={styles.proPlansPublic} id="forfaits-pro" aria-labelledby="forfaits-pro-title">
        <div className={styles.sectionHead}><div><span className={styles.sectionKicker}>FORFAITS PROFESSIONNELS</span>
          <h2 id="forfaits-pro-title">Comparez les abonnements Pro</h2>
          <p>Choisissez un forfait, puis profitez de l’offre Black Friday durant la période de la campagne.</p>
        </div></div>
        {proPlans.length>0?<div className={styles.publicPlanGrid}>{proPlans.map(plan=>{
          const next="/espace-pro/abonnement?plan="+encodeURIComponent(plan.code)+"#offre-black-friday";
          return <article key={plan.code} className={styles.publicPlanCard}>
            <span className={styles.publicPlanLabel}>ABONNEMENT PRO</span>
            <h3>{plan.name}</h3>
            <div className={styles.publicPlanPrice}><strong>{euro(plan.monthlyPriceMinor)}</strong><span>/ mois payé</span></div>
            <div className={styles.publicPlanGift}>1 mois payé = {1+data.giftMonthsMultiplier} mois d’accès</div>
            <ul>
              <li>{plan.maxActiveListings==null?"Annonces illimitées":plan.maxActiveListings+" annonces actives"}</li>
              <li>{plan.maxStores} boutique{plan.maxStores>1?"s":""} professionnelle{plan.maxStores>1?"s":""}</li>
              <li>{plan.bulkImportEnabled?"Import en masse inclus":"Gestion des annonces depuis l’espace Pro"}</li>
            </ul>
            <a href={"/inscription?type=pro&next="+encodeURIComponent(next)}>Créer mon compte Pro <span aria-hidden="true">→</span></a>
          </article>;
        })}</div>:<p className={styles.publicPlansUnavailable}>Les tarifs sont momentanément indisponibles. Retrouvez les formules depuis votre espace professionnel.</p>}
        <div className={styles.publicPlanFoot}><div><strong>Vous possédez déjà un compte Pro ?</strong><p>Accédez aux abonnements pour choisir la durée et consulter vos droits existants.</p></div>
          <a href="/espace-pro/abonnement#offre-black-friday">Accéder à mes abonnements →</a>
        </div>
        <p className={styles.publicPlanConditions}>Les 90 jours d’essai gratuits sont réservés aux nouveaux comptes éligibles. Les mois achetés ou offerts ne remplacent pas les jours d’essai. Les paiements Black Friday ne commencent que le {from}.</p>
      </section>}
      <section className={styles.seller}><div><span>VOUS VENDEZ SUR PETIT ANNONCES ?</span><h2>Faites découvrir vos annonces pendant le Black Friday.</h2><p>La participation à cette sélection est gratuite. Seules les annonces actives éligibles sont présentées, et aucune réduction de prix n’est inventée.</p></div><a href="/mon-compte/annonces">Gérer mes participations →</a></section>
      <p className={styles.legal}>La participation à la sélection Black Friday ne garantit pas une réduction de prix. Les prix affichés restent fixés par les vendeurs. Pour toute annonce de réduction de prix, les professionnels doivent respecter notamment la règle du prix le plus bas des 30 jours précédents (<a href="https://www.economie.gouv.fr/dgccrf/les-fiches-pratiques/annonces-de-reduction-de-prix-ce-que-vous-devez-savoir">DGCCRF</a>). Les ventes restent soumises aux conditions habituelles de Petit Annonces.</p>
    </div>
  </main>;
}
