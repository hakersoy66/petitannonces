"use client";
import {useEffect,useMemo,useState} from "react";

type Notice={id:string;reference:string;reporterName:string|null;reporterEmail:string|null;targetType:string;targetId:string;contentUrl:string|null;legalBasis:string|null;explanation:string;status:string;decision:string|null;decisionReason:string|null;receivedAt:string;decidedAt:string|null};
const labels:Record<string,string>={RECEIVED:"Reçu",UNDER_REVIEW:"En cours",ACTIONED:"Mesure prise",NO_ACTION:"Aucune mesure",CLOSED:"Fermé"};
const tones:Record<string,string>={RECEIVED:"orange",UNDER_REVIEW:"orange",ACTIONED:"green",NO_ACTION:"",CLOSED:""};
export default function DsaClient(){
 const[rows,setRows]=useState<Notice[]>([]),[loading,setLoading]=useState(true),[filter,setFilter]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState("");
 async function load(){setLoading(true);setNotice("");try{const q=filter?`?status=${encodeURIComponent(filter)}`:"";const r=await fetch(`/api/admin/dsa/notices${q}`,{credentials:"include",cache:"no-store"});if(!r.ok)throw 0;setRows((await r.json()).notices??[])}catch{setNotice("Impossible de charger les signalements DSA.")}finally{setLoading(false)}}
 useEffect(()=>{void load()},[filter]);
 const counts=useMemo(()=>({received:rows.filter(x=>x.status==="RECEIVED").length,review:rows.filter(x=>x.status==="UNDER_REVIEW").length,open:rows.filter(x=>["RECEIVED","UNDER_REVIEW"].includes(x.status)).length}),[rows]);
 async function decide(item:Notice,status:"UNDER_REVIEW"|"ACTIONED"|"NO_ACTION"|"CLOSED"){
   if(busy)return;
   let reason="";
   if(status!=="UNDER_REVIEW"){
     const value=window.prompt(status==="ACTIONED"?"Décrivez la mesure prise et sa justification :":status==="NO_ACTION"?"Expliquez pourquoi aucune mesure n’est prise :":"Motif de clôture :",item.decisionReason??"");
     if(value===null)return;reason=value.trim();if(reason.length<3){setNotice("Ajoutez une justification suffisamment précise.");return}
   }
   setBusy(item.id);setNotice("");
   try{
     const body=status==="UNDER_REVIEW"?{status}:{status,decision:status==="ACTIONED"?"Action de modération appliquée":status==="NO_ACTION"?"Aucune mesure":"Dossier clôturé",decisionReason:reason};
     const r=await fetch(`/api/admin/dsa/notices/${encodeURIComponent(item.id)}`,{method:"PATCH",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
     if(!r.ok)throw 0;setNotice(`${item.reference} mis à jour.`);await load();
   }catch{setNotice("La décision DSA n’a pas pu être enregistrée.")}finally{setBusy("")}
 }
 return <><div className="admin-page-head"><div><p>Conformité</p><h1>Signalements DSA</h1><span className="subtitle">Notifications de contenus potentiellement illicites, suivi et décisions motivées.</span></div><button className="admin-btn" type="button" onClick={()=>void load()}>{loading?"Actualisation…":"Actualiser"}</button></div>
 {notice&&<div className="admin-flash ok">{notice}</div>}
 <div className="admin-grid admin-kpis"><article className="admin-card admin-kpi"><small>À examiner</small><strong>{counts.open}</strong><p>reçus ou en cours</p></article><article className="admin-card admin-kpi"><small>Nouveaux</small><strong>{counts.received}</strong><p>non pris en charge</p></article><article className="admin-card admin-kpi"><small>En cours</small><strong>{counts.review}</strong><p>examen actif</p></article><article className="admin-card admin-kpi"><small>Affichés</small><strong>{rows.length}</strong><p>jusqu’à 100 dossiers</p></article></div>
 <section className="admin-card admin-section" style={{marginTop:16}}>
  <div className="admin-section-head"><div><h2>File DSA</h2><p>Une décision terminale envoie automatiquement une notification au déclarant lorsqu’un e-mail est disponible.</p></div><select className="admin-input" style={{maxWidth:220}} value={filter} onChange={e=>setFilter(e.target.value)}><option value="">Tous les statuts</option><option value="RECEIVED">Reçus</option><option value="UNDER_REVIEW">En cours</option><option value="ACTIONED">Mesure prise</option><option value="NO_ACTION">Aucune mesure</option><option value="CLOSED">Fermés</option></select></div>
  <div className="admin-stack-list">{loading?<div className="admin-empty">Chargement…</div>:rows.map(item=><article key={item.id} style={{border:"1px solid #e9e7ef",borderRadius:16,padding:16,display:"grid",gap:11}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}><div><strong>{item.reference}</strong><small style={{display:"block",marginTop:3}}>{new Date(item.receivedAt).toLocaleString("fr-FR")} · {item.reporterName??"Identité non requise"}{item.reporterEmail?` · ${item.reporterEmail}`:""}</small></div><span className={`admin-badge ${tones[item.status]??""}`}>{labels[item.status]??item.status}</span></div>
    <div><strong>{item.targetType} · {item.targetId}</strong>{item.contentUrl&&<><br/><a href={item.contentUrl} target="_blank" rel="noreferrer">{item.contentUrl}</a></>}</div>
    {item.legalBasis&&<div><small>Base juridique invoquée</small><p style={{margin:"4px 0 0"}}>{item.legalBasis}</p></div>}
    <div><small>Explication</small><p style={{margin:"4px 0 0",whiteSpace:"pre-wrap"}}>{item.explanation}</p></div>
    {item.decisionReason&&<div style={{padding:12,background:"#f8f7fb",borderRadius:12}}><small>Décision / motif</small><p style={{margin:"4px 0 0"}}>{item.decisionReason}</p></div>}
    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{item.status==="RECEIVED"&&<button className="admin-btn" disabled={busy===item.id} onClick={()=>void decide(item,"UNDER_REVIEW")}>Prendre en charge</button>}{["RECEIVED","UNDER_REVIEW"].includes(item.status)&&<><button className="admin-btn primary" disabled={busy===item.id} onClick={()=>void decide(item,"ACTIONED")}>Mesure prise</button><button className="admin-btn" disabled={busy===item.id} onClick={()=>void decide(item,"NO_ACTION")}>Aucune mesure</button><button className="admin-btn danger" disabled={busy===item.id} onClick={()=>void decide(item,"CLOSED")}>Clôturer</button></>}</div>
  </article>)}{!loading&&!rows.length&&<div className="admin-empty">Aucun signalement DSA dans cette vue.</div>}</div>
 </section></>;
}
