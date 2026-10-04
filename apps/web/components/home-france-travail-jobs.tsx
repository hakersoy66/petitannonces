import {AppIcon} from "./app-icon";

export type HomeFranceTravailJob={
  id:string;
  title:string;
  company:string|null;
  city:string|null;
  contract:string|null;
  publishedAt:string|null;
  applyUrl:string;
  source:"FRANCE_TRAVAIL";
};

function OfficialJobCard({job}:{job:HomeFranceTravailJob}){
  return <article className="home-ft-job-card">
    <div className="home-ft-job-top"><span className="home-ft-job-contract">{job.contract||"Offre d'emploi"}</span><span className="home-ft-job-source">France Travail</span></div>
    <div className="home-ft-job-icon"><AppIcon name="briefcase"/></div>
    <h3><a href={job.applyUrl} target="_blank" rel="noopener noreferrer">{job.title}</a></h3>
    <div className="home-ft-job-company">{job.company||"Employeur non précisé"}</div>
    <div className="home-ft-job-bottom"><span><AppIcon name="location"/>{job.city||"France"}</span><a href={job.applyUrl} target="_blank" rel="noopener noreferrer" aria-label={`Consulter l'offre France Travail : ${job.title}`}>Voir l’offre <AppIcon name="arrow-right"/></a></div>
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
