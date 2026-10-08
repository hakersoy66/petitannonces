"use client";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AdminIcon } from "./admin-icon";
import { adminCurrentItem, adminPathActive, adminSearchMatch, visibleAdminGroups, type AdminNavGroup, type AdminNavItem } from "../lib/admin-navigation";

type User={email:string;name:string;roles:string[]};
type Brand={siteName:string;logoUrl:string|null};
type MobileItem={icon:AdminNavItem["icon"];label:string;href:string};
const mobileItems:MobileItem[]=[
 {icon:"dashboard",label:"Accueil",href:"/"},
 {icon:"shield",label:"Modération",href:"/moderation"},
 {icon:"list",label:"Annonces",href:"/listings"},
 {icon:"users",label:"Utilisateurs",href:"/users"},
];
function flatten(groups:AdminNavGroup[]){return groups.flatMap(group=>group.items);}
export function AdminShell({user,children}:{user:User;children:React.ReactNode}){
 const path=usePathname();
 const navGroups=useMemo(()=>visibleAdminGroups(user.roles),[user.roles]);
 const allItems=useMemo(()=>flatten(navGroups),[navGroups]);
 const current=adminCurrentItem(path,navGroups);
 const activeGroup=navGroups.find(group=>group.items.some(item=>item.href===current?.href))?.label;
 const [open,setOpen]=useState(false);
 const [query,setQuery]=useState("");
 const [collapsed,setCollapsed]=useState<string[]>(()=>["Sécurité & conformité","Ventes & opérations","Marketing & croissance","Configuration"]);
 const [favorites,setFavorites]=useState<string[]>([]);
 const [brand,setBrand]=useState<Brand>({siteName:"Petit Annonces",logoUrl:null});
 const searchRef=useRef<HTMLInputElement>(null);
 const bookmarkKey="pa-admin-bookmarks-v1:"+user.email.toLowerCase();

 useEffect(()=>{let active=true;fetch("/api/public/site-config",{cache:"no-store"}).then(async r=>{if(r.ok&&active){const p=await r.json() as {site?:Partial<Brand>};setBrand({siteName:p.site?.siteName??"Petit Annonces",logoUrl:p.site?.logoUrl??null})}}).catch(()=>{});return()=>{active=false}},[]);
 useEffect(()=>{try{const parsed=JSON.parse(localStorage.getItem(bookmarkKey)??"[]");setFavorites(Array.isArray(parsed)?parsed.filter((x:unknown):x is string=>typeof x==="string").slice(0,10):[])}catch{setFavorites([])}},[bookmarkKey]);
 useEffect(()=>{setOpen(false);setQuery("");if(activeGroup)setCollapsed(previous=>previous.filter(group=>group!==activeGroup))},[path,activeGroup]);
 useEffect(()=>{if(!open)return;const mobile=window.matchMedia("(max-width:860px)").matches;const previous=document.body.style.overflow;if(mobile)document.body.style.overflow="hidden";const onKey=(event:KeyboardEvent)=>{if(event.key==="Escape"){setOpen(false);setQuery("");searchRef.current?.blur()}};window.addEventListener("keydown",onKey);return()=>{if(mobile)document.body.style.overflow=previous;window.removeEventListener("keydown",onKey)}},[open]);
 useEffect(()=>{
  const onKey=(event:KeyboardEvent)=>{
   if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="k"){event.preventDefault();setOpen(true);window.setTimeout(()=>searchRef.current?.focus(),50);return;}
   if(event.key==="/"&&!event.metaKey&&!event.ctrlKey&&!event.altKey&&!(event.target instanceof HTMLInputElement)&&!(event.target instanceof HTMLTextAreaElement)&&!(event.target instanceof HTMLSelectElement)&&!(event.target instanceof HTMLElement&&event.target.isContentEditable)){
    event.preventDefault();setOpen(true);window.setTimeout(()=>searchRef.current?.focus(),50);
   }
  };
  window.addEventListener("keydown",onKey);
  return()=>window.removeEventListener("keydown",onKey);
 },[]);
 async function logout(){await fetch("/api/auth/logout",{method:"POST",credentials:"include"}).catch(()=>{});location.href="/connexion"}
 function searchMenu(){setOpen(true);window.setTimeout(()=>{searchRef.current?.focus();searchRef.current?.scrollIntoView({block:"nearest"})},60)}
 function toggleFavorite(href:string){
  setFavorites(previous=>{
   const next=previous.includes(href)?previous.filter(item=>item!==href):[...previous,href].slice(0,8);
   try{localStorage.setItem(bookmarkKey,JSON.stringify(next))}catch{}
   return next;
  });
 }
 const shownGroups=navGroups.map(group=>({...group,items:group.items.filter(item=>!query||adminSearchMatch(item.label,query)||adminSearchMatch(group.label,query))})).filter(group=>group.items.length>0);
 const favoriteItems=favorites.map(href=>allItems.find(item=>item.href===href)).filter((item):item is AdminNavItem=>Boolean(item));
 const quickItems=mobileItems.filter(item=>allItems.some(allowed=>allowed.href===item.href));
 function navRow(item:AdminNavItem){
  const active=adminPathActive(path,item.href),marked=favorites.includes(item.href);
  return <div key={item.href} className={"admin-nav-row"+(active?" is-current":"")}>
   <a className={active?"active":""} href={item.href} aria-current={active?"page":undefined} onClick={()=>setOpen(false)}>
    <span className="admin-nav-icon"><AdminIcon name={item.icon}/></span><span>{item.label}</span>
   </a>
   <button type="button" className={"admin-nav-bookmark"+(marked?" is-bookmarked":"")} onClick={()=>toggleFavorite(item.href)} aria-label={(marked?"Retirer des favoris : ":"Ajouter aux favoris : ")+item.label} aria-pressed={marked} title={marked?"Retirer des favoris":"Ajouter aux favoris"}>{marked?"★":"☆"}</button>
  </div>;
 }
 return <div className="admin-app">
  <a className="admin-skip-link" href="#admin-main-content">Aller au contenu</a>
  {open&&<button type="button" aria-label="Fermer le menu" className="admin-overlay" onClick={()=>setOpen(false)}/>}
  <aside className={"admin-sidebar"+(open?" open":"")} aria-label="Navigation administration">
   <div className="admin-sidebar-mobile-head"><span>Menu de gestion</span><button type="button" aria-label="Fermer le menu" onClick={()=>setOpen(false)}>×</button></div>
   <a className="admin-brand" href="/">{brand.logoUrl?<span className="admin-brand-logo"><img src={brand.logoUrl} alt={brand.siteName}/></span>:<span className="admin-brand-mark">PA</span>}<span className="admin-brand-copy"><strong>{brand.siteName}</strong><span>Administration</span></span></a>
   <div className="admin-menu-search"><AdminIcon name="search"/><input ref={searchRef} type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Rechercher une rubrique…" aria-label="Rechercher dans le menu" autoComplete="off"/>{query?<button type="button" aria-label="Effacer la recherche" onClick={()=>{setQuery("");searchRef.current?.focus()}}>×</button>:<kbd>/</kbd>}</div>
   {favoriteItems.length>0&&!query&&<section className="admin-nav-favorites" aria-label="Vos raccourcis"><div className="admin-nav-label">★ Vos favoris</div><nav className="admin-nav">{favoriteItems.map(navRow)}</nav></section>}
   <div className="admin-nav-groups">
    {shownGroups.map(group=>{
     const expanded=Boolean(query)||!collapsed.includes(group.label);
     return <section className="admin-nav-group" key={group.label} aria-label={group.label}>
      <button type="button" className="admin-nav-group-toggle" onClick={()=>setCollapsed(previous=>previous.includes(group.label)?previous.filter(g=>g!==group.label):[...previous,group.label])} aria-expanded={expanded} aria-controls={"admin-group-"+group.label.replace(/[^a-zA-Z]/g,"-")}><span>{group.label}</span><small>{group.items.length}</small><span className={"admin-nav-chevron"+(expanded?" expanded":"")}>⌄</span></button>
      <nav id={"admin-group-"+group.label.replace(/[^a-zA-Z]/g,"-")} className="admin-nav" aria-label={group.label} hidden={!expanded}>{group.items.map(navRow)}</nav>
     </section>;
    })}
    {shownGroups.length===0&&<div className="admin-nav-empty">Aucune rubrique trouvée. <button type="button" onClick={()=>setQuery("")}>Effacer la recherche</button></div>}
   </div>
   <div className="admin-sidebar-footer"><div className="admin-profile"><span className="admin-avatar">{user.name.slice(0,2).toUpperCase()}</span><span className="admin-profile-text"><strong>{user.name}</strong><small>{user.email}</small></span></div><button type="button" className="admin-logout" onClick={logout}><AdminIcon name="logout"/>Se déconnecter</button></div>
  </aside>
  <div className="admin-main">
   <header className="admin-topbar">
    <div className="admin-topbar-left"><button type="button" className="admin-mobile-menu" aria-label="Ouvrir le menu" onClick={()=>setOpen(true)}><AdminIcon name="menu"/></button><div className="admin-topbar-title"><small>Administration / {activeGroup??"Gestion"}</small><strong>{current?.label??"Administration"}</strong></div></div>
    <div className="admin-topbar-actions"><button type="button" className="admin-topbar-search-action" onClick={searchMenu} aria-label="Rechercher une rubrique"><AdminIcon name="search"/><span>Rechercher</span><kbd>Ctrl K</kbd></button><a href="https://petitannonces.fr" target="_blank" rel="noreferrer" aria-label="Voir le site public"><AdminIcon name="external"/><span>Voir le site</span></a>{allItems.some(item=>item.href==="/moderation")&&<a className="primary" href="/moderation" aria-label="Modération"><AdminIcon name="shield"/><span>Modération</span></a>}</div>
   </header>
   <main className="admin-content" id="admin-main-content">
    {current&&path!==current.href&&<nav className="admin-detail-breadcrumb" aria-label="Fil d’Ariane"><a href={current.href}>‹ Retour à {current.label.toLocaleLowerCase("fr")}</a><span aria-hidden="true">/</span><strong>Détail</strong></nav>}
    {children}
   </main>
  </div>
  <nav className="admin-mobile-bottom" aria-label="Navigation rapide" style={{gridTemplateColumns:"repeat("+(quickItems.length+1)+",minmax(0,1fr))"}}>{quickItems.map(item=><a key={item.href} href={item.href} className={adminPathActive(path,item.href)?"active":""} aria-current={adminPathActive(path,item.href)?"page":undefined}><AdminIcon name={item.icon}/><span>{item.label}</span></a>)}<button type="button" className={open?"active":""} onClick={searchMenu} aria-label="Rechercher ou ouvrir toutes les rubriques"><AdminIcon name="menu"/><span>Plus</span></button></nav>
 </div>;
}
