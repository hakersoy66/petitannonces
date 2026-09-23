import { adminServerFetch } from "../../lib/server-api";
import { AdminIcon, type AdminIconName } from "../../components/admin-icon";
import { LiveVisitorsPanel } from "./live-visitors-panel";
import { UserAttentionPanel, type UserAttention } from "./user-attention-panel";

type Dashboard={kpis:{usersTotal:number;usersToday:number;listingsTotal:number;listingsPublished:number;ordersTotal:number;ordersActive:number;supportOpen:number;moderationOpen:number;disputesOpen:number;gmvMinor:number;platformCommissionMinor:number;visitsToday:number;visitorsToday:number;onlineVisitors:number;onlineMembers:number}};
type AnalyticsSummary={days:number;summary:{newUsers:number;newListings:number;publishedListings:number;orders:number;paidOrders:number;gmvMinor:number;revenueMinor:number;disputes:number;supportTickets:number}};
type LivePerson={visitorId:string;userId:string|null;email:string|null;name:string|null;avatarUrl:string|null;kind:string|null;currentPath:string|null;landingPath:string|null;lastSeenAt:string;pwaMode:boolean;referrer:string|null;source:string|null;medium:string|null;campaign:string|null;trafficSource:string|null;trafficMedium:string|null;trafficCampaign:string|null};
type LiveAnalytics={onlineUsers:Array<LivePerson>;onlineSessions:Array<LivePerson>;onlineWindowMinutes:number;summary?:{onlineMembers?:number;onlineVisitors?:number}};
type ContentPolicyReply={holds:Array<{userId:string;status:string;signals?:Array<{code:string}>}>;summary:{activeTerms:number;pending:number;blocked:number}};
const eur=(minor:number)=>new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR",maximumFractionDigits:0}).format((minor??0)/100);
const n=(value:number)=>Number(value??0).toLocaleString("fr-FR");
const relative=(value:string)=>{const diff=Math.max(0,Date.now()-new Date(value).getTime());const m=Math.floor(diff/60000);if(m<=0)return"à l’instant";if(m===1)return"il y a 1 min";return`il y a ${m} min`};
const kindLabel=(kind:string)=>kind==="PROFESSIONNEL"?"Pro":"Particulier";
const trafficLabel=(user:LivePerson)=>{const raw=(user.trafficSource??user.source??"").trim().toLowerCase();const medium=(user.trafficMedium??user.medium??"").trim().toLowerCase();if(["google","googleads","google_ads"].includes(raw)||raw.includes("google"))return medium&&medium!=="(none)"?`Google · ${medium}`:"Google";if(["meta","facebook","fb","instagram","ig"].includes(raw)||raw.includes("facebook")||raw.includes("instagram"))return medium?`Meta · ${medium}`:"Meta";if(raw.includes("bing")||raw.includes("microsoft"))return medium?`Bing · ${medium}`:"Bing";if(raw.includes("tiktok"))return medium?`TikTok · ${medium}`:"TikTok";if(raw&&raw!=="direct"&&raw!=="(direct)")return medium?`${raw} · ${medium}`:raw;try{if(user.referrer){const host=new URL(user.referrer).hostname.replace(/^www\./,"");if(host&&!host.includes("petitannonces.fr"))return`Referral · ${host}`}}catch{}return"Direct";};

