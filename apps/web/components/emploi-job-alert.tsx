"use client";
import {useEffect,useState} from "react";
import {AppIcon} from "./app-icon";
import type {EmploiFilters} from "../lib/emploi-links";
import styles from "./emploi-job-alert.module.css";

const api=()=>String(process.env.NEXT_PUBLIC_API_URL??"/api").replace(/\/$/,"");
const department=/^(?:0[1-9]|[1-8][0-9]|9[0-5]|97[1-6]|98[4-8]|2A|2B)$/;
export function EmploiJobAlert({filters}:{filters:EmploiFilters}){
 const [loading,setLoading]=useState(false);
 const [message,setMessage]=useState("");
 const [success,setSuccess]=useState(false);
 const [saved,setSaved]=useState(false);
 const hasCriteria=filters.q.length>=2||department.test(filters.departement);
 const key="pa:emploi-alert-created:"+[filters.q.toLocaleLowerCase("fr"),filters.departement,filters.contrat].join("|");
 useEffect(()=>{
  const controller=new AbortController();setSaved(false);
  fetch(api()+"/account/saved-searches",{credentials:"include",signal:controller.signal})
   .then(r=>r.ok?r.json():{searches:[]})
   .then((p:{searches?:Array<{alertEnabled?:boolean;filters?:{areaKey?:string;kind?:string}}>})=>{
    if(controller.signal.aborted)return;
    const areaKey="ft:"+[filters.q.toLocaleLowerCase("fr"),filters.departement,filters.contrat].join("|");
    setSaved(Boolean(p.searches?.some(x=>x.alertEnabled&&x.filters?.kind==="FRANCE_TRAVAIL_EMPLOI"&&x.filters.areaKey===areaKey)));
   }).catch(()=>undefined);
  return()=>controller.abort();
 },[key,filters.q,filters.departement,filters.contrat]);
 async function subscribe(){
  if(loading||!hasCriteria)return;
  setLoading(true);setMessage("");
  const parts=[filters.q||"Emploi",filters.departement?"département "+filters.departement:"",filters.contrat].filter(Boolean);
  const areaKey="ft:"+[filters.q.toLocaleLowerCase("fr"),filters.departement,filters.contrat].join("|");
  try{
   const response=await fetch(api()+"/account/saved-searches",{
    method:"POST",credentials:"include",headers:{"content-type":"application/json"},
    body:JSON.stringify({
      name:"Alerte Emploi · "+parts.join(" · "),query:filters.q||null,categorySlug:"emploi",
      filters:{kind:"FRANCE_TRAVAIL_EMPLOI",areaKey,departement:filters.departement||undefined,contrat:filters.contrat||undefined},
      alertEnabled:true,frequency:"DAILY"
    })
   });
   if(response.ok||response.status===409){
    setSuccess(true);setSaved(true);
    setMessage(response.status===409?"Cette alerte existe déjà dans votre compte.":"Alerte activée ! Vous recevrez un résumé quotidien uniquement lorsqu'il y aura de nouvelles offres.");
   }else if(response.status===401||response.status===403){
    const destination="/categorie/emploi"+(location.search||"")+"#offres-officielles";
    location.assign("/connexion?next="+encodeURIComponent(destination));return;
   }else{
    const body=await response.json().catch(()=>({})) as{error?:string};
    setMessage(body.error==="too_many_emploi_alerts"?"Vous avez atteint la limite de 15 alertes. Gérez vos recherches enregistrées.":"Impossible de créer l'alerte pour le moment.");
   }
  }catch{setMessage("Connexion indisponible. Réessayez dans quelques instants.")}
  finally{setLoading(false)}
 }
 return <aside className={styles.banner} aria-label="Alerte emploi">
  <div className={styles.icon}><AppIcon name="bell"/></div>
  <div className={styles.copy}><strong>Ne manquez plus une opportunité.</strong>
   <p>{hasCriteria?"Recevez un résumé quotidien des nouvelles offres France Travail correspondant à cette recherche.":"Indiquez un métier ou un département pour recevoir des alertes ciblées."}</p>
   {message&&<small role="status" className={success?styles.ok:styles.error}>{message}</small>}
  </div>
  <div className={styles.actions}>
   <button type="button" disabled={loading||!hasCriteria||saved} onClick={()=>void subscribe()}><AppIcon name={saved?"check":"bell"}/>{saved?"Alerte enregistrée":loading?"Enregistrement…":"Créer une alerte"}</button>
   <a href="/mon-compte/recherches">Gérer mes alertes</a>
  </div>
 </aside>;
}
