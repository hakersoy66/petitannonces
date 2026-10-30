"use client";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AdminIcon, type AdminIconName } from "./admin-icon";
import { visibleAdminGroups } from "../lib/admin-navigation";

type User={email:string;name:string;roles:string[]};
type Brand={siteName:string;logoUrl:string|null};
type NavItem=[AdminIconName,string,string];
type NavGroup={label:string;items:NavItem[]};
const groups:NavGroup[]=[
 {label:"Pilotage",items:[["dashboard","Tableau de bord","/"],["shield","Modération","/moderation"],["shield","Signalements DSA","/dsa"],["users","Utilisateurs bloqués","/blocked-users"],["shield","Centre de risque","/risk"],["list","Annonces","/listings"],["users","Utilisateurs","/users"],["store","Professionnels & vitrines","/professionals"]]},
 {label:"Opérations",items:[["wallet","Finance","/finance"],["briefcase","Réservations HBX","/hbx-bookings"],["store","Fournisseurs & produits neufs","/suppliers"],["bell","Boîte e-mail","/inbox"],["support","Support","/support"],["chart","Analytics","/analytics"],["chart","Santé de la marketplace","/marketplace-health"],["briefcase","Suivi Emploi","/emploi-analytics"],["list","Santé des imports","/imports"],["search","SEO & Google","/seo"],["growth","Croissance","/growth"]]},
 {label:"Marketing",items:[["campaign","Influenceurs & partenariats","/influenceurs"]]},
 {label:"Configuration",items:[["categories","Catégories","/categories"],["content","Navigation & contenu","/content"],["campaign","Offres & campagnes","/commercial"],["campaign","Black Friday","/commercial/black-friday"],["bell","E-mails & notifications","/notifications"],["settings","Site & Apparence","/settings"],["plug","Intégrations & API","/integrations"],["server","Interface application","/mobile-ui"],["server","Publication Android","/mobile-release"],["server","État du système","/system"],["audit","Journal admin","/audit"]]},
];
const mobileItems:NavItem[]=[["dashboard","Accueil","/"],["shield","Modération","/moderation"],["list","Annonces","/listings"],["users","Utilisateurs","/users"]];
function activePath(path:string,href:string){return href==="/"?path==="/":path.startsWith(href)}
export function AdminShell({user,children}:{user:User;children:React.ReactNode}){
 const path=usePathname();
 const accessible=new Set(visibleAdminGroups(user.roles).flatMap(group=>group.items.map(item=>item.href)));
 const displayedGroups=groups.map(group=>({...group,items:group.items.filter(([, ,href])=>accessible.has(href))})).filter(group=>group.items.length>0);
 const displayedMobileItems=mobileItems.filter(([, ,href])=>accessible.has(href));
 const[open,setOpen]=useState(false);const[brand,setBrand]=useState<Brand>({siteName:"Petit Annonces",logoUrl:null});
 useEffect(()=>{let active=true;fetch("/api/public/site-config",{cache:"no-store"}).then(async r=>{if(r.ok&&active){const p=await r.json() as {site?:Partial<Brand>};setBrand({siteName:p.site?.siteName??"Petit Annonces",logoUrl:p.site?.logoUrl??null})}}).catch(()=>{});return()=>{active=false}},[]);
 useEffect(()=>{setOpen(false)},[path]);
 useEffect(()=>{if(!open)return;const previous=document.body.style.overflow;document.body.style.overflow="hidden";const onKey=(event:KeyboardEvent)=>{if(event.key==="Escape")setOpen(false)};window.addEventListener("keydown",onKey);return()=>{document.body.style.overflow=previous;window.removeEventListener("keydown",onKey)}},[open]);
 async function logout(){await fetch("/api/auth/logout",{method:"POST",credentials:"include"}).catch(()=>{});location.href="/connexion"}
 const current=displayedGroups.flatMap(g=>g.items).filter(([, ,href])=>activePath(path,href)).sort((a,b)=>b[2].length-a[2].length)[0];
 return <div className="admin-app">
  {open&&<button type="button" aria-label="Fermer le menu" className="admin-overlay" onClick={()=>setOpen(false)}/>}
  <aside className={`admin-sidebar ${open?"open":""}`} aria-label="Navigation administration">
   <div className="admin-sidebar-mobile-head"><span>Menu</span><button type="button" aria-label="Fermer le menu" onClick={()=>setOpen(false)}>×</button></div>
   <a className="admin-brand" href="/">{brand.logoUrl?<span className="admin-brand-logo"><img src={brand.logoUrl} alt={brand.siteName}/></span>:<span className="admin-brand-mark">PA</span>}<span className="admin-brand-copy"><strong>{brand.siteName}</strong><span>Administration</span></span></a>
   {displayedGroups.map(group=><div className="admin-nav-group" key={group.label}><div className="admin-nav-label">{group.label}</div><nav className="admin-nav">{group.items.map(([icon,label,href])=><a className={activePath(path,href)?"active":""} href={href} key={href} aria-current={activePath(path,href)?"page":undefined}><span className="admin-nav-icon"><AdminIcon name={icon}/></span><span>{label}</span></a>)}</nav></div>)}
   <div className="admin-sidebar-footer"><div className="admin-profile"><span className="admin-avatar">{user.name.slice(0,2).toUpperCase()}</span><span className="admin-profile-text"><strong>{user.name}</strong><small>{user.email}</small></span></div><button type="button" className="admin-logout" onClick={logout}><AdminIcon name="logout"/>Se déconnecter</button></div>
  </aside>
  <div className="admin-main"><header className="admin-topbar"><div className="admin-topbar-left"><button type="button" className="admin-mobile-menu" aria-label="Ouvrir le menu" onClick={()=>setOpen(true)}><AdminIcon name="menu"/></button><div className="admin-topbar-title"><small>Petit Annonces Admin</small><strong>{current?.[1]??"Administration"}</strong></div></div><div className="admin-topbar-actions"><a href="https://petitannonces.fr" target="_blank" rel="noreferrer"><AdminIcon name="external"/><span>Voir le site</span></a>{accessible.has("/moderation")&&<a className="primary" href="/moderation"><AdminIcon name="shield"/><span>Modération</span></a>}</div></header><div className="admin-content">{children}</div></div>
  <nav className="admin-mobile-bottom" aria-label="Navigation rapide">{displayedMobileItems.map(([icon,label,href])=><a key={href} href={href} className={activePath(path,href)?"active":""} aria-current={activePath(path,href)?"page":undefined}><AdminIcon name={icon}/><span>{label}</span></a>)}<button type="button" className={open?"active":""} onClick={()=>setOpen(true)} aria-label="Ouvrir toutes les rubriques"><AdminIcon name="menu"/><span>Plus</span></button></nav>
 </div>
}
