"use client";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AdminIcon, type AdminIconName } from "./admin-icon";
import { visibleAdminGroups, adminSearchMatch } from "../lib/admin-navigation";

type User={email:string;name:string;roles:string[]};
type Brand={siteName:string;logoUrl:string|null};
type NavItem=[AdminIconName,string,string];
type NavGroup={label:string;items:NavItem[]};
const mobileItems:NavItem[]=[["dashboard","Accueil","/"],["shield","Modération","/moderation"],["list","Annonces","/listings"],["users","Utilisateurs","/users"]];
function activePath(path:string,href:string){return href==="/"?path==="/":path===href||path.startsWith(href+"/")}
export function AdminShell({user,children}:{user:User;children:React.ReactNode}){
 const path=usePathname();
 const accessible=new Set(visibleAdminGroups(user.roles).flatMap(group=>group.items.map(item=>item.href)));
 const displayedGroups:NavGroup[]=visibleAdminGroups(user.roles).map(g=>({label:g.label,items:g.items.map(i=>[i.icon,i.label,i.href])}));
 const displayedMobileItems=mobileItems.filter(([, ,href])=>accessible.has(href));
 const [query,setQuery]=useState("");const [expanded,setExpanded]=useState<string[]>(()=>["Pilotage",...displayedGroups.filter(g=>g.label!=="Pilotage"&&g.items.some(([, ,href])=>activePath(path,href))).map(g=>g.label)]);
 const[open,setOpen]=useState(false);const[brand,setBrand]=useState<Brand>({siteName:"Petit Annonces",logoUrl:null});
 useEffect(()=>{let active=true;fetch("/api/public/site-config",{cache:"no-store"}).then(async r=>{if(r.ok&&active){const p=await r.json() as {site?:Partial<Brand>};setBrand({siteName:p.site?.siteName??"Petit Annonces",logoUrl:p.site?.logoUrl??null})}}).catch(()=>{});return()=>{active=false}},[]);
 useEffect(()=>{setOpen(false);setQuery("");const group=displayedGroups.find(g=>g.items.some(([, ,href])=>activePath(path,href)));if(group)setExpanded(prev=>prev.includes(group.label)?prev:[...prev,group.label])},[path]);
 useEffect(()=>{if(!open)return;const previous=document.body.style.overflow;document.body.style.overflow="hidden";const onKey=(event:KeyboardEvent)=>{if(event.key==="Escape")setOpen(false)};window.addEventListener("keydown",onKey);return()=>{document.body.style.overflow=previous;window.removeEventListener("keydown",onKey)}},[open]);
 async function logout(){await fetch("/api/auth/logout",{method:"POST",credentials:"include"}).catch(()=>{});location.href="/connexion"}
 const current=displayedGroups.flatMap(g=>g.items).filter(([, ,href])=>activePath(path,href)).sort((a,b)=>b[2].length-a[2].length)[0];
 const currentGroup=displayedGroups.find(g=>g.items.some(([, ,href])=>href===current?.[2]))?.label;
 const searching=Boolean(query.trim());
 const filtered=displayedGroups.map(g=>({...g,items:g.items.filter(([,label])=>!searching||adminSearchMatch(label,query)||adminSearchMatch(g.label,query))})).filter(g=>g.items.length);
 return <div className="admin-app admin-redesign">
  {open&&<button type="button" aria-label="Fermer le menu" className="admin-overlay" onClick={()=>setOpen(false)}/>}
  <aside className={`admin-sidebar ${open?"open":""}`} aria-label="Navigation administration">
   <div className="admin-sidebar-mobile-head"><span>Menu</span><button type="button" aria-label="Fermer le menu" onClick={()=>setOpen(false)}>×</button></div>
   <a className="admin-brand" href="/">{brand.logoUrl?<span className="admin-brand-logo"><img src={brand.logoUrl} alt={brand.siteName}/></span>:<span className="admin-brand-mark">PA</span>}<span className="admin-brand-copy"><strong>{brand.siteName}</strong><span>Administration</span></span></a>
   <div className="admin-nav-search"><AdminIcon name="search"/><input aria-label="Rechercher une rubrique" placeholder="Rechercher une rubrique…" value={query} onChange={e=>setQuery(e.target.value)}/></div>
   <div className="admin-nav-scroll">{filtered.map(group=>{const show=searching||expanded.includes(group.label);return <div className="admin-nav-group" key={group.label}><button type="button" className={currentGroup===group.label?"admin-nav-heading current":"admin-nav-heading"} aria-expanded={show} onClick={()=>{if(!searching)setExpanded(prev=>prev.includes(group.label)?prev.filter(v=>v!==group.label):[...prev,group.label])}}><span>{group.label}</span><b aria-hidden="true">{show?"−":"+"}</b></button>{show&&<nav className="admin-nav" aria-label={group.label}>{group.items.map(([icon,label,href])=><a className={current?.[2]===href?"active":""} href={href} key={href} aria-current={current?.[2]===href?"page":undefined}><span className="admin-nav-icon"><AdminIcon name={icon}/></span><span>{label}</span></a>)}</nav>}</div>})}{filtered.length===0&&<p className="admin-nav-empty">Aucune rubrique trouvée.</p>}</div>
   <div className="admin-sidebar-footer"><div className="admin-profile"><span className="admin-avatar">{user.name.slice(0,2).toUpperCase()}</span><span className="admin-profile-text"><strong>{user.name}</strong><small>{user.email}</small></span></div><button type="button" className="admin-logout" onClick={logout}><AdminIcon name="logout"/>Se déconnecter</button></div>
  </aside>
  <div className="admin-main"><header className="admin-topbar"><div className="admin-topbar-left"><button type="button" className="admin-mobile-menu" aria-label="Ouvrir le menu" onClick={()=>setOpen(true)}><AdminIcon name="menu"/></button><div className="admin-topbar-title"><small>{currentGroup??"Administration"}</small><strong>{current?.[1]??"Administration"}</strong></div></div><div className="admin-topbar-actions"><a href="https://petitannonces.fr" target="_blank" rel="noreferrer"><AdminIcon name="external"/><span>Voir le site</span></a>{accessible.has("/moderation")&&<a className="primary" href="/moderation"><AdminIcon name="shield"/><span>Modération</span></a>}</div></header><div className="admin-content">{children}</div></div>
  <nav className="admin-mobile-bottom" aria-label="Navigation rapide">{displayedMobileItems.map(([icon,label,href])=><a key={href} href={href} className={activePath(path,href)?"active":""} aria-current={activePath(path,href)?"page":undefined}><AdminIcon name={icon}/><span>{label}</span></a>)}<button type="button" className={open?"active":""} onClick={()=>setOpen(true)} aria-label="Ouvrir toutes les rubriques"><AdminIcon name="menu"/><span>Plus</span></button></nav>
 </div>
}
