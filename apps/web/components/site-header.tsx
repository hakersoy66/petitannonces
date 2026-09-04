"use client";

import { useEffect, useState } from "react";

const navItems = [
  { label: "Acheter", href: "/#annonces" },
  { label: "Catégories", href: "/#categories" },
  { label: "Boutiques", href: "/#boutiques" },
];

type HeaderSummary={unreadConversations:number;pendingOffers:number;unreadNotifications:number};
function apiBase(){return (process.env.NEXT_PUBLIC_API_URL??"http://127.0.0.1:4000").replace(/\/$/,"");}

export function SiteHeader() {
  const [authenticated,setAuthenticated]=useState(false);
  const [summary,setSummary]=useState<HeaderSummary>({unreadConversations:0,pendingOffers:0,unreadNotifications:0});
  useEffect(()=>{
    let active=true;
    Promise.all([
      fetch(`${apiBase()}/auth/me`,{credentials:"include"}),
      fetch(`${apiBase()}/account/message-summary`,{credentials:"include"}),
    ]).then(async([meRes,sumRes])=>{
      if(!active)return;
      if(!meRes.ok){setAuthenticated(false);return;}
      setAuthenticated(true);
      if(sumRes.ok)setSummary(await sumRes.json() as HeaderSummary);
    }).catch(()=>{});
    return()=>{active=false};
  },[]);
  const combined=summary.unreadConversations+summary.unreadNotifications;
  return (
    <header className="site-header">
      <div className="shell header-inner">
        <a className="brand" href="/" aria-label="Petit Annonces, accueil">
          <span className="brand-mark" aria-hidden="true">pa</span>
          <span className="brand-copy"><strong>Petit Annonces</strong><small>France</small></span>
        </a>
        <nav className="desktop-nav" aria-label="Navigation principale">{navItems.map((item)=><a key={item.label} href={item.href}>{item.label}</a>)}</nav>
        <div className="header-actions">
          <a className="icon-action" href={authenticated?"/mon-compte/favoris":"/connexion?next=%2Fmon-compte%2Ffavoris"} aria-label="Mes favoris">♡</a>
          {authenticated&&<a className="icon-action" href="/messages" aria-label={`${summary.unreadConversations} message(s) non lu(s)`} style={{position:"relative"}}>✉{summary.unreadConversations>0&&<span style={{position:"absolute",right:-6,top:-7,minWidth:18,height:18,padding:"0 5px",borderRadius:999,background:"#dc2626",color:"#fff",fontSize:11,fontWeight:800,display:"grid",placeItems:"center"}}>{summary.unreadConversations>99?"99+":summary.unreadConversations}</span>}</a>}
          {authenticated&&<a className="icon-action" href="/mon-compte/notifications" aria-label={`${summary.unreadNotifications} notification(s) non lue(s)`} style={{position:"relative"}}>♢{summary.unreadNotifications>0&&<span style={{position:"absolute",right:-6,top:-7,minWidth:18,height:18,padding:"0 5px",borderRadius:999,background:"#7c3aed",color:"#fff",fontSize:11,fontWeight:800,display:"grid",placeItems:"center"}}>{summary.unreadNotifications>99?"99+":summary.unreadNotifications}</span>}</a>}
          <a className="account-link" href={authenticated?"/mon-compte":"/connexion"}>{authenticated?"Mon compte":"Connexion"}{authenticated&&combined>0?` · ${combined}`:""}</a>
          <a className="button button-primary button-compact" href="/deposer-une-annonce"><span className="button-plus" aria-hidden="true">+</span>Déposer une annonce</a>
        </div>
      </div>
    </header>
  );
}
