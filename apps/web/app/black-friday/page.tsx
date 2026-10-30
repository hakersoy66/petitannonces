import type { Metadata } from "next";
import styles from "./page.module.css";

export const metadata:Metadata={
  title:"Black Friday 2026 | PetitAnnonces.fr",
  description:"Du 20 au 30 novembre 2026, découvrez la sélection Black Friday des vendeurs sur PetitAnnonces.fr. Préparez vos annonces dès maintenant.",
  alternates:{canonical:"/black-friday"},
  openGraph:{title:"Black Friday 2026 | PetitAnnonces.fr",description:"La sélection spéciale Black Friday, partout en France.",url:"/black-friday"},
};
export const revalidate=60;
type Item={id:string;slug:string;title:string;priceMinor:number;currency:string;city:string|null;imageUrl:string|null;referencePriceMinor?:number|null;category:{name:string;slug:string}};
type Data={phase:"upcoming"|"active"|"ended";items:Item[];total:number};
async function getCampaign():Promise<Data>{
  const base=(process.env.API_INTERNAL_URL??process.env.NEXT_PUBLIC_API_URL??"http://127.0.0.1:4000").replace(/\/$/,"");
  try{
    const res=await fetch(base+"/public/black-friday",{next:{revalidate:60}});
    if(!res.ok)return{phase:"upcoming",items:[],total:0};
    return await res.json() as Data;
  }catch{return{phase:"upcoming",items:[],total:0}}
}
const categories=[
  {label:"High-tech",href:"/categorie/high-tech",icon:"⌁"},
  {label:"Maison & jardin",href:"/categorie/maison-jardin",icon:"⌂"},
  {label:"Mode",href:"/categorie/mode",icon:"✦"},
  {label:"Enfants & bébé",href:"/categorie/enfants-bebe",icon:"♡"},
];
export default async function BlackFridayPage(){
  const data=await getCampaign();
  const live=data.phase==="active";
  return <main className={styles.page}>
    <div className={styles.shell}>
      <section className={styles.hero}>
        <div className={styles.visual} aria-hidden="true"><div className={styles.ring}/><div className={styles.seal}><span>BLACK</span><strong>FRIDAY</strong><i>2026</i></div></div>
        <div className={styles.heroText}>
          <span className={styles.eyebrow}>PETITANNONCES.FR · ÉDITION 2026</span>
          <h1>BLACK <span>FRIDAY</span></h1>
          <p className={styles.lead}>Les bonnes affaires se préparent ici.</p>
          <p className={styles.description}>Du <strong>20 au 30 novembre 2026</strong>, retrouvez une sélection d’annonces proposée par les vendeurs particuliers et professionnels partout en France.</p>
          <div className={styles.heroActions}><a href={live?"#selection":"/mon-compte/annonces"} className={styles.gold}>{live?"Explorer la sélection":"Inscrire mes annonces"} <span aria-hidden="true">→</span></a><a href="/deposer-annonce-gratuite" className={styles.outline}>Déposer une annonce</a></div>
          <span className={styles.hint}>{live?"La sélection est ouverte":"Les vendeurs peuvent déjà inscrire leurs annonces"} · 20–30 novembre</span>
        </div>
      </section>
      <section className={styles.milestones} aria-label="Dates de l’événement">
        <div><small>DÈS MAINTENANT</small><strong>Préparez vos annonces</strong><span>Inscription gratuite à la sélection</span></div>
        <div><small>20 NOVEMBRE</small><strong>Ouverture de la sélection</strong><span>Découvrez les publications participantes</span></div>
        <div><small>27 NOVEMBRE</small><strong>Black Friday</strong><span>Le rendez-vous shopping</span></div>
        <div><small>30 NOVEMBRE</small><strong>Cyber Monday</strong><span>Dernier jour de l’événement</span></div>
      </section>
      <section className={styles.selection} id="selection">
        <div className={styles.sectionHead}><div><span className={styles.sectionKicker}>LA SÉLECTION PETIT ANNONCES</span><h2>{live?"Découvrez les annonces participantes":"Une sélection en préparation"}</h2><p>{live?"Des annonces publiées par de vrais vendeurs, à découvrir directement.":"Les vendeurs préparent leur sélection. Les annonces seront présentées ici dès le 20 novembre."}</p></div><a href="/mon-compte/annonces">Je suis vendeur <span aria-hidden="true">→</span></a></div>
        {live && data.items.length>0?<div className={styles.cards}>{data.items.map(item=><a key={item.id} className={styles.card} href={"/annonce/"+encodeURIComponent(item.slug)}><div className={styles.photo}>{item.imageUrl?<img src={item.imageUrl} alt={item.title} loading="lazy"/>:<span>{item.category.name}</span>}<em>Sélection Black Friday</em></div><div className={styles.cardText}><small>{item.category.name}</small><h3>{item.title}</h3><div className={styles.priceInfo}>
          {item.referencePriceMinor!=null&&<div className={styles.referencePrice}><del>{(item.referencePriceMinor/100).toLocaleString("fr-FR",{style:"currency",currency:"EUR"})}</del><em>Prix antérieur constaté</em></div>}
          <b>{(item.priceMinor/100).toLocaleString("fr-FR",{style:"currency",currency:"EUR"})}</b>
        </div><p>{item.city??"France"}</p></div></a>)}</div>:<div className={styles.empty}><div className={styles.emptySymbol}>✦</div><h3>{live?"Les premières annonces arrivent":"Rendez-vous le 20 novembre !"}</h3><p>{live?"Aucune annonce participante pour le moment. Revenez découvrir la sélection.":"En attendant, préparez vos meilleures annonces et rejoignez l’événement."}</p><a href="/mon-compte/annonces">Proposer une annonce <span aria-hidden="true">→</span></a></div>}
      </section>
      <section className={styles.categories}><div className={styles.sectionHead}><div><span className={styles.sectionKicker}>DÉCOUVRIR</span><h2>Explorez vos catégories préférées</h2><p>Vous pouvez aussi parcourir toutes les annonces, avant même le début de l’événement.</p></div></div><div className={styles.categoryGrid}>{categories.map(cat=><a href={cat.href} key={cat.href}><span>{cat.icon}</span><strong>{cat.label}</strong><span aria-hidden="true">→</span></a>)}</div></section>
      <section className={styles.boost}>
        <div className={styles.boostCopy}>
          <span className={styles.sectionKicker}>OFFRE SPÉCIALE VENDEURS · 20–30 NOVEMBRE</span>
          <h2>Plus de visibilité pour vos annonces.</h2>
          <p>Pendant l’événement, profitez de <strong>-30 % sur Urgent (7 jours) et À la une (7 jours)</strong>. Le tarif réduit est automatiquement appliqué au moment du paiement, du 20 au 30 novembre inclus, sans code promo. Non cumulable avec un autre code de réduction.</p>
          <small>Urgent : 2,09 € au lieu de 2,99 € · À la une : 4,89 € au lieu de 6,99 €</small>
        </div>
        <a href="/mon-compte/visibilite">Découvrir les mises en avant →</a>
      </section>
      <section className={styles.seller}><div><span>VOUS VENDEZ SUR PETIT ANNONCES ?</span><h2>Faites découvrir vos annonces pendant le Black Friday.</h2><p>La participation à cette sélection est gratuite. Seules les annonces actives éligibles sont présentées, et aucune réduction de prix n’est inventée.</p></div><a href="/mon-compte/annonces">Gérer mes participations →</a></section>
      <p className={styles.legal}>La participation à la sélection Black Friday ne garantit pas une réduction de prix. Les prix affichés restent fixés par les vendeurs. Pour toute annonce de réduction de prix, les professionnels doivent respecter notamment la règle du prix le plus bas des 30 jours précédents (<a href="https://www.economie.gouv.fr/dgccrf/les-fiches-pratiques/annonces-de-reduction-de-prix-ce-que-vous-devez-savoir">DGCCRF</a>). Les ventes restent soumises aux conditions habituelles de Petit Annonces.</p>
    </div>
  </main>;
}
