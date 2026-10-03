import { AppIcon } from "./app-icon";
import styles from "./emploi-hub.module.css";

export type EmploiFilters={q:string;departement:string;contrat:""|"CDI"|"CDD"|"MIS";page:number};
const places=[
 {name:"Paris",dept:"75"},{name:"Lyon",dept:"69"},{name:"Marseille",dept:"13"},
 {name:"Toulouse",dept:"31"},{name:"Bordeaux",dept:"33"},{name:"Lille",dept:"59"}
];
export function emploiHref(filters:Partial<EmploiFilters>):string{
 const search=new URLSearchParams();
 if(filters.q)search.set("ft_q",filters.q);
 if(filters.departement)search.set("ft_dept",filters.departement);
 if(filters.contrat)search.set("ft_contract",filters.contrat);
 if(filters.page&&filters.page>1)search.set("ft_page",String(filters.page));
 const query=search.toString();
 return "/categorie/emploi"+(query?"?"+query:"")+"#offres-officielles";
}
export function EmploiHub({filters,total}:{filters:EmploiFilters;total:number}){
 return <>
  <section className={styles.hero}>
   <div className={styles.ambientA} aria-hidden="true"/><div className={styles.ambientB} aria-hidden="true"/>
   <div className={styles.topline}><span className={styles.live}><span className={styles.dot}/>EMPLOI · PARTOUT EN FRANCE</span><span className={styles.eyebrow}>PETIT ANNONCES / EMPLOI</span></div>
   <div className={styles.headline}>
    <div className={styles.copy}>
     <h1>Votre prochain <em>chapitre</em><br/>commence ici.</h1>
     <p>Des offres d'emploi publiées par nos utilisateurs, des opportunités officielles France Travail et des fiches métiers pour avancer avec confiance.</p>
     <div className={styles.trustline}><span><AppIcon name="circle-check"/> Offres officielles identifiées</span><span><AppIcon name="shield"/> Candidatures sans frais</span></div>
    </div>
    <div className={styles.visual} aria-hidden="true">
      <div className={styles.orbitRing}/>
      <div className={styles.visualCard}>
       <div className={styles.cardTop}><span className={styles.visualIcon}><AppIcon name="briefcase"/></span><span className={styles.cardStatus}>À EXPLORER</span></div>
       <strong>Une opportunité<br/>à votre mesure.</strong>
       <span className={styles.dashes}><i/><i/><i/></span>
       <div className={styles.visualBar}><AppIcon name="location"/> Toute la France <AppIcon name="arrow-right"/></div>
      </div>
      <div className={styles.floating}><AppIcon name="sparkles"/> Des métiers à découvrir</div>
    </div>
   </div>
   <form action="/categorie/emploi" method="GET" className={styles.form} aria-label="Rechercher les offres officielles France Travail">
     <div className={styles.field}><label htmlFor="ft-q">Métier ou mot-clé</label><div><AppIcon name="search"/><input id="ft-q" type="search" name="ft_q" maxLength={80} defaultValue={filters.q} placeholder="Développeur, vendeur, chauffeur…"/></div></div>
     <div className={styles.field}><label htmlFor="ft-dept">Département</label><div><AppIcon name="location"/><input id="ft-dept" name="ft_dept" inputMode="text" maxLength={3} defaultValue={filters.departement} placeholder="Ex. 75, 69, 2A"/></div></div>
     <div className={styles.field}><label htmlFor="ft-contract">Contrat</label><div><AppIcon name="briefcase"/><select id="ft-contract" name="ft_contract" defaultValue={filters.contrat}><option value="">Tous les contrats</option><option value="CDI">CDI</option><option value="CDD">CDD</option><option value="MIS">Intérim</option></select></div></div>
     <button type="submit"><AppIcon name="search"/> Rechercher</button>
   </form>
   <div className={styles.popular}><span>Recherches par ville</span>{places.map(p=><a key={p.dept} href={emploiHref({...filters,departement:p.dept,page:1})}>{p.name}<AppIcon name="arrow-right"/></a>)}</div>
  </section>
  <nav className={styles.jumps} aria-label="Explorer les rubriques emploi">
   <a href="#offres-officielles"><i className={styles.jumpIcon}><AppIcon name="briefcase"/></i><span><strong>Offres France Travail</strong><small>Rechercher et postuler</small></span><AppIcon name="arrow-right"/></a>
   <a href="#annonces"><i className={styles.jumpIcon}><AppIcon name="user"/></i><span><strong>Annonces Petit Annonces</strong><small>{total} annonce{total>1?"s":""} publiée{total>1?"s":""}</small></span><AppIcon name="arrow-right"/></a>
   <a href="#metiers"><i className={styles.jumpIcon}><AppIcon name="sparkles"/></i><span><strong>Explorer les métiers</strong><small>Compétences et parcours</small></span><AppIcon name="arrow-right"/></a>
   <a href="/deposer-une-annonce"><i className={styles.jumpIcon}><AppIcon name="plus"/></i><span><strong>Vous recrutez ?</strong><small>Publier une annonce</small></span><AppIcon name="arrow-right"/></a>
  </nav>
 </>;
}
