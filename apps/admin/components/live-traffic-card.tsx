"use client";
import { useEffect, useState } from "react";
import { AdminIcon } from "./admin-icon";

type LiveData={summary:{uniqueVisitors?:number;visits?:number;pageViews?:number;visitsToday?:number;onlineVisitors?:number;onlineMembers?:number;pwaExplicitInstalls?:number;pwaInstalledOrDetected?:number;pwaEstimatedUsers?:number;pwaOnboardingStarted?:number;pwaOnboardingCompleted?:number;pwaPushPrompted?:number;pwaPushAccepted?:number;pwaPushDeclined?:number};onlineUsers:Array<{userId:string;email:string;name:string;kind:string;currentPath:string;lastSeenAt:string;pwaMode:boolean}>;topPages:Array<{path:string;sessions:number;pageViews:number}>;recentDays:Array<{day:string;visits:number;visitors:number;pageViews:number}>;recentPwa:Array<{visitorId:string;userId?:string|null;email?:string|null;name?:string|null;kind?:string|null;firstSeenAt:string;lastSeenAt:string;pwaInstalledAt?:string|null;pwaStandaloneSeenAt?:string|null;currentPath?:string|null}>;onlineWindowMinutes:number};
const n=(v:unknown)=>Number(v??0).toLocaleString("fr-FR");
export function LiveTrafficCard(){
 const[data,setData]=useState<LiveData|null>(null),[error,setError]=useState("");
 async function load(){try{const r=await fetch("/api/admin/analytics/live",{credentials:"include",cache:"no-store"});if(!r.ok)throw new Error();setData(await r.json());setError("")}catch{setError("Les statistiques d’audience ne sont pas disponibles.")}}
 useEffect(()=>{void load();const t=setInterval(()=>void load(),30000);return()=>clearInterval(t)},[]);
 if(error&&!data)return <section className="admin-card admin-section"><h2>Audience en direct</h2><div className="admin-empty">{error}</div></section>;
 const s=data?.summary??{};const anonymous=Math.max(0,Number(s.onlineVisitors??0)-Number(s.onlineMembers??0));
 const onboardStarted=Number(s.pwaOnboardingStarted??0),onboardCompleted=Number(s.pwaOnboardingCompleted??0),pushPrompted=Number(s.pwaPushPrompted??0),pushAccepted=Number(s.pwaPushAccepted??0),pushDeclined=Number(s.pwaPushDeclined??0);
 const onboardRate=onboardStarted>0?Math.round(onboardCompleted/onboardStarted*100):0,pushRate=pushPrompted>0?Math.round(pushAccepted/pushPrompted*100):0;
 return <section className="admin-card admin-section admin-live-traffic">
  <div className="admin-section-head"><div><h2>Audience en direct</h2><p>Mesure d’audience consentie · actualisation toutes les 30 secondes.</p></div><button type="button" className="admin-btn" onClick={()=>void load()}><AdminIcon name="growth"/>Actualiser</button></div>
  <div className="admin-live-kpis">
   <div><span className="admin-live-icon"><AdminIcon name="users"/></span><small>En ligne</small><strong>{n(s.onlineVisitors)}</strong><em>{n(s.onlineMembers)} membres · {n(anonymous)} anonymes</em></div>
   <div><span className="admin-live-icon"><AdminIcon name="chart"/></span><small>Visiteurs uniques</small><strong>{n(s.uniqueVisitors)}</strong><em>depuis l’activation du suivi</em></div>
   <div><span className="admin-live-icon"><AdminIcon name="growth"/></span><small>Visites</small><strong>{n(s.visits)}</strong><em>{n(s.visitsToday)} aujourd’hui · {n(s.pageViews)} pages vues</em></div>
   <div><span className="admin-live-icon"><AdminIcon name="external"/></span><small>Utilisateurs PWA estimés</small><strong>{n(s.pwaEstimatedUsers)}</strong><em>{n(s.pwaInstalledOrDetected)} profils/appareils · {n(s.pwaExplicitInstalls)} installations explicites</em></div>
  </div>
  <div className="admin-live-pwa" style={{marginTop:16}}>
   <h3 className="admin-live-title">Parcours PWA</h3>
   <div className="admin-live-kpis">
    <div><span className="admin-live-icon"><AdminIcon name="external"/></span><small>Onboarding démarré</small><strong>{n(onboardStarted)}</strong><em>{n(onboardCompleted)} terminé(s)</em></div>
    <div><span className="admin-live-icon"><AdminIcon name="check"/></span><small>Taux de complétion</small><strong>{onboardRate}%</strong><em>présentation terminée / démarrée</em></div>
    <div><span className="admin-live-icon"><AdminIcon name="bell"/></span><small>Invitation notifications</small><strong>{n(pushPrompted)}</strong><em>{n(pushAccepted)} acceptée(s) · {n(pushDeclined)} refus/plus tard</em></div>
    <div><span className="admin-live-icon"><AdminIcon name="growth"/></span><small>Taux d’activation push</small><strong>{pushRate}%</strong><em>acceptations / invitations affichées</em></div>
   </div>
   <p style={{margin:"10px 0 0",fontSize:11,color:"var(--muted)"}}>Mesure d’audience consentie : ces chiffres couvrent les appareils ayant autorisé la mesure d’audience.</p>
  </div>
  <div className="admin-grid admin-two-col" style={{marginTop:16}}>
   <div><h3 className="admin-live-title">Utilisateurs connectés</h3>{!data?.onlineUsers?.length?<div className="admin-empty" style={{padding:24}}>Aucun membre connecté dans les {data?.onlineWindowMinutes??5} dernières minutes.</div>:<div className="admin-live-users">{data.onlineUsers.map(u=><a href={`/users/${u.userId}`} key={u.userId}><span className="admin-live-avatar">{(u.name||u.email).slice(0,2).toUpperCase()}</span><span><strong>{u.name||u.email}</strong><small>{u.email} · {u.kind==="PROFESSIONNEL"?"Pro":"Particulier"}{u.pwaMode?" · PWA":""}</small><em>{u.currentPath}</em></span><time>{new Date(u.lastSeenAt).toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}</time></a>)}</div>}</div>
   <div><h3 className="admin-live-title">Pages actives sur 24 h</h3>{!data?.topPages?.length?<div className="admin-empty" style={{padding:24}}>Les données vont apparaître à mesure des visites.</div>:<div className="admin-live-pages">{data.topPages.map(x=><div key={x.path}><span>{x.path}</span><strong>{n(x.pageViews)} vues</strong></div>)}</div>}</div>
  </div>
  <div className="admin-live-pwa" style={{marginTop:16}}><h3 className="admin-live-title">Appareils PWA récents</h3>{!data?.recentPwa?.length?<div className="admin-empty" style={{padding:24}}>Aucune installation ou utilisation en mode application détectée.</div>:<div className="admin-stack-list">{data.recentPwa.map(p=><div className="admin-order-row" key={p.visitorId}><span className="admin-live-avatar">{(p.name||"PWA").slice(0,2).toUpperCase()}</span><div><strong>{p.userId?<a href={`/users/${p.userId}`}>{p.name||p.email||"Membre"}</a>:"Visiteur anonyme"}</strong><small>{p.email?`${p.email} · `:""}{p.pwaInstalledAt?"Installation explicite":"Mode application détecté"}{p.currentPath?` · ${p.currentPath}`:""}</small></div><div style={{textAlign:"right"}}><span className={`admin-badge ${p.pwaInstalledAt?"green":""}`}>{p.pwaInstalledAt?"Installée":"Détectée"}</span><small style={{display:"block",marginTop:4}}>Vu {new Date(p.lastSeenAt).toLocaleString("fr-FR")}</small></div></div>)}</div>}</div>
 </section>
}