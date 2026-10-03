import { AppIcon } from "./app-icon";
import { EmploiTrackedLink } from "./emploi-analytics";
import { emploiHref, type EmploiFilters } from "./emploi-hub";
import styles from "./france-travail-job-feed.module.css";

type Job={
 id:string;title:string;company:string|null;city:string|null;contract:string|null;
 salary:string|null;description:string|null;publishedAt:string|null;romeCode?:string|null;applyUrl:string;source:"FRANCE_TRAVAIL"
};
type Result={enabled:boolean;items:Job[];page:number;hasMore:boolean};
export async function FranceTravailJobFeed({apiBase,filters}:{apiBase:string;filters:EmploiFilters}){
 let items:Job[]=[],available=true,hasMore=false;
 const isFiltered=Boolean(filters.q||filters.departement||filters.contrat);
 try{
  const params=new URLSearchParams();
  if(filters.q.length>=2)params.set("motsCles",filters.q.trim().slice(0,80));
  if(filters.departement)params.set("departement",filters.departement);
  if(filters.contrat)params.set("typeContrat",filters.contrat);
  if(filters.page>1)params.set("page",String(filters.page));
  const url=apiBase.replace(/\/$/,"")+"/public/emploi/france-travail"+(params.toString()?"?"+params:"");
  const response=await fetch(url,{next:{revalidate:240}});
  if(!response.ok){available=false}
  else{
   const data=await response.json() as Result;
   if(!data.enabled||!Array.isArray(data.items))available=false;
   else{items=data.items.filter(job=>/^[A-Za-z0-9]{6,18}$/.test(job.id)).slice(0,12);hasMore=Boolean(data.hasMore)&&filters.page<5}
  }
 }catch{available=false}
 return <section className={styles.section} id="offres-officielles" aria-label="Offres d'emploi officielles France Travail">
  <div className={styles.heading}>
   <div><p className={styles.kicker}><AppIcon name="circle-check"/> OPPORTUNITÉS OFFICIELLES</p><h2>Les offres France Travail <span>pour vous</span></h2>
    <p>Des annonces actuelles issues du réseau France Travail et de ses partenaires autorisés. Affinez votre recherche grâce aux critères ci-dessus.</p></div>
   <span className={styles.source}><AppIcon name="shield"/> Source : France Travail</span>
  </div>
  {isFiltered&&<div className={styles.activeFilters}><strong>Votre recherche :</strong>{filters.q&&<span><AppIcon name="search"/> {filters.q}</span>}{filters.departement&&<span><AppIcon name="location"/> Département {filters.departement}</span>}{filters.contrat&&<span><AppIcon name="briefcase"/> {filters.contrat==="MIS"?"Intérim":filters.contrat}</span>}<a href="/categorie/emploi#offres-officielles">Effacer les filtres <AppIcon name="xmark"/></a></div>}
  {!available?<div className={styles.empty}><AppIcon name="info"/><div><strong>La recherche officielle est momentanément indisponible.</strong><p>Les annonces déposées directement sur Petit Annonces restent accessibles ci-dessous.</p></div></div>
  :!items.length?<div className={styles.empty}><AppIcon name="search"/><div><strong>Aucune offre trouvée pour ces critères.</strong><p>Essayez un autre métier, un autre département ou retirez un filtre.</p><a href="/categorie/emploi#offres-officielles">Voir toutes les offres</a></div></div>
  :<>
   <div className={styles.resultsHeading}><div><strong>{filters.page>1?"Page "+filters.page+" · ":""}{items.length} offres affichées</strong><small>Ces annonces s’ouvrent sur le site officiel pour postuler.</small></div><span>Actualisation automatique</span></div>
   <div className={styles.grid}>
   {items.map(job=><article className={styles.card} key={job.id}>
    <div className={styles.cardTop}><span className={styles.contract}><AppIcon name="briefcase"/> {job.contract||"Emploi"}</span><span className={styles.location}><AppIcon name="location"/> {job.city||"France"}</span></div>
    <h3>{job.title}</h3>
    <p className={styles.company}><span className={styles.companyIcon}><AppIcon name="store"/></span>{job.company||"Employeur non précisé"}</p>
    {job.description&&<p className={styles.description}>{job.description}</p>}
    {job.romeCode&&<a className={styles.careerLink} href={"/emploi/metiers/"+job.romeCode}><AppIcon name="sparkles"/> Découvrir ce métier</a>}
    <div className={styles.footer}>
     <div>{job.salary&&<span className={styles.salary}>{job.salary}</span>}
       {job.publishedAt&&!Number.isNaN(Date.parse(job.publishedAt))&&<small><AppIcon name="clock"/> {new Date(job.publishedAt).toLocaleDateString("fr-FR",{day:"numeric",month:"short",year:"numeric"})}</small>}
     </div>
     <EmploiTrackedLink href={job.applyUrl} kind="application" label={job.id} external>Voir l’offre <AppIcon name="arrow-right"/></EmploiTrackedLink>
    </div>
   </article>)}
   </div>
   {(filters.page>1||hasMore)&&<nav className={styles.pagination} aria-label="Pagination des offres France Travail">
     {filters.page>1?<a href={emploiHref({...filters,page:filters.page-1})}><AppIcon name="arrow-left"/> Précédent</a>:<span/>}
     <span>Page {filters.page}</span>
     {hasMore?<a href={emploiHref({...filters,page:filters.page+1})}>Plus d'offres <AppIcon name="arrow-right"/></a>:<span/>}
   </nav>}
  </>}
  <p className={styles.notice}><AppIcon name="shield"/> Source France Travail. Les offres sont distinctes des annonces déposées sur Petit Annonces. La candidature est gratuite et s'effectue via France Travail. Vérifiez les conditions et la disponibilité sur le site officiel.</p>
 </section>
}

const careers=[
 {code:"M1607",name:"Assistanat administratif",icon:"briefcase" as const},
 {code:"M1805",name:"Développement informatique",icon:"laptop" as const},
 {code:"G1602",name:"Cuisine et restauration",icon:"store" as const},
 {code:"F1703",name:"Maçonnerie",icon:"tools" as const},
 {code:"N4101",name:"Transport de marchandises",icon:"truck" as const}
];
export function CareerDiscovery(){
 return <section className={styles.careerSection} id="metiers" aria-label="Découvrir les métiers et compétences">
  <div className={styles.heading}><div><p className={styles.kicker}><AppIcon name="sparkles"/> ORIENTATION PROFESSIONNELLE</p><h2>Découvrir les <span>métiers</span></h2><p>Comprendre les missions, les compétences et les formations utiles avec le référentiel officiel ROME 4.0 de France Travail.</p></div>
   <span className={styles.source}>Référentiel ROME 4.0</span>
  </div>
  <div className={styles.careerGrid}>{careers.map(x=><a href={"/emploi/metiers/"+x.code} key={x.code} className={styles.careerCard}>
   <span className={styles.careerSymbol}><AppIcon name={x.icon}/></span><span><strong>{x.name}</strong><small>Code ROME {x.code} · Fiche métier</small></span><AppIcon name="arrow-right"/>
  </a>)}</div>
  <p className={styles.notice}>Source : France Travail · Répertoire ROME 4.0. Les fiches de métiers ne sont pas des offres d'emploi.</p>
 </section>
}
