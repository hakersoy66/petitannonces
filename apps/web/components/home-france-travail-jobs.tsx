import {AppIcon} from "./app-icon";

export type HomeFranceTravailJob={
  id:string;
  title:string;
  company:string|null;
  logoUrl:string|null;
  city:string|null;
  contract:string|null;
  publishedAt:string|null;
  applyUrl:string;
  source:"FRANCE_TRAVAIL";
};

const MANPOWER_LOGO="https://newsroom.manpowergroup.fr/wp-content/uploads/2017/08/765111-500x409.png";

function companyLogo(job:HomeFranceTravailJob):string|null{
  if(job.logoUrl){
    try{const u=new URL(job.logoUrl);if(u.protocol==="https:"&&u.hostname.includes("."))return u.toString()}catch{}
  }
  // Verified, brand-specific press image from ManpowerGroup's official newsroom.
  if(/^MANPOWER(?: FRANCE)?$/i.test((job.company??"").trim()))return MANPOWER_LOGO;
  return null;
}

function companyInitials(value:string|null):string{
  if(!value?.trim())return "FT";
  const words=value.trim().replace(/[^\p{L}\p{N} ]/gu,"").split(/\s+/).filter(Boolean);
  return (words.length>1?words.slice(0,2).map(x=>x[0]):[words[0]?.slice(0,2)]).filter(Boolean).join("").toUpperCase();
}

function OfficialJobCard({job}:{job:HomeFranceTravailJob}){
  const logo=companyLogo(job);
  return <article className="home-ft-job-card">
    <div className="home-ft-job-top"><span className="home-ft-job-contract">{job.contract||"Emploi"}</span><span className="home-ft-job-source"><AppIcon name="circle-check"/> France Travail</span></div>
    <div className="home-ft-job-employer-row">
      <span className="home-ft-job-logo" aria-hidden="true"><b>{companyInitials(job.company)}</b>{logo&&<i style={{backgroundImage:`url("${logo}")`}}/>}</span>
      <div className="home-ft-job-employer"><small>Entreprise</small><strong>{job.company||"Employeur non précisé"}</strong></div>
    </div>
    <h3><a href={job.applyUrl} target="_blank" rel="noopener noreferrer">{job.title}</a></h3>
    <div className="home-ft-job-location"><AppIcon name="location"/><span>{job.city||"France"}</span></div>
    <div className="home-ft-job-bottom"><a href={job.applyUrl} target="_blank" rel="noopener noreferrer" aria-label={`Consulter l'offre France Travail : ${job.title}`}>Voir l’offre <AppIcon name="arrow-right"/></a></div>
  </article>;
}

export function HomeFranceTravailJobs({jobs,mobile=false}:{jobs:HomeFranceTravailJob[];mobile?:boolean}){
  return <section className={`market-home-rail home-ft-jobs ${mobile?"home-ft-jobs-mobile":""}`} aria-label="Offres d'emploi récentes France Travail">
    <div className="market-home-section-head home-ft-jobs-head">
      <div><span className="market-home-section-icon home-ft-head-icon"><AppIcon name="briefcase"/></span><div><h2>Offres d’emploi récentes</h2><p>6 opportunités issues de France Travail, partout en France</p></div></div>
      <a href="/categorie/emploi">Toutes les offres <AppIcon name="arrow-right"/></a>
    </div>
    {jobs.length>0?<div className="home-ft-jobs-grid">{jobs.slice(0,6).map(job=><OfficialJobCard key={job.id} job={job}/>)}</div>:<div className="market-home-empty-state">Les offres France Travail sont momentanément indisponibles. <a href="/categorie/emploi">Explorer la rubrique Emploi</a></div>}
    <p className="home-ft-job-attribution">Source : France Travail · Offres actualisées périodiquement. Consultez l’annonce officielle pour vérifier sa disponibilité et candidater.</p>
  </section>;
}
