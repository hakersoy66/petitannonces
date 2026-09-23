"use client";

import {useEffect,useMemo,useState} from "react";
import {AdminIcon} from "../../components/admin-icon";

type LivePerson={visitorId:string;userId:string|null;email:string|null;name:string|null;avatarUrl:string|null;kind:string|null;currentPath:string|null;landingPath:string|null;lastSeenAt:string;pwaMode:boolean;referrer:string|null;source:string|null;medium:string|null;campaign:string|null;trafficSource:string|null;trafficMedium:string|null;trafficCampaign:string|null};
type LiveAnalytics={onlineUsers:Array<LivePerson>;onlineSessions:Array<LivePerson>;onlineWindowMinutes:number;summary?:{onlineMembers?:number;onlineVisitors?:number}};

const n=(v:number)=>Number(v??0).toLocaleString("fr-FR");
const relative=(value:string)=>{const diff=Math.max(0,Date.now()-new Date(value).getTime());const sec=Math.floor(diff/1000);if(sec<20)return"à l’instant";const min=Math.floor(sec/60);if(min<=0)return"il y a moins d’une minute";if(min===1)return"il y a 1 min";return"il y a "+min+" min"};
const kindLabel=(kind:string|null)=>kind==="PROFESSIONNEL"?"Pro":"Particulier";
function refHost(value:string|null){try{return value?new URL(value).hostname.replace(/^www\./,""):""}catch{return""}}
function trafficLabel(user:LivePerson){
 const raw=(user.trafficSource??user.source??"").trim().toLowerCase();
 const medium=(user.trafficMedium??user.medium??"").trim().toLowerCase();
 const host=refHost(user.referrer).toLowerCase();
 if(raw.includes("google")||host.includes("google."))return medium&&medium!=="(none)"?"Google · "+medium:"Google";
 if(host.includes("duckduckgo.com")||raw.includes("duckduckgo"))return"DuckDuckGo";
 if(host.includes("bing.com")||raw.includes("bing")||raw.includes("microsoft"))return medium?"Bing · "+medium:"Bing";
 if(["meta","facebook","fb","instagram","ig"].includes(raw)||raw.includes("facebook")||raw.includes("instagram")||host.includes("facebook.com")||host.includes("instagram.com"))return medium?"Meta · "+medium:"Meta";
 if(raw.includes("tiktok")||host.includes("tiktok.com"))return medium?"TikTok · "+medium:"TikTok";
 if(raw==="referral"&&host)return"Referral · "+host;
 if(raw&&raw!=="direct"&&raw!=="(direct)")return medium?raw+" · "+medium:raw;
 if(host&&!host.includes("petitannonces.fr"))return"Referral · "+host;
 return"Direct";
}

export function LiveVisitorsPanel({initialData}:{initialData:LiveAnalytics|null}){
 const[data,setData]=useState<LiveAnalytics|null>(initialData);
 const[refreshing,setRefreshing]=useState(false);
 const sessions=useMemo(()=>data?.onlineSessions??data?.onlineUsers??[],[data]);
 async function refresh(silent=false){
  if(!silent)setRefreshing(true);
  try{const r=await fetch("/api/admin/analytics/live",{credentials:"include",cache:"no-store"});if(r.ok)setData(await r.json() as LiveAnalytics)}catch{}finally{if(!silent)setRefreshing(false)}
 }
 useEffect(()=>{const id=window.setInterval(()=>void refresh(true),15000);return()=>window.clearInterval(id)},[]);
 const members=data?.summary?.onlineMembers??sessions.filter(x=>x.userId).length;
 const anonymous=Math.max(0,sessions.length-members);
 return <section className="admin-card admin-section admin-live-panel">
  <div className="admin-live-head">
   <div><span className="admin-live-eyebrow"><i/> Temps réel</span><h2>Membres & visiteurs en ligne</h2><p>Activité des {data?.onlineWindowMinutes??5} dernières minutes · actualisation automatique toutes les 15 s.</p></div>
   <div className="admin-live-head-actions">
    <div className="admin-live-summary"><span><b>{n(sessions.length)}</b> en ligne</span><span><b>{n(members)}</b> membres</span><span><b>{n(anonymous)}</b> visiteurs</span></div>
    <button type="button" className="admin-live-refresh" onClick={()=>void refresh()} disabled={refreshing}><AdminIcon name="clock"/>{refreshing?"Actualisation…":"Actualiser"}</button>
   </div>
  </div>
  {sessions.length===0?<div className="admin-live-empty"><span><AdminIcon name="users"/></span><strong>Aucun visiteur actif</strong><small>Les nouvelles sessions apparaîtront automatiquement ici.</small></div>:<div className="admin-live-list">{sessions.map(user=>{const isMember=Boolean(user.userId);const displayName=isMember?(user.name||user.email||"Membre"):"Visiteur anonyme";const source=trafficLabel(user);return <a className="admin-live-row" key={user.visitorId||user.userId||user.lastSeenAt} href={isMember?"/users/"+user.userId:"/analytics"}>
   <span className={"admin-live-avatar "+(isMember?"member":"visitor")}>{user.avatarUrl?<img src={user.avatarUrl} alt=""/>:<b>{isMember?displayName.slice(0,1).toUpperCase():"V"}</b>}<i/></span>
   <span className="admin-live-identity"><strong>{displayName}</strong><small>{isMember?(user.email||"Compte connecté"):"Session "+user.visitorId.slice(0,8)+"…"}</small></span>
   <span className="admin-live-context"><span className="admin-live-path">{user.currentPath||"/"}</span><small>{relative(user.lastSeenAt)}{user.pwaMode?" · PWA":""}</small></span>
   <span className="admin-live-source"><small>Source</small><strong>{source}</strong>{user.campaign&&<em>{user.campaign}</em>}</span>
   <span className="admin-live-status"><b className={isMember&&user.kind==="PROFESSIONNEL"?"pro":isMember?"member":"visitor"}>{isMember?kindLabel(user.kind):"Visiteur"}</b><small><i/> En ligne</small></span>
  </a>})}</div>}
  <div className="admin-live-footer"><span>Les visiteurs anonymes ne révèlent aucune donnée personnelle.</span><a href="/analytics"><AdminIcon name="chart"/>Voir Analytics</a></div>
 </section>
}