export default async function AdminHome(){
 const[d,a30,a7,live,policy,userAttention]=await Promise.all([
  adminServerFetch<Dashboard>("/admin/dashboard"),
  adminServerFetch<AnalyticsSummary>("/admin/analytics/overview?days=30"),
  adminServerFetch<AnalyticsSummary>("/admin/analytics/overview?days=7"),
  adminServerFetch<LiveAnalytics>("/admin/analytics/live"),
  adminServerFetch<ContentPolicyReply>("/admin/moderation/content-policy"),
  adminServerFetch<UserAttention>("/admin/user-attention"),
 ]);
 const k=d?.kpis??{usersTotal:0,usersToday:0,listingsTotal:0,listingsPublished:0,ordersTotal:0,ordersActive:0,supportOpen:0,moderationOpen:0,disputesOpen:0,gmvMinor:0,platformCommissionMinor:0,visitsToday:0,visitorsToday:0,onlineVisitors:0,onlineMembers:0};
 const s30=a30?.summary??{newUsers:0,newListings:0,publishedListings:0,orders:0,paidOrders:0,gmvMinor:0,revenueMinor:0,disputes:0,supportTickets:0};
 const s7=a7?.summary??{newUsers:0,newListings:0,publishedListings:0,orders:0,paidOrders:0,gmvMinor:0,revenueMinor:0,disputes:0,supportTickets:0};
 const onlineUsers=live?.onlineUsers??[];
 const onlineSessions=live?.onlineSessions??onlineUsers;
 const forbiddenWordUsers=(policy?.holds??[]).filter(h=>h.status==="PENDING"&&(h.signals??[]).some(signal=>signal.code==="FORBIDDEN_TERM")).length;
 const priorities:Array<{href:string;icon:AdminIconName;label:string;value:number;detail:string;tone:string;className?:string}>=[
  {href:"/moderation",icon:"shield" as AdminIconName,label:"Modération",value:k.moderationOpen,detail:"annonce(s) à examiner",tone:k.moderationOpen>0?"orange":"green"},
  {href:"/support",icon:"support" as AdminIconName,label:"Support",value:k.supportOpen,detail:"ticket(s) ouvert(s)",tone:k.supportOpen>0?"orange":"green"},
  {href:"/finance",icon:"warning" as AdminIconName,label:"Litiges",value:k.disputesOpen,detail:"dossier(s) à surveiller",tone:k.disputesOpen>0?"red":"green",className:"priority-litiges"},
  {href:"/blocked-users",icon:"users" as AdminIconName,label:"Utilisateurs bloqués",value:policy?.summary?.blocked??0,detail:forbiddenWordUsers>0?`${forbiddenWordUsers} utilisateur(s) via mots interdits`:"Aucun blocage par mot interdit",tone:(policy?.summary?.blocked??0)>0?"red":"green",className:"priority-blocked"},
 ];
 const kpis:Array<[AdminIconName,string,string,string]>=[
  ["chart","Visites aujourd’hui",n(k.visitsToday),`${n(k.visitorsToday)} visiteur(s) unique(s) · heure de Paris`],
  ["users","En ligne maintenant",n(k.onlineVisitors),`${n(k.onlineMembers)} membre(s) connecté(s) · 5 min`],
  ["users","Utilisateurs",n(k.usersTotal),`+${n(k.usersToday)} aujourd’hui`],
  ["list","Annonces en ligne",n(k.listingsPublished),`${n(k.listingsTotal)} au total`],
  ["briefcase","Commandes actives",n(k.ordersActive),`${n(k.ordersTotal)} au total`],
  ["wallet","GMV cumulé",eur(k.gmvMinor),`${eur(k.platformCommissionMinor)} de commissions`],
 ];
 const quick:Array<[AdminIconName,string,string]>=[
  ["list","Annonces","/listings"],
  ["users","Utilisateurs","/users"],
  ["store","Professionnels","/professionals"],
  ["chart","Analytics","/analytics"],
  ["search","SEO","/seo"],
  ["server","État du système","/system"],
 ];
 return <div className="admin-home-simple">
  <div className="admin-page-head admin-home-head"><div><p>Pilotage</p><h1>Tableau de bord</h1><span className="subtitle">L’essentiel pour gérer Petit Annonces sans surcharge d’informations.</span></div><div className="admin-home-head-actions"><span className={`admin-badge ${d?"green":"orange"}`}><AdminIcon name={d?"check":"warning"}/>{d?"Plateforme opérationnelle":"À vérifier"}</span><a className="admin-btn" href="/system"><AdminIcon name="server"/>État du système</a></div></div>

  <div className="admin-grid admin-kpis admin-home-main-kpis">{kpis.map(([icon,label,value,hint])=><article className="admin-card admin-kpi admin-home-kpi" key={label}><div className="admin-kpi-top"><small>{label}</small><span className="admin-kpi-icon"><AdminIcon name={icon}/></span></div><strong>{value}</strong><p>{hint}</p></article>)}</div>

  <LiveVisitorsPanel initialData={live}/>

  <section className="admin-card admin-section admin-home-focus" style={{marginTop:16}}><div className="admin-section-head"><div><h2>À traiter en priorité</h2><p>Les actions qui demandent votre attention maintenant.</p></div></div><div className="admin-home-focus-grid">{priorities.map(item=><a href={item.href} key={item.label} className={(item.value>0?"needs-action "+item.tone:"is-clear")+(item.className?" "+item.className:"")}><span><AdminIcon name={item.icon}/></span><div><strong>{item.label}</strong><small>{item.detail}</small></div><b>{n(item.value)}</b><em>{item.value>0?"Ouvrir":"OK"}</em></a>)}</div></section>

  <UserAttentionPanel initialData={userAttention}/>

  <div className="admin-grid admin-home-simple-grid">
   <section className="admin-card admin-section"><div className="admin-section-head"><div><h2>Activité récente</h2><p>Comparaison rapide des 7 et 30 derniers jours.</p></div><a className="admin-btn" href="/analytics"><AdminIcon name="chart"/>Voir Analytics</a></div><div className="admin-home-period-table">
    <div><span>Nouveaux utilisateurs</span><b>{n(s7.newUsers)}</b><small>7 j</small><strong>{n(s30.newUsers)}</strong><small>30 j</small></div>
    <div><span>Annonces publiées</span><b>{n(s7.publishedListings)}</b><small>7 j</small><strong>{n(s30.publishedListings)}</strong><small>30 j</small></div>
    <div><span>Commandes payées</span><b>{n(s7.paidOrders)}</b><small>7 j</small><strong>{n(s30.paidOrders)}</strong><small>30 j</small></div>
    <div><span>GMV</span><b>{eur(s7.gmvMinor)}</b><small>7 j</small><strong>{eur(s30.gmvMinor)}</strong><small>30 j</small></div>
   </div><div className="admin-home-period-footer"><span>Revenus plateforme · 30 j</span><strong>{eur(s30.revenueMinor)}</strong><span>Commandes créées · 30 j</span><strong>{n(s30.orders)}</strong></div></section>

   <aside className="admin-card admin-section admin-home-shortcuts"><div className="admin-section-head"><div><h2>Accès rapide</h2><p>Les sections utilisées le plus souvent.</p></div></div><div className="admin-home-shortcut-grid">{quick.map(([icon,label,href])=><a href={href} key={href}><AdminIcon name={icon}/><span>{label}</span><b>›</b></a>)}</div></aside>
  </div>
 </div>;
}
