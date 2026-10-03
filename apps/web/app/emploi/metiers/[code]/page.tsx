import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import styles from "./page.module.css";

export const revalidate=3600;
type Role={
 code:string;name:string;definition:string|null;access:string|null;domain:string|null;
 appellations:string[];skills:string[];knowledge:string[];source:string
};
type Props={params:Promise<{code:string}>};
const apiBase=()=>String(process.env.API_INTERNAL_URL??process.env.NEXT_PUBLIC_API_URL??"http://127.0.0.1:4000").replace(/\/$/,"");
const isCode=(code:string)=>/^[A-Z][0-9]{4}$/.test(code);
async function load(code:string):Promise<{role:Role|null;temporary:boolean}>{
 if(!isCode(code))return{role:null,temporary:false};
 try{
  const result=await fetch(apiBase()+"/public/emploi/rome/metiers/"+code,{next:{revalidate:3600}});
  if(result.status===404)return{role:null,temporary:false};
  if(!result.ok)return{role:null,temporary:true};
  const role=await result.json() as Role;
  if(!role.name||role.code!==code)return{role:null,temporary:true};
  return{role,temporary:false};
 }catch{return{role:null,temporary:true}}
}
export async function generateMetadata({params}:Props):Promise<Metadata>{
 const {code}=await params;
 return{title:"Fiche métier ROME "+code+" | Petit Annonces",description:"Consultez les compétences, les missions et les métiers du répertoire ROME 4.0 de France Travail.",robots:{index:isCode(code),follow:true},alternates:{canonical:"/emploi/metiers/"+encodeURIComponent(code)}};
}
export default async function Page({params}:Props){
 const{code}=await params;
 if(!isCode(code))notFound();
 const {role,temporary}=await load(code);
 if(!role&&!temporary)notFound();
 const structured=role?{"@context":"https://schema.org","@type":"Occupation",name:role.name,description:role.definition??undefined,identifier:role.code,occupationalCategory:role.code}:null;
 return <main className={styles.main}>
  <nav className={styles.trail}><Link href="/">Accueil</Link><span>›</span><Link href="/categorie/emploi">Emploi</Link><span>›</span><span>Fiches métiers</span></nav>
  {temporary||!role?<section className={styles.hero}>
   <div className={styles.eyebrow}>RÉFÉRENTIEL ROME 4.0</div>
   <h1>Fiche métier temporairement indisponible</h1>
   <p>La source France Travail ne répond pas pour le moment. Revenez sur la rubrique Emploi pour découvrir les offres actuellement disponibles.</p>
   <Link className={styles.primary} href="/categorie/emploi">Retour aux offres d’emploi</Link>
  </section>:<>
   {structured&&<script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(structured).replace(/</g,"\\u003c")}}/>}
   <section className={styles.hero}>
    <div className={styles.eyebrow}>DÉCOUVRIR UN MÉTIER · ROME 4.0</div>
    <span className={styles.code}>CODE ROME {role.code}</span>
    <h1>{role.name}</h1>
    {role.domain&&<p className={styles.domain}>{role.domain}</p>}
    <p>Référentiel officiel des métiers et compétences de France Travail. Explorez les compétences utiles avant de consulter les offres d'emploi.</p>
    <div className={styles.actions}><Link className={styles.primary} href={"/recherche?q="+encodeURIComponent(role.name)+"&category=emploi"}>Rechercher des offres liées</Link><Link className={styles.secondary} href="/categorie/emploi">Toutes les offres</Link></div>
   </section>
   <div className={styles.grid}>
    {role.definition&&<section className={styles.card}><span className={styles.kicker}>PRÉSENTATION</span><h2>Présentation du métier</h2><p>{role.definition}</p></section>}
    {role.access&&<section className={styles.card}><span className={styles.kicker}>PARCOURS</span><h2>Accès au métier</h2><p>{role.access}</p></section>}
    {role.skills.length>0&&<section className={styles.card}><span className={styles.kicker}>SAVOIR-FAIRE</span><h2>Compétences mobilisées</h2><ul>{role.skills.map((s,i)=><li key={i}>{s}</li>)}</ul></section>}
    {role.knowledge.length>0&&<section className={styles.card}><span className={styles.kicker}>CONNAISSANCES</span><h2>Savoirs utiles</h2><ul>{role.knowledge.map((s,i)=><li key={i}>{s}</li>)}</ul></section>}
    {role.appellations.length>0&&<section className={styles.card}><span className={styles.kicker}>AUTRES INTITULÉS</span><h2>Appellations proches</h2><div className={styles.tags}>{role.appellations.map((name,i)=><span key={i}>{name}</span>)}</div></section>}
   </div>
   <p className={styles.source}>Source : France Travail · Répertoire ROME 4.0. Informations métier de référence, distinctes des annonces d'emploi. Les données peuvent évoluer.</p>
  </>}
 </main>
}
