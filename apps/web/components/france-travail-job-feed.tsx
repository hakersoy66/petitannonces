import styles from "./france-travail-job-feed.module.css";

type Job={
 id:string;title:string;company:string|null;city:string|null;contract:string|null;
 salary:string|null;description:string|null;publishedAt:string|null;romeCode?:string|null;applyUrl:string;source:"FRANCE_TRAVAIL"
};
type Result={enabled:boolean;items:Job[]};

export async function FranceTravailJobFeed({apiBase}:{apiBase:string}){
 let items:Job[]=[];
 try{
  const reply=await fetch(apiBase.replace(/\/$/,"")+"/public/emploi/france-travail",{next:{revalidate:300}});
  if(!reply.ok)return null;
  const data=await reply.json() as Result;
  if(!data.enabled||!Array.isArray(data.items))return null;
  items=data.items.filter(job=>/^[A-Za-z0-9]{6,18}$/.test(job.id)).slice(0,20);
 }catch{return null}
 if(!items.length)return null;
 return <section className={styles.section} aria-label="Offres d'emploi France Travail">
  <div className={styles.heading}>
   <div><p className={styles.kicker}>EMPLOI · SOURCE OFFICIELLE</p><h2>Offres d’emploi France Travail</h2>
    <p>Offres publiques actualisées, proposées en complément des annonces déposées sur Petit Annonces. Les candidatures se font sur le site officiel.</p></div>
   <span className={styles.source}>Source : France Travail</span>
  </div>
  <div className={styles.grid}>
   {items.map(job=><article className={styles.card} key={job.id}>
    <div className={styles.cardTop}><span className={styles.contract}>{job.contract||"Offre d’emploi"}</span>{job.city&&<span className={styles.city}>{job.city}</span>}</div>
    <h3>{job.title}</h3>
    <p className={styles.company}>{job.company||"Employeur non précisé"}</p>
    {job.description&&<p className={styles.description}>{job.description}</p>}
    {job.romeCode&&<a className={styles.careerLink} href={"/emploi/metiers/"+job.romeCode}>Découvrir ce métier · ROME {job.romeCode} ↗</a>}
    <div className={styles.footer}>
     <div>{job.salary&&<span className={styles.salary}>{job.salary}</span>}
       {job.publishedAt&&<small>Publiée le {new Date(job.publishedAt).toLocaleDateString("fr-FR",{day:"2-digit",month:"short",year:"numeric"})}</small>}
     </div>
     <a href={job.applyUrl} rel="noopener noreferrer" target="_blank" aria-label={"Voir l’offre officielle "+job.title}>Voir l’offre ↗</a>
    </div>
   </article>)}
  </div>
  <p className={styles.notice}>Ces offres proviennent de France Travail et ne sont pas déposées par des vendeurs de Petit Annonces. Vérifiez les conditions de candidature et la disponibilité sur le site officiel. Aucun frais n’est demandé pour postuler.</p>
 </section>
}

const careers=[
 {code:"M1607",name:"Assistanat administratif",icon:"✦"},
 {code:"M1805",name:"Développement informatique",icon:"⌘"},
 {code:"G1602",name:"Cuisine et restauration",icon:"◈"},
 {code:"F1703",name:"Maçonnerie",icon:"⬡"},
 {code:"N4101",name:"Transport de marchandises",icon:"↗"}
];
export function CareerDiscovery(){
 return <section className={styles.careerSection} aria-label="Découvrir les métiers et compétences">
  <div className={styles.heading}><div><p className={styles.kicker}>ORIENTATION · ROME 4.0</p><h2>Découvrir les métiers</h2><p>Comprendre les missions, les compétences et les voies d’accès aux métiers avec le référentiel officiel France Travail.</p></div>
   <span className={styles.source}>Référentiel ROME 4.0</span>
  </div>
  <div className={styles.careerGrid}>{careers.map(x=><a href={"/emploi/metiers/"+x.code} key={x.code} className={styles.careerCard}>
   <span className={styles.careerSymbol}>{x.icon}</span><span><strong>{x.name}</strong><small>Code ROME {x.code} · Consulter la fiche</small></span><span aria-hidden>↗</span>
  </a>)}</div>
  <p className={styles.notice}>Référentiel France Travail sous Licence Ouverte. Les fiches de métiers ne sont pas des offres d'emploi.</p>
 </section>
}
