import DashboardDailyReport from "../../components/dashboard-daily-report";
import DashboardShortcuts from "../../components/dashboard-shortcuts";
import { adminServerFetch } from "../../lib/server-api";
import { AdminIcon, type AdminIconName } from "../../components/admin-icon";
import { visibleAdminGroups } from "../../lib/admin-navigation";
import type { AnonymousAudience } from "./live-visitors-panel";
import LazyDashboardDetails from "./lazy-dashboard-details";

type Viewer={user?:{roles?:string[]}};
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
 const[d,a30,a7,aggregate,policy,viewer]=await Promise.all([
  adminServerFetch<Dashboard>("/admin/dashboard"),
  adminServerFetch<AnalyticsSummary>("/admin/analytics/overview?days=30"),
  adminServerFetch<AnalyticsSummary>("/admin/analytics/overview?days=7"),
  adminServerFetch<AnonymousAudience>("/admin/analytics/anonymous-audience?days=1"),
  adminServerFetch<ContentPolicyReply>("/admin/moderation/content-policy"),
  adminServerFetch<Viewer>("/auth/me"),
 ]);
 const allowedPaths=new Set(visibleAdminGroups(viewer?.user?.roles??[]).flatMap(group=>group.items.map(item=>item.href)));
 const k=d?.kpis??{usersTotal:0,usersToday:0,listingsTotal:0,listingsPublished:0,ordersTotal:0,ordersActive:0,supportOpen:0,moderationOpen:0,disputesOpen:0,gmvMinor:0,platformCommissionMinor:0,visitsToday:0,visitorsToday:0,onlineVisitors:0,onlineMembers:0};
 const s30=a30?.summary??{newUsers:0,newListings:0,publishedListings:0,orders:0,paidOrders:0,gmvMinor:0,revenueMinor:0,disputes:0,supportTickets:0};
 const s7=a7?.summary??{newUsers:0,newListings:0,publishedListings:0,orders:0,paidOrders:0,gmvMinor:0,revenueMinor:0,disputes:0,supportTickets:0};
 const forbiddenWordUsers=(policy?.holds??[]).filter(h=>h.status==="PENDING"&&(h.signals??[]).some(signal=>signal.code==="FORBIDDEN_TERM")).length;
 const priorities:Array<{href:string;icon:AdminIconName;label:string;value:number;detail:string;tone:string;className?:string}>=[
  {href:"/moderation",icon:"shield" as AdminIconName,label:"Modération",value:k.moderationOpen,detail:"annonce(s) à examiner",tone:k.moderationOpen>0?"orange":"green"},
  {href:"/support",icon:"support" as AdminIconName,label:"Support",value:k.supportOpen,detail:"ticket(s) ouvert(s)",tone:k.supportOpen>0?"orange":"green"},
  {href:"/finance",icon:"warning" as AdminIconName,label:"Litiges",value:k.disputesOpen,detail:"dossier(s) à surveiller",tone:k.disputesOpen>0?"red":"green",className:"priority-litiges"},
  {href:"/blocked-users",icon:"users" as AdminIconName,label:"Utilisateurs bloqués",value:policy?.summary?.blocked??0,detail:forbiddenWordUsers>0?`${forbiddenWordUsers} utilisateur(s) via mots interdits`:"Aucun blocage par mot interdit",tone:(policy?.summary?.blocked??0)>0?"red":"green",className:"priority-blocked"},
 ];
 const kpis:Array<[AdminIconName,string,string,string]>=[
  ["chart","Entrées estimées aujourd’hui",aggregate?n(aggregate?.today.estimatedEntries??0):"—",`${n(aggregate?.today.pageViews??0)} page(s) vue(s) · estimation anonyme non unique`],
  ["users","En ligne maintenant",d?n(k.onlineVisitors):"—",`${n(k.onlineMembers)} membre(s) connecté(s) · 5 min`],
  ["list","Annonces en ligne",d?n(k.listingsPublished):"—",`${n(k.listingsTotal)} au total`],
  ["briefcase","Commandes actives",d?n(k.ordersActive):"—",`${n(k.ordersTotal)} au total`],
  ["wallet","GMV cumulé",d?eur(k.gmvMinor):"—",`${eur(k.platformCommissionMinor)} de commissions`],
 ];
 const quick:Array<[AdminIconName,string,string]>=[
  ["shield","Modération","/moderation"],
  ["support","Support","/support"],
  ["list","Annonces","/listings"],
  ["users","Utilisateurs","/users"],
  ["store","Professionnels","/professionals"],
  ["chart","Analytics","/analytics"],
  ["search","SEO","/seo"],
  ["server","État du système","/system"],
  ["bell","Notifications","/alerts"],
  ["search","Contrôle intelligent","/inspection"],
  ["shield","Sécurité administrative","/security"],
  ["wallet","Finance","/finance"],
 ];
 const visibleQuick=quick.filter(([, ,href])=>allowedPaths.has(href));
 const visiblePriorities=d?priorities.filter(item=>allowedPaths.has(item.href)&&(item.href!=="/blocked-users"||Boolean(policy))):[];
 return <div className="admin-home-simple admin-workspace-home">
  <header className="admin-workspace-hero">
   <div><span className="admin-workspace-eyebrow">ESPACE DE GESTION</span><h1>Tableau de bord</h1><p>Retrouvez les actions du jour et les chiffres essentiels de votre marketplace.</p></div>
   <div className="admin-workspace-hero-actions"><span className={`admin-badge ${d?"green":"orange"}`}>{d?"Données chargées":"Données indisponibles"}</span>{allowedPaths.has("/analytics")&&<a href="/analytics" className="admin-btn"><AdminIcon name="chart"/>Rapports</a>}</div>
  </header>
  {!d&&<div className="admin-flash system-attention" role="status">Les données sont indisponibles. <a href="/">Réessayer</a></div>}
  <section className="admin-workspace-section">
   <div className="admin-workspace-heading"><h2>Vue d’ensemble</h2><span>Activité de la marketplace</span></div>
   <div className="admin-workspace-metrics">
    {([["users","Utilisateurs",d?n(k.usersTotal):"—",d?`+${n(k.usersToday)} aujourd’hui`:"Données indisponibles","/users"],["list","Annonces publiées",d?n(k.listingsPublished):"—",d?`${n(k.listingsTotal)} annonces au total`:"Données indisponibles","/listings"],["chart","Visites aujourd’hui",aggregate?n(aggregate.today.estimatedEntries??0):"—","Entrées estimées","/analytics"],["wallet","Volume des ventes",d?eur(k.gmvMinor):"—",d?`${eur(k.platformCommissionMinor)} de commissions`:"Données indisponibles","/finance"]] as Array<[AdminIconName,string,string,string,string]>).map(([icon,label,value,hint,href])=><article className="admin-card admin-workspace-metric" key={label}><div><span>{label}</span><i><AdminIcon name={icon}/></i></div><strong>{value}</strong><small>{hint}</small>{allowedPaths.has(href)&&<a href={href}>Consulter <span>›</span></a>}</article>)}
   </div>
  </section>
  <div className="admin-workspace-columns">
   <section className="admin-card admin-workspace-panel">
    <div className="admin-workspace-heading"><div><h2>À traiter</h2><span>Vos tâches prioritaires</span></div><span className="admin-badge orange">{visiblePriorities.filter(i=>i.value>0).length} rubrique(s)</span></div>
    <div className="admin-task-list">{visiblePriorities.length?visiblePriorities.map(item=><a key={item.href} href={item.href}><i className={`admin-task-icon ${item.value>0?item.tone:"green"}`}><AdminIcon name={item.icon}/></i><div><strong>{item.label}</strong><small>{item.detail}</small></div><b>{n(item.value)}</b><span>›</span></a>):<p className="admin-empty">Aucune donnée disponible.</p>}</div>
   </section>
   <DashboardShortcuts items={visibleQuick}/>
  </div>
  {viewer?.user?.roles?.some(role=>["SUPER_ADMIN","ADMIN"].includes(role))&&<DashboardDailyReport/>}
  <div className="admin-workspace-columns">
   <section className="admin-card admin-workspace-panel">
    <div className="admin-workspace-heading"><div><h2>Activité récente</h2><span>Comparaison des périodes</span></div></div>
    <div className="admin-workspace-period"><div className="admin-workspace-period-head"><span>Indicateur</span><span>7 jours</span><span>30 jours</span></div>
    {([["Nouveaux utilisateurs",a7?n(s7.newUsers):"—",a30?n(s30.newUsers):"—"],["Annonces publiées",a7?n(s7.publishedListings):"—",a30?n(s30.publishedListings):"—"],["Commandes payées",a7?n(s7.paidOrders):"—",a30?n(s30.paidOrders):"—"],["Volume des ventes",a7?eur(s7.gmvMinor):"—",a30?eur(s30.gmvMinor):"—"]]).map(([label,v7,v30])=><div key={label}><span>{label}</span><b>{v7}</b><b>{v30}</b></div>)}</div>
    {allowedPaths.has("/analytics")&&<a className="admin-workspace-link" href="/analytics">Voir toutes les statistiques ›</a>}
   </section>
   <section className="admin-card admin-workspace-panel">
    <div className="admin-workspace-heading"><div><h2>En ce moment</h2><span>Activité et commandes</span></div></div>
    <div className="admin-workspace-mini"><div><span>Visiteurs en ligne</span><strong>{d?n(k.onlineVisitors):"—"}</strong><small>{d?n(k.onlineMembers):"—"} membres connectés</small></div><div><span>Commandes actives</span><strong>{d?n(k.ordersActive):"—"}</strong><small>{d?n(k.ordersTotal):"—"} au total</small></div><div><span>Revenus sur 30 jours</span><strong>{a30?eur(s30.revenueMinor):"—"}</strong></div><div><span>Pages vues aujourd’hui</span><strong>{aggregate?n(aggregate.today.pageViews):"—"}</strong></div></div>
   </section>
  </div>
  <LazyDashboardDetails attention={Boolean(viewer?.user?.roles?.some(r=>["SUPER_ADMIN","ADMIN","SUPPORT","MARKETING","MODERATOR"].includes(r)))} presence={Boolean(viewer?.user?.roles?.some(r=>["SUPER_ADMIN","ADMIN","MARKETING"].includes(r)))}/>
 </div>;
}
