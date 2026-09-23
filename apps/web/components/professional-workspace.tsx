"use client";
import {useEffect,useState,type ReactNode} from "react";
import Link from "next/link";
import {usePathname,useRouter} from "next/navigation";
import {AppIcon,type AppIconName} from "./app-icon";
import styles from "./professional-workspace.module.css";
import {fetchWithRetry} from "../lib/fetch-resilient";
import {navigateApp} from "../lib/app-navigation";

type Summary={user?:{name?:string;avatarUrl?:string|null};business?:{verificationStatus?:string}|null;subscription?:{plan?:{name?:string;monthlyPriceMinor?:number}|null}|null;stats?:{activeListings?:number;unreadConversations?:number;stores?:number;orders?:number}};
type FeatureKey="crm"|"appointments"|"team"|"reservations"|"feed"|"sales";
type NavItem={href:string;label:string;icon:AppIconName;count?:"activeListings"|"unreadConversations"|"stores"|"orders";feature?:FeatureKey};
type SuiteProfile={sector:string;features:Record<FeatureKey,boolean>};
const dailyNav:NavItem[]=[
 {href:"/espace-pro",label:"Tableau de bord Pro",icon:"gauge"},
 {href:"/espace-pro/annonces",label:"Mes annonces",icon:"list",count:"activeListings"},
 {href:"/espace-pro/messages",label:"Messages",icon:"comments",count:"unreadConversations"},
 {href:"/espace-pro/crm",label:"CRM & prospects",icon:"handshake",feature:"crm"},
 {href:"/espace-pro/rendez-vous",label:"Rendez-vous",icon:"calendar",feature:"appointments"},
 {href:"/espace-pro/ventes",label:"Ventes",icon:"credit-card",count:"orders",feature:"sales"},
 {href:"/espace-pro/reservations",label:"Réservations Vacances",icon:"calendar",feature:"reservations"},
 {href:"/espace-pro/boutiques",label:"Ma boutique",icon:"store",count:"stores"},
];
const toolNav:NavItem[]=[
 {href:"/espace-pro/visibilite",label:"Visibilité",icon:"sparkles"},
 {href:"/espace-pro/analytics",label:"Statistiques",icon:"gauge"},
 {href:"/espace-pro/imports",label:"Imports & feed",icon:"arrow-right",feature:"feed"},
 {href:"/espace-pro/equipe",label:"Équipe & rôles",icon:"user-shield",feature:"team"},
];
const accountNav:Array<{href:string;label:string;icon:AppIconName}>=[
 {href:"/espace-pro/compte",label:"Mon compte Pro",icon:"user"},
 {href:"/assistance?category=PROFESSIONAL",label:"Support Pro",icon:"comments"},
];
function api(){return(process.env.NEXT_PUBLIC_API_URL??"/api").replace(/\/$/,"")}
function money(n=0){return new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR",maximumFractionDigits:0}).format(n/100)}
let proSummaryCache:Summary|null=null;
let proSuiteCache:SuiteProfile|null=null;
export function ProfessionalWorkspace({children,summary:provided}:{children:ReactNode;summary?:Summary|null}){
 const pathname=usePathname();const router=useRouter();const[data,setData]=useState<Summary>(()=>provided??proSummaryCache??{});const[open,setOpen]=useState(false);const[suite,setSuite]=useState<SuiteProfile|null>(()=>proSuiteCache);
 useEffect(()=>{if(provided){proSummaryCache=provided;setData(provided)}else fetchWithRetry(`${api()}/pro/dashboard`,{credentials:"include",cache:"no-store"},{timeoutMs:6500,retries:1}).then(r=>r.ok?r.json():Promise.reject()).then((next:Summary)=>{proSummaryCache=next;setData(next)}).catch(()=>{});fetchWithRetry(`${api()}/pro/suite/overview`,{credentials:"include",cache:"no-store"},{timeoutMs:6500,retries:1}).then(r=>r.ok?r.json():null).then(p=>{if(p){const next={sector:p.sector,features:p.features} as SuiteProfile;proSuiteCache=next;setSuite(next)}}).catch(()=>{})},[provided]);
 useEffect(()=>{const sync=(event:Event)=>{const detail=(event as CustomEvent<{unreadConversations?:number;pendingOffers?:number}>).detail;if(!detail||typeof detail!=="object")return;setData(v=>({...v,stats:{...(v.stats??{}),...(detail.unreadConversations!=null?{unreadConversations:Math.max(0,Number(detail.unreadConversations))}:{}),...(detail.pendingOffers!=null?{pendingOffers:Math.max(0,Number(detail.pendingOffers))}:{})}}))};window.addEventListener("pa:message-summary",sync);return()=>window.removeEventListener("pa:message-summary",sync)},[]);
 useEffect(()=>setOpen(false),[pathname]);
 useEffect(()=>{if(!open)return;const onKey=(event:KeyboardEvent)=>{if(event.key==="Escape")setOpen(false)};window.addEventListener("keydown",onKey);return()=>window.removeEventListener("keydown",onKey)},[open]);
 const active=(href:string)=>href==="/espace-pro"?pathname==="/espace-pro":pathname===href||pathname.startsWith(href+"/");
 async function logout(){try{await fetch(`${api()}/auth/logout`,{method:"POST",credentials:"include"})}finally{navigateApp(router,"/",{replace:true})}}
 const initials=(data.user?.name??"PA").slice(0,2).toUpperCase();const plan=data.subscription?.plan;const sectorLabel=suite?.sector==="AUTOMOBILE"?"Professionnel automobile":suite?.sector==="IMMOBILIER"?"Professionnel immobilier":suite?.sector==="COMMERCE"?"Commerce professionnel":suite?.sector==="VACANCES"?"Hébergement & vacances":suite?.sector==="SERVICES"?"Services professionnels":"Compte professionnel";const visibleDaily=dailyNav.filter(item=>!item.feature||suite?.features?.[item.feature]===true);const visibleTools=toolNav.filter(item=>!item.feature||suite?.features?.[item.feature]===true);
 return <div className={styles.page} data-pro-messages={pathname.startsWith("/espace-pro/messages")?"true":"false"}><div className={styles.mobileBar}><button type="button" onClick={()=>setOpen(true)} aria-label="Ouvrir le menu professionnel" aria-expanded={open}><AppIcon name="list"/></button><div><strong>Espace Pro</strong><span>{data.user?.name??"Petit Annonces Business"}</span></div><Link prefetch href="/deposer-une-annonce">+ Annonce</Link></div>{open&&<button type="button" className={styles.overlay} aria-label="Fermer le menu" onClick={()=>setOpen(false)}/>}<div className={styles.workspace}><aside className={`${styles.sidebar} ${open?styles.open:""}`} data-open={open?"true":"false"} data-no-pull-refresh><div className={styles.sideHead}><div className={styles.mobileCompany}><strong>{data.user?.name??"Compte professionnel"}</strong><span>{data.business?.verificationStatus==="VERIFIED"?`${sectorLabel} · SIRET vérifié`:sectorLabel}</span></div><button type="button" onClick={()=>setOpen(false)} aria-label="Fermer le menu professionnel">×</button></div><div className={styles.sidebarScroll} data-no-pull-refresh><div className={styles.company}><div className={styles.avatar}>{data.user?.avatarUrl?<img src={data.user.avatarUrl} alt=""/>:initials}</div><div><strong>{data.user?.name??"Compte professionnel"}</strong><span>{data.business?.verificationStatus==="VERIFIED"?`${sectorLabel} · SIRET vérifié`:sectorLabel}</span></div></div><nav>{visibleDaily.map(item=>{const count=item.count?Number(data.stats?.[item.count]??0):0;return <Link key={item.href} prefetch className={active(item.href)?styles.active:""} href={item.href}><AppIcon name={item.icon}/><span>{item.label}</span>{count>0&&<b>{count>99?"99+":count}</b>}</Link>})}<small className={styles.navLabel}>Outils</small>{visibleTools.map(item=><Link key={item.href} prefetch className={active(item.href)?styles.active:""} href={item.href}><AppIcon name={item.icon}/><span>{item.label}</span></Link>)}<small className={styles.navLabel}>Compte</small>{accountNav.map(item=><Link key={item.href} prefetch className={active(item.href)?styles.active:""} href={item.href}><AppIcon name={item.icon}/><span>{item.label}</span></Link>)}<div className={styles.divider}/><Link prefetch href="/importer-une-annonce"><AppIcon name="arrow-right"/><span>Importer une annonce</span></Link><Link prefetch href="/mon-compte?mode=particulier"><AppIcon name="user"/><span>Espace particulier</span></Link></nav><div className={styles.plan}><small>{plan?.name??"Compte Pro"}</small><strong>{plan?.monthlyPriceMinor!=null?money(plan.monthlyPriceMinor):"Formule professionnelle"}</strong><span>{plan?.monthlyPriceMinor!=null?"par mois":"Gérez votre offre"}</span><Link prefetch href="/espace-pro/abonnement">Gérer mon offre →</Link></div><button type="button" className={styles.logout} onClick={()=>void logout()}><AppIcon name="door"/> Se déconnecter</button></div></aside><main className={`${styles.content} pa-pro-workspace-content`}>{children}</main></div></div>
}
