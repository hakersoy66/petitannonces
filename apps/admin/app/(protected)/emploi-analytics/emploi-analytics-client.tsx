"use client";
import { useEffect,useMemo,useState } from "react";
type Day={day:string;visitors:number;searches:number;applyClicks:number;resourceClicks:number;registrations:number};
type Response={days:number;timezone:string;series:Day[];totals:Omit<Day,"day">;caveats:Record<string,string>};
const fmt=(n:number)=>Number(n??0).toLocaleString("fr-FR");
const labels:{key:keyof Omit<Day,"day">;title:string;hint:string}[]=[
 {key:"visitors",title:"Visiteurs-jours",hint:"Visiteurs uniques quotidiens, cumulés"},
 {key:"searches",title:"Recherches d'emploi",hint:"Après consentement analytique"},
 {key:"applyClicks",title:"Clics vers les offres",hint:"Sorties vers France Travail, pas des candidatures confirmées"},
 {key:"resourceClicks",title:"Services officiels",hint:"La Bonne Boîte, événements et Data Emploi"},
 {key:"registrations",title:"Inscriptions liées à Emploi",hint:"Association de session, pas attribution exclusive"}
];
export default function EmploiAnalyticsClient(){
 const [days,setDays]=useState(7),[version,setVersion]=useState(0);
 const [data,setData]=useState<Response|null>(null),[pending,setPending]=useState(true),[error,setError]=useState("");
 useEffect(()=>{
  const ctl=new AbortController();setPending(true);setError("");
  fetch("/api/admin/analytics/emploi?days="+days,{credentials:"include",cache:"no-store",signal:ctl.signal})
   .then(async r=>{if(!r.ok)throw new Error("Erreur HTTP "+r.status);return r.json() as Promise<Response>})
   .then(x=>{if(!ctl.signal.aborted)setData(x)}).catch(e=>{if(!ctl.signal.aborted){setError(e instanceof Error?e.message:"Erreur inconnue");setData(null)}})
   .finally(()=>{if(!ctl.signal.aborted)setPending(false)});
  return()=>ctl.abort();
 },[days,version]);
 const peak=useMemo(()=>Math.max(1,...(data?.series??[]).map(x=>x.searches)),[data]);
 return <div className="admin-analytics-page">
  <div className="admin-page-head">
   <div><p>Pilotage · Emploi</p><h1>Parcours Emploi</h1><span className="subtitle">Recherche d'offres, visites, clics vers France Travail et inscriptions · données avec consentement</span></div>
   <div className="admin-analytics-head-actions">
    <select className="admin-select" aria-label="Période" value={days} onChange={e=>setDays(Number(e.target.value))}><option value={7}>7 jours</option><option value={30}>30 jours</option></select>
    <button type="button" className="admin-btn" disabled={pending} onClick={()=>setVersion(x=>x+1)}>{pending?"Chargement…":"Actualiser"}</button>
   </div>
  </div>
  {error&&<div className="admin-flash err"><strong>Rapport indisponible</strong><span>{error}</span></div>}
  <section className="admin-card admin-section">
   <div className="admin-section-head"><div><h2>Indicateurs principaux</h2><p>{data?"Période : "+data.days+" jours · fuseau Europe/Paris":"Chargement des données…"}</p></div></div>
   <div className="admin-grid admin-kpis">
    {labels.map(x=><div className="admin-card" key={x.key} style={{padding:17,minWidth:0}}>
     <small style={{color:"#79738b"}}>{x.title}</small><strong style={{display:"block",fontSize:27,color:"#4e42b3",padding:"7px 0"}}>{pending?"…":fmt(data?.totals[x.key]??0)}</strong>
     <span style={{fontSize:11,color:"#888495"}}>{x.hint}</span>
    </div>)}
   </div>
  </section>
  <section className="admin-card admin-section" style={{marginTop:18}}>
   <div className="admin-section-head"><div><h2>Évolution quotidienne</h2><p>Barres : recherches d'emploi · chiffres : clics vers les offres</p></div></div>
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(38px,1fr))",gap:9,alignItems:"end",minHeight:175,overflowX:"auto",paddingBottom:8}}>
    {(data?.series??[]).map(x=><div key={x.day} style={{display:"grid",justifyItems:"center",gap:5,minWidth:30}}>
     <small style={{fontSize:10,color:"#6654d6",fontWeight:850}}>{x.applyClicks}</small>
     <div title={fmt(x.searches)+" recherches"} style={{height:Math.max(4,Math.round(x.searches/peak*120)),width:"min(100%,36px)",borderRadius:"7px 7px 2px 2px",background:"#6552e5"}}/>
     <small style={{fontSize:9,color:"#77758b"}}>{x.day.slice(5)}</small>
    </div>)}
   </div>
  </section>
  <section className="admin-card admin-section" style={{marginTop:18}}>
   <h2>Précautions d'interprétation</h2>
   <p style={{lineHeight:1.6,color:"#706b80"}}>Les clics vers les offres ne prouvent pas qu'une candidature a été envoyée. Le nombre de visiteurs est une somme de visiteurs uniques par jour : une personne présente plusieurs jours peut être comptée plusieurs fois. Les inscriptions sont liées aux sessions Emploi, sans établir une causalité.</p>
   <p style={{lineHeight:1.6,color:"#706b80"}}>Les événements de recherche et de clic respectent le consentement aux cookies analytiques ; le rapport peut donc sous-estimer l'activité réelle.</p>
  </section>
 </div>;
}
