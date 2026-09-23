"use client";

import { useEffect, useMemo, useState } from "react";
import { ProfessionalWorkspace } from "../../../components/professional-workspace";
import styles from "../suite.module.css";
import { fetchWithRetry } from "../../../lib/fetch-resilient";

type Stage = "NEW" | "CONTACTED" | "APPOINTMENT" | "NEGOTIATION" | "WON" | "LOST";
type Lead = { id:string; name:string|null; email:string|null; phone:string|null; stage:Stage; source:string; note:string|null; conversationId:string|null; listingId:string|null; listingTitle:string|null; listingSlug:string|null; assignedMemberId:string|null; assignedName:string|null; lastActivityAt:string };
type Member = { id:string; displayName:string|null; email:string; role:string; status:string };

const stages: Stage[] = ["NEW","CONTACTED","APPOINTMENT","NEGOTIATION","WON","LOST"];
const labels: Record<Stage,string> = { NEW:"Nouveaux", CONTACTED:"Contactés", APPOINTMENT:"Rendez-vous", NEGOTIATION:"Négociation", WON:"Gagnés", LOST:"Perdus" };
function api(){ return (process.env.NEXT_PUBLIC_API_URL ?? "/api").replace(/\/$/,""); }

export default function ProCrm(){
  const [leads,setLeads]=useState<Lead[]>([]);
  const [members,setMembers]=useState<Member[]>([]);
  const [counts,setCounts]=useState<Record<string,number>>({});
  const [q,setQ]=useState("");
  const [filter,setFilter]=useState<Stage|"ALL">("ALL");
  const [msg,setMsg]=useState("");
  const [loading,setLoading]=useState(true);

  async function load(){
    setLoading(true);
    const sp=new URLSearchParams();
    if(filter!=="ALL")sp.set("stage",filter);
    if(q.trim())sp.set("q",q.trim());
    let r:Response;try{r=await fetchWithRetry(`${api()}/pro/crm/leads?${sp}`,{credentials:"include",cache:"no-store"},{timeoutMs:7000,retries:1})}catch{setMsg("Impossible de charger les prospects.");setLoading(false);return}
    if(r.status===403){setMsg("Votre rôle ne permet pas d’accéder au CRM.");setLoading(false);return;}
    if(!r.ok){setMsg("Impossible de charger les prospects.");setLoading(false);return;}
    const p=await r.json();
    setLeads(p.leads??[]);setCounts(p.counts??{});setLoading(false);
  }
  useEffect(()=>{void load();},[filter]);
  useEffect(()=>{fetchWithRetry(`${api()}/pro/team`,{credentials:"include",cache:"no-store"},{timeoutMs:6500,retries:1}).then(r=>r.ok?r.json():null).then(p=>setMembers((p?.members??[]).filter((x:Member)=>x.status==="ACTIVE"))).catch(()=>{});},[]);
  async function patch(id:string,data:Record<string,unknown>){
    const r=await fetch(`${api()}/pro/crm/leads/${id}`,{method:"PATCH",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify(data)});
    if(!r.ok){setMsg("Modification impossible.");return;}
    await load();
  }
  const total=useMemo(()=>Object.values(counts).reduce((a,b)=>a+Number(b||0),0),[counts]);

  return <ProfessionalWorkspace><main className={styles.shell}>
    <header className={styles.hero}><div><span className={styles.kicker}>Pipeline commercial</span><h1>CRM & prospects</h1><p>Chaque nouvelle conversation devient automatiquement un prospect. Suivez le contact jusqu’à la vente ou au mandat.</p></div><a className={styles.button} href="/espace-pro/rendez-vous">Rendez-vous →</a></header>
    {msg&&<div className={styles.notice}>{msg}</div>}
    <section className={styles.kpis}><div className={styles.kpi}><small>Prospects</small><strong>{total}</strong></div><div className={styles.kpi}><small>Nouveaux</small><strong>{counts.NEW??0}</strong></div><div className={styles.kpi}><small>Rendez-vous</small><strong>{counts.APPOINTMENT??0}</strong></div><div className={styles.kpi}><small>Gagnés</small><strong>{counts.WON??0}</strong></div></section>
    <div className={styles.toolbar}><form style={{display:"flex",gap:8,flex:1}} onSubmit={e=>{e.preventDefault();void load();}}><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Nom, e-mail ou annonce…"/><button className={styles.button}>Rechercher</button></form></div>
    <div className={styles.tabs}><button className={filter==="ALL"?styles.active:""} onClick={()=>setFilter("ALL")}>Tous <b>{total}</b></button>{stages.map(s=><button key={s} className={filter===s?styles.active:""} onClick={()=>setFilter(s)}>{labels[s]} <b>{counts[s]??0}</b></button>)}</div>
    {loading ? <div className={styles.empty}>Chargement du pipeline…</div> : !leads.length ? <div className={styles.empty}>Aucun prospect dans cette étape. Les nouvelles conversations apparaîtront automatiquement ici.</div> : <section className={styles.kanban}>
      {stages.map(stage=><div className={styles.column} key={stage}>
        <div className={styles.columnHead}><span>{labels[stage]}</span><b>{leads.filter(x=>x.stage===stage).length}</b></div>
        {leads.filter(x=>x.stage===stage).map(l=><article className={styles.lead} key={l.id}>
          <strong>{l.name??l.email??"Prospect"}</strong><small>{l.listingTitle??"Contact direct"}</small>
          <div className={styles.meta}>{l.email&&<span>{l.email}</span>}{l.phone&&<span>{l.phone}</span>}<span>{new Date(l.lastActivityAt).toLocaleDateString("fr-FR")}</span></div>
          <select value={l.stage} onChange={e=>void patch(l.id,{stage:e.target.value})}>{stages.map(s=><option key={s} value={s}>{labels[s]}</option>)}</select>
          {members.length>0&&<select value={l.assignedMemberId??""} onChange={e=>void patch(l.id,{assignedMemberId:e.target.value||null})}><option value="">Non assigné</option>{members.map(m=><option key={m.id} value={m.id}>{m.displayName??m.email}</option>)}</select>}
          <div className={styles.actions}>{l.conversationId&&<a href={`/espace-pro/messages?conversation=${encodeURIComponent(l.conversationId)}`}>Message</a>}<a href={`/espace-pro/rendez-vous?leadId=${encodeURIComponent(l.id)}&name=${encodeURIComponent(l.name??"")}`}>Planifier</a>{l.listingSlug&&<a href={`/annonce/${l.listingSlug}`}>Annonce</a>}</div>
        </article>)}
      </div>)}
    </section>}
  </main></ProfessionalWorkspace>;
}
