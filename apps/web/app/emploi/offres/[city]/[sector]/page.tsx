import type {Metadata} from "next";
import Link from "next/link";
import {notFound} from "next/navigation";
import {EMPLOI_LOCAL_LANDINGS,emploiLocalLanding,emploiLocalHref} from "../../../../../lib/emploi-local";
import {EmploiJobAlert} from "../../../../../components/emploi-job-alert";
import styles from "./page.module.css";

export const revalidate=1200;
type Props={params:Promise<{city:string;sector:string}>};
type Job={id:string;title:string;company:string|null;city:string|null;contract:string|null;publishedAt:string|null;romeCode:string|null;description:string|null;applyUrl:string};
type JobResult={enabled:boolean;items:Job[]};
const apiBase=()=>String(process.env.API_INTERNAL_URL??process.env.NEXT_PUBLIC_API_URL??"http://127.0.0.1:4000").replace(/\/$/,"");
async function jobs(city:string,sector:string){
 const config=emploiLocalLanding(city,sector);
 if(!config)return {config:null,offers:[] as Job[],available:false};
 try{
  const q=new URLSearchParams({motsCles:config.term,departement:config.department});
  const response=await fetch(apiBase()+"/public/emploi/france-travail?"+q,{next:{revalidate:1200}});
  if(!response.ok)return{config,offers:[] as Job[],available:false};
  const payload=await response.json() as JobResult;
  const offers=payload.enabled&&Array.isArray(payload.items)?payload.items.filter(x=>x.id&&x.title):[];
  return{config,offers,available:true};
 }catch{return{config,offers:[] as Job[],available:false}}
}
export function generateStaticParams(){return EMPLOI_LOCAL_LANDINGS.map(x=>({city:x.city,sector:x.sector}))}
export async function generateMetadata({params}:Props):Promise<Metadata>{
 const {city,sector}=await params;const {config,offers}=await jobs(city,sector);
 if(!config)return{title:"Emploi en France",robots:{index:false,follow:false}};
 const title="Offres d'emploi "+config.role+" à "+config.cityName+" ("+config.department+")";
 return{title,description:"Consultez les offres "+config.role.toLowerCase()+" dans le département "+config.department+" autour de "+config.cityName+". Contrats CDI, CDD et intérim selon les offres France Travail disponibles.",robots:{index:offers.length>0,follow:true},alternates:{canonical:emploiLocalHref(config)},openGraph:{title}};
}
export default async function Page({params}:Props){
 const {city,sector}=await params;
 const {config,offers,available}=await jobs(city,sector);
 if(!config)notFound();
 const filter={q:config.term,departement:config.department,contrat:"" as const,page:1};
 const q=new URLSearchParams({ft_q:config.term,ft_dept:config.department});
 const others=EMPLOI_LOCAL_LANDINGS.filter(x=>x.city!==city||x.sector!==sector).slice(0,6);
 return <main className={styles.shell}>
  <nav className={styles.crumb} aria-label="Fil d'Ariane"><Link href="/">Accueil</Link><span>›</span><Link href="/categorie/emploi">Emploi</Link><span>›</span><span>{config.area}</span></nav>
  <section className={styles.hero}><div className={styles.badge}>EMPLOI LOCAL · FRANCE TRAVAIL</div>
   <h1>Offres d'emploi <em>{config.role.toLowerCase()}</em><br/>à {config.cityName}</h1>
   <p>Explorez les opportunités en {config.area}. Toutes les annonces ci-dessous proviennent de la recherche France Travail pour le département {config.department}; certaines peuvent se trouver ailleurs dans ce département.</p>
   <div className={styles.actions}><Link href={"/categorie/emploi?"+q.toString()+"#offres-officielles"}>Affiner ma recherche ↗</Link><Link href="/categorie/emploi">Tous les métiers</Link></div>
  </section>
  <EmploiJobAlert filters={filter}/>
  <section className={styles.results}><div className={styles.sectionHead}><div><span>OPPORTUNITÉS OFFICIELLES</span><h2>{available?offers.length+" offres récentes affichées":"Offres temporairement indisponibles"}</h2></div><p>Source : France Travail · Actualisation périodique</p></div>
    {!offers.length?<div className={styles.empty}>{available?"Aucune offre n'est affichée actuellement pour ces critères. Élargissez la recherche pour découvrir davantage d'opportunités.":"La source France Travail est temporairement indisponible. Consultez toutes les offres depuis le moteur de recherche."}</div>:
    <div className={styles.grid}>{offers.map(o=><article className={styles.card} key={o.id}>
     <div className={styles.cardHeader}><span>{o.contract??"Emploi"}</span><small>{o.city??"Département "+config.department}</small></div>
     <h3>{o.title}</h3><p className={styles.company}>{o.company??"Employeur non précisé"}</p>
     {o.description&&<p className={styles.description}>{o.description}</p>}
     <div className={styles.footer}>{o.romeCode?<Link href={"/emploi/metiers/"+o.romeCode}>Découvrir ce métier</Link>:<span/>}<a href={o.applyUrl} target="_blank" rel="noopener noreferrer">Consulter l'offre ↗</a></div>
    </article>)}</div>}
    <p className={styles.legal}>Les offres sont consultées en temps réel ou après une actualisation récente de la source France Travail. La candidature et ses modalités se déroulent sur la plateforme officielle.</p>
  </section>
  <section className={styles.guide}><h2>Comment rechercher un emploi {config.role.toLowerCase()} autour de {config.cityName} ?</h2>
   <p>Consultez les offres disponibles dans le département {config.department}, vérifiez le lieu de travail exact, la durée du contrat et les compétences attendues. Pour élargir les résultats, retirez le filtre de département ou essayez des intitulés de métier voisins.</p>
   <p>Une alerte emploi enregistrée permet de recevoir les nouvelles offres correspondant à votre métier et à votre département selon vos préférences de notification. Elle peut être désactivée depuis votre espace personnel.</p>
   <h3>Découvrez également</h3><div className={styles.related}>{others.map(x=><Link href={emploiLocalHref(x)} key={x.city+"-"+x.sector}>{x.role} · {x.cityName} <span>↗</span></Link>)}</div>
  </section>
 </main>
}
