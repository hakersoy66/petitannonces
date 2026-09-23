"use client";

import {useEffect,useMemo,useState} from "react";
import {AdminIcon} from "../../components/admin-icon";

export type UserAttention={
 config:{draftFirstDelayMinutes:number;draftSecondDelayHours:number};
 summary:{technicalAlerts:number;abandonedDrafts:number;abandonedCheckouts:number;lowQualityDrafts:number;firstDraftReminders:number;secondDraftReminders:number};
 technical:Array<{userId:string;email:string;name:string;event:string;label:string;count:number;lastAt:string;path:string|null}>;
 drafts:Array<{listingId:string;userId:string;title:string|null;updatedAt:string;draftSavedAt:string|null;email:string;name:string;reminded:boolean}>;
 checkouts:Array<{orderId:string;userId:string;orderNumber:string;createdAt:string;totalAmountMinor:number;currency:string;title:string|null;email:string;name:string}>;
 quality:Array<{listingId:string;userId:string;score:number;level:string;issues:Array<{label?:string;severity?:string}>;assessedAt:string;title:string|null;email:string;name:string}>;
};

const n=(v:number)=>Number(v??0).toLocaleString("fr-FR");
const money=(minor:number,currency="EUR")=>new Intl.NumberFormat("fr-FR",{style:"currency",currency}).format((minor??0)/100);
const ago=(value:string)=>{const ms=Math.max(0,Date.now()-new Date(value).getTime());const min=Math.floor(ms/60000);if(min<1)return"à l’instant";if(min<60)return"il y a "+min+" min";const h=Math.floor(min/60);if(h<24)return"il y a "+h+" h";return"il y a "+Math.floor(h/24)+" j"};

export function UserAttentionPanel({initialData}:{initialData:UserAttention|null}){
 const[data,setData]=useState(initialData);
 const[busy,setBusy]=useState(false);
 async function reload(){try{const r=await fetch("/api/admin/user-attention",{credentials:"include",cache:"no-store"});if(r.ok)setData(await r.json() as UserAttention)}catch{}}
 useEffect(()=>{const id=window.setInterval(()=>void reload(),30000);return()=>window.clearInterval(id)},[]);
 async function runRecovery(){setBusy(true);try{await fetch("/api/admin/user-attention/run-draft-recovery",{method:"POST",credentials:"include"});await reload()}finally{setBusy(false)}}
 const items=useMemo(()=>{
  if(!data)return[];
  const out:Array<{key:string;kind:"error"|"draft"|"checkout"|"quality";title:string;name:string;detail:string;time:string;href:string;badge:string}>=[];
  for(const x of data.technical)out.push({key:"tech-"+x.userId+"-"+x.event,kind:"error",title:x.label,name:x.name||x.email,detail:x.count+" tentative(s) en 24 h"+(x.path?" · "+x.path:""),time:x.lastAt,href:"/users/"+x.userId,badge:String(x.count)});
  for(const x of data.checkouts)out.push({key:"checkout-"+x.orderId,kind:"checkout",title:"Checkout abandonné",name:x.name||x.email,detail:(x.title||x.orderNumber)+" · "+money(x.totalAmountMinor,x.currency),time:x.createdAt,href:"/analytics",badge:"Paiement"});
  for(const x of data.drafts)out.push({key:"draft-"+x.listingId,kind:"draft",title:"Annonce laissée en brouillon",name:x.name||x.email,detail:(x.title||"Annonce sans titre")+(x.reminded?" · rappel envoyé":""),time:x.updatedAt,href:"/users/"+x.userId,badge:x.reminded?"Relancé":"À relancer"});
  for(const x of data.quality)out.push({key:"quality-"+x.listingId,kind:"quality",title:"Qualité d’annonce faible",name:x.name||x.email,detail:(x.title||"Annonce")+(x.issues?.[0]?.label?" · "+x.issues[0].label:""),time:x.assessedAt,href:"/users/"+x.userId,badge:x.score+"/100"});
  const rank={error:0,checkout:1,draft:2,quality:3};
  return out.sort((a,b)=>rank[a.kind]-rank[b.kind]||new Date(b.time).getTime()-new Date(a.time).getTime()).slice(0,10);
 },[data]);
 const total=(data?.summary.technicalAlerts??0)+(data?.summary.abandonedDrafts??0)+(data?.summary.abandonedCheckouts??0)+(data?.summary.lowQualityDrafts??0);
 return <section className="admin-card admin-section admin-attention-panel">
  <div className="admin-section-head admin-attention-head"><div><span className="admin-attention-eyebrow">Suivi proactif</span><h2>Attention utilisateurs</h2><p>Détecte les erreurs répétées, abandons de brouillon, paiements non terminés et annonces de faible qualité.</p></div><div className="admin-attention-actions"><span className={"admin-badge "+(total>0?"orange":"green")}><AdminIcon name={total>0?"warning":"check"}/>{n(total)} signal(aux)</span><button type="button" className="admin-btn" disabled={busy} onClick={()=>void runRecovery()}><AdminIcon name="bell"/>{busy?"Relance…":"Relancer les brouillons"}</button></div></div>
  <div className="admin-attention-kpis">
   <a href="#attention-list"><small>Erreurs répétées</small><strong>{n(data?.summary.technicalAlerts??0)}</strong><span>2+ en 24 h</span></a>
   <a href="#attention-list"><small>Brouillons abandonnés</small><strong>{n(data?.summary.abandonedDrafts??0)}</strong><span>≥ {data?.config.draftFirstDelayMinutes??90} min</span></a>
   <a href="/analytics"><small>Checkouts abandonnés</small><strong>{n(data?.summary.abandonedCheckouts??0)}</strong><span>≥ 30 min</span></a>
   <a href="#attention-list"><small>Qualité faible</small><strong>{n(data?.summary.lowQualityDrafts??0)}</strong><span>score &lt; 70</span></a>
  </div>
  <div className="admin-attention-meta"><span>{n(data?.summary.firstDraftReminders??0)} rappel(s) brouillon à 90 min</span><span>{n(data?.summary.secondDraftReminders??0)} second(s) rappel(s) à 24 h</span><span>Actualisation automatique · 30 s</span></div>
  <div id="attention-list" className="admin-attention-list">{items.length===0?<div className="admin-attention-empty"><AdminIcon name="check"/><div><strong>Aucun utilisateur ne nécessite d’intervention immédiate.</strong><small>Les nouveaux signaux apparaîtront automatiquement ici.</small></div></div>:items.map(item=><a href={item.href} className={"admin-attention-row "+item.kind} key={item.key}><span className="admin-attention-icon"><AdminIcon name={item.kind==="error"?"warning":item.kind==="checkout"?"wallet":item.kind==="draft"?"list":"growth"}/></span><span className="admin-attention-copy"><strong>{item.title}</strong><small>{item.name}</small><em>{item.detail}</em></span><span className="admin-attention-time">{ago(item.time)}</span><b>{item.badge}</b><span className="admin-attention-arrow">›</span></a>)}</div>
 </section>
}
