"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AppIcon, type AppIconName } from "./app-icon";
import styles from "./account-sidebar.module.css";
import { fetchWithRetry } from "../lib/fetch-resilient";
import { navigateApp } from "../lib/app-navigation";

type Summary={
 user?:{displayName?:string;avatarUrl?:string|null;kind?:"PARTICULIER"|"PROFESSIONNEL"};
 stats?:{listings?:{PUBLISHED?:number};unreadConversations?:number;pendingOffers?:number;unreadNotifications?:number};
};
const links:Array<{href:string;label:string;icon:AppIconName;count?:keyof NonNullable<Summary["stats"]>}>=[
 {href:"/mon-compte",label:"Mon compte",icon:"home"},
 {href:"/mon-compte/annonces",label:"Mes annonces",icon:"list"},
 {href:"/messages",label:"Messages",icon:"comments",count:"unreadConversations"},
 {href:"/mon-compte/notifications",label:"Notifications",icon:"bell",count:"unreadNotifications"},
 {href:"/mon-compte/favoris",label:"Favoris",icon:"heart"},
 {href:"/mon-compte/suivis",label:"Comptes suivis",icon:"bell"},
 {href:"/commandes",label:"Achats & ventes",icon:"credit-card"},
 {href:"/mon-compte/reservations",label:"Réservations Vacances & hôtels",icon:"calendar"},
 {href:"/mon-compte/activite",label:"Mon activité",icon:"gauge"},
 {href:"/mon-compte/reputation",label:"Réputation & badges",icon:"star"},
 {href:"/mon-compte/portefeuille",label:"Crédit Petit Annonces",icon:"wallet"},
 {href:"/parrainage",label:"Parrainage · gagnez 5 €",icon:"handshake"},
 {href:"/mon-compte/paiements",label:"IBAN & versements",icon:"credit-card"},
 {href:"/assistance",label:"Support & assistance",icon:"comments"},
];
const settings:Array<{href:string;label:string;icon:AppIconName}>=[
 {href:"/mon-compte/profil",label:"Profil & vérification",icon:"user-shield"},
 {href:"/mon-compte/adresses",label:"Adresses",icon:"location"},
 {href:"/mon-compte/recherches",label:"Recherches enregistrées",icon:"search"},
 {href:"/mon-compte/securite",label:"Sécurité",icon:"shield"},
 {href:"/mon-compte/parametres",label:"Paramètres",icon:"gears"},
];
function api(){return (process.env.NEXT_PUBLIC_API_URL??"/api").replace(/\/$/,"")}
let accountSummaryCache:Summary|null=null;
export function AccountSidebar(){
 const pathname=usePathname();const router=useRouter();const[data,setData]=useState<Summary>(()=>accountSummaryCache??{});
 useEffect(()=>{fetchWithRetry(`${api()}/account/dashboard`,{credentials:"include",cache:"no-store"},{timeoutMs:6000,retries:1}).then(r=>r.ok?r.json():Promise.reject()).then((next:Summary)=>{accountSummaryCache=next;setData(next)}).catch(()=>{})},[]);
 useEffect(()=>{const sync=(event:Event)=>{const count=Number((event as CustomEvent<number>).detail);if(Number.isFinite(count))setData(v=>({...v,stats:{...(v.stats??{}),unreadNotifications:Math.max(0,count)}}))};window.addEventListener("pa:notification-count",sync);return()=>window.removeEventListener("pa:notification-count",sync)},[]);
 useEffect(()=>{const sync=(event:Event)=>{const detail=(event as CustomEvent<{unreadConversations?:number;pendingOffers?:number;unreadNotifications?:number}>).detail;if(!detail||typeof detail!=="object")return;setData(v=>({...v,stats:{...(v.stats??{}),...(detail.unreadConversations!=null?{unreadConversations:Math.max(0,Number(detail.unreadConversations))}:{}),...(detail.pendingOffers!=null?{pendingOffers:Math.max(0,Number(detail.pendingOffers))}:{}),...(detail.unreadNotifications!=null?{unreadNotifications:Math.max(0,Number(detail.unreadNotifications))}:{})}}))};window.addEventListener("pa:message-summary",sync);return()=>window.removeEventListener("pa:message-summary",sync)},[]);
 const initials=useMemo(()=>((data.user?.displayName||"PA").trim().slice(0,2).toUpperCase()),[data.user?.displayName]);
 function active(href:string){return href==="/mon-compte"?pathname==="/mon-compte":pathname===href||pathname.startsWith(href+"/")}
 async function logout(){try{await fetch(`${api()}/auth/logout`,{method:"POST",credentials:"include"})}finally{navigateApp(router,"/",{replace:true})}}
 return <aside className={styles.sidebar}>
  <div className={styles.profile}><div className={styles.avatar}>{data.user?.avatarUrl?<img src={data.user.avatarUrl} alt=""/>:initials}</div><div><strong>{data.user?.displayName||"Mon compte"}</strong><span>{data.user?.kind==="PROFESSIONNEL"?"Compte professionnel":"Compte particulier"}</span></div></div>
  <nav className={styles.nav}>{links.map(item=>{const raw=item.count?Number(data.stats?.[item.count]??0):item.href==="/mon-compte/annonces"?Number(data.stats?.listings?.PUBLISHED??0):0;return <Link key={item.href} prefetch className={active(item.href)?styles.active:""} href={item.href}><span><AppIcon name={item.icon}/></span><b>{item.label}</b>{raw>0&&<em>{raw>99?"99+":raw}</em>}</Link>})}<div className={styles.divider}/>{settings.map(item=><Link key={item.href} prefetch className={active(item.href)?styles.active:""} href={item.href}><span><AppIcon name={item.icon}/></span><b>{item.label}</b></Link>)}</nav>
  <div className={styles.proCard}><span>PRO</span>{data.user?.kind==="PROFESSIONNEL"?<><strong>Votre Espace Pro</strong><p>Retrouvez vos ventes, boutiques, statistiques et outils professionnels.</p><Link prefetch href="/espace-pro">Ouvrir mon Espace Pro</Link></>:<><strong>Vous vendez régulièrement ?</strong><p>Découvrez les boutiques, statistiques et outils professionnels.</p><Link prefetch href="/professionnels">Découvrir Petit Annonces Pro</Link></>}</div>
  <button className={styles.logout} type="button" onClick={()=>void logout()}><AppIcon name="door"/> Se déconnecter</button>
 </aside>
}
