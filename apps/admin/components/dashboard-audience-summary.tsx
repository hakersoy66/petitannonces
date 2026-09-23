"use client";
import { useEffect, useMemo, useState } from "react";
import { AdminIcon } from "./admin-icon";

type Day={day:string;visits:number;visitors:number;pageViews:number};
type LiveData={summary:{onlineVisitors?:number;onlineMembers?:number;pwaEstimatedUsers?:number;visitsToday?:number;visitorsToday?:number;pageViewsToday?:number};topPages:Array<{path:string;sessions:number;pageViews:number}>;recentDays:Day[];ga4?:{measurementId?:string;propertyId?:string|null;tagConfigured?:boolean;reportingConnected?:boolean;consentRequired?:boolean;errorCode?:string|null;errorMessage?:string|null}};
const n=(v:number)=>Number(v||0).toLocaleString("fr-FR");
const pct=(now:number,prev:number)=>prev>0?Math.round((now-prev)/prev*100):now>0?100:0;

export function DashboardAudienceSummary(){
 const[data,setData]=useState<LiveData|null>(null),[error,setError]=useState(false);
 useEffect(()=>{let active=true;const load=()=>fetch("/api/admin/analytics/live",{credentials:"include",cache:"no-store"}).then(async r=>{if(!r.ok)throw new Error();const x=await r.json() as LiveData;if(active){setData(x);setError(false)}}).catch(()=>{if(active)setError(true)});void load();const t=setInterval(()=>void load(),30000);return()=>{active=false;clearInterval(t)}},[]);
 const stats=useMemo(()=>{const days=data?.recentDays??[];const current=days.slice(-7),previous=days.slice(-14,-7);const sum=(rows:Day[],key:keyof Pick<Day,"visits"|"visitors"|"pageViews">)=>rows.reduce((a,r)=>a+Number(r[key]||0),0);const visits=sum(current,"visits"),prevVisits=sum(previous,"visits"),visitors=sum(current,"visitors"),prevVisitors=sum(previous,"visitors"),views=sum(current,"pageViews"),prevViews=sum(previous,"pageViews");return{visits,visitors,views,prevVisits,prevVisitors,prevViews,pagesPerVisit:visits>0?views/visits:0,trend:pct(visits,prevVisits),days}},[data]);
 const top=data?.topPages?.[0];
 const analysis=stats.trend>10?`Le trafic progresse de ${stats.trend}% par rapport aux 7 jours précédents.`:stats.trend<-10?`Le trafic recule de ${Math.abs(stats.trend)}% par rapport aux 7 jours précédents.`:`Le trafic reste globalement stable sur les 7 derniers jours.`;
 const todayVisitors=Number(data?.summary?.visitsToday??0),todayVisits=Number(data?.summary?.visitsToday??0),todayViews=Number(data?.summary?.pageViewsToday??0);
 if(error&&!data)return <section className="admin-card admin-section"><div className="admin-section-head"><div><h2>Audience Petit Annonces</h2><p>Mesure first-party consentie.</p></div></div><div className="admin-empty">Les données d’audience internes ne sont pas disponibles.</div></section>;
 return <section className="admin-card admin-section admin-home-audience">
  <div className="admin-section-head"><div><h2>Audience Petit Annonces</h2><p>Statistiques first-party consenties. L’état de Google Analytics 4 est affiché séparément.</p></div><a className="admin-btn" href="/analytics"><AdminIcon name="chart"/>Voir le détail</a></div>
  <div className="admin-home-audience-kpis">
   <div><span><AdminIcon name="users"/></span><small>En ligne</small><strong>{n(Number(data?.summary?.onlineVisitors??0))}</strong><em>{n(Number(data?.summary?.onlineMembers??0))} membre(s)</em></div>
   <div><span><AdminIcon name="growth"/></span><small>Visites · 7 jours</small><strong>{n(stats.visits)}</strong><em className={stats.trend>=0?"up":"down"}>{stats.trend>=0?"+":""}{stats.trend}% vs 7 j précédents</em></div>
   <div><span><AdminIcon name="chart"/></span><small>Visiteurs aujourd’hui</small><strong>{n(todayVisitors)}</strong><em>{n(todayVisits)} visite(s) · {n(todayViews)} pages vues · toutes sources</em></div>
   <div><span><AdminIcon name="external"/></span><small>Pages / visite</small><strong>{stats.pagesPerVisit.toLocaleString("fr-FR",{maximumFractionDigits:1})}</strong><em>{n(Number(data?.summary?.pwaEstimatedUsers??0))} utilisateur(s) PWA estimé(s)</em></div>
  </div>
  <div className="admin-home-audience-grid">
   <div className="admin-home-trend"><div className="admin-home-analysis-note"><AdminIcon name="growth"/><div><strong>Lecture rapide</strong><p>{analysis}{top?` Page la plus active : ${top.path}.`:""}</p></div></div><div className="admin-home-bars">{stats.days.map((d,i)=>{const max=Math.max(1,...stats.days.map(x=>x.visits));return <div key={`${d.day}-${i}`} title={`${d.day} · ${d.visits} visites · ${d.pageViews} pages`}><i style={{height:`${Math.max(6,d.visits/max*100)}%`}}/><small>{new Date(`${d.day}T00:00:00`).toLocaleDateString("fr-FR",{day:"2-digit",month:"2-digit"})}</small></div>})}</div></div>
   <div className="admin-home-ga4"><div className="admin-home-ga4-head"><span className="admin-live-icon"><AdminIcon name="chart"/></span><div><small>Google Analytics 4</small><strong>{data?.ga4?.tagConfigured?"Balise configurée":"À vérifier"}</strong></div><span className={`admin-badge ${data?.ga4?.reportingConnected?"green":"orange"}`}>{data?.ga4?.reportingConnected?"Connecté":"Action requise"}</span></div><code>{data?.ga4?.measurementId??"G-H1WZ5519J1"}</code><p>{data?.ga4?.reportingConnected?"Les rapports GA4 sont lus directement depuis Google Analytics Data API.":data?.ga4?.errorCode==="api_disabled"?"La balise web est active, mais Google Analytics Data API doit encore être activée dans Google Cloud.":data?.ga4?.errorCode==="permission_missing"?"La balise web est active, mais le compte de service doit être ajouté à la propriété GA4.":"La balise GA4 utilise le consentement Analytics. Les chiffres d’audience affichés ici restent ceux de Petit Annonces."}</p><div className="admin-home-ga4-status"><span className={`admin-badge ${data?.ga4?.reportingConnected?"green":"orange"}`}>{data?.ga4?.reportingConnected?"Rapports GA4 connectés":data?.ga4?.errorCode==="api_disabled"?"Data API à activer":data?.ga4?.errorCode==="permission_missing"?"Accès GA4 à autoriser":"Connexion GA4 à terminer"}</span><a href="https://analytics.google.com/analytics/web/" target="_blank" rel="noreferrer">Ouvrir Google Analytics <AdminIcon name="external"/></a></div></div>
  </div>
 </section>;
}
