"use client";

import { useEffect,useState } from "react";
import { AccountSidebar } from "../../../components/account-sidebar";
import { AppIcon } from "../../../components/app-icon";
import { FollowButton } from "../../../components/follow-button";
import styles from "./page.module.css";

const api=()=> (process.env.NEXT_PUBLIC_API_URL??"/api").replace(/\/$/,"");
type Follow={id:string;targetType:"USER"|"STORE";targetId:string;createdAt:string;name:string|null;slug:string|null;avatarUrl:string|null};

export default function FollowedAccountsPage(){
 const[items,setItems]=useState<Follow[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState("");
 async function load(){setLoading(true);setError("");try{const r=await fetch(`${api()}/account/follows`,{credentials:"include",cache:"no-store"});if(r.status===401||r.status===403){location.href="/connexion?next=%2Fmon-compte%2Fsuivis";return}if(!r.ok)throw new Error();const p=await r.json() as {follows?:Follow[]};setItems(p.follows??[])}catch{setError("Impossible de charger vos comptes suivis pour le moment.")}finally{setLoading(false)}}
 useEffect(()=>{void load();const sync=(event:Event)=>{const d=(event as CustomEvent<{targetType:"USER"|"STORE";targetId:string;following:boolean}>).detail;if(d&&!d.following)setItems(v=>v.filter(x=>!(x.targetType===d.targetType&&x.targetId===d.targetId)))};window.addEventListener("pa:follows-changed",sync);return()=>window.removeEventListener("pa:follows-changed",sync)},[]);
 return <div className={styles.page}><main className={styles.shell}><AccountSidebar/><section className={styles.content}>
  <header className={styles.hero}><div><span>Vos abonnements</span><h1>Comptes suivis</h1><p>Retrouvez les vendeurs et boutiques que vous suivez. Lorsqu’ils publient une nouvelle annonce, Petit Annonces peut vous prévenir dans l’application et par notification push selon vos préférences.</p></div><div className={styles.heroCount}><strong>{items.length}</strong><small>compte{items.length>1?"s":""} suivi{items.length>1?"s":""}</small></div></header>
  <nav className={styles.quickNav}><a href="/mon-compte/favoris"><AppIcon name="heart"/>Favoris</a><a className={styles.active} href="/mon-compte/suivis"><AppIcon name="bell"/>Comptes suivis</a><a href="/mon-compte/notifications"><AppIcon name="bell"/>Notifications</a></nav>
  {error&&<div className={styles.error}><span><AppIcon name="info"/>{error}</span><button type="button" onClick={()=>void load()}>Réessayer</button></div>}
  {loading?<div className={styles.skeleton}>{[0,1,2,3].map(i=><i key={i}/>)}</div>:items.length===0?<section className={styles.empty}><span><AppIcon name="bell"/></span><h2>Vous ne suivez encore aucun vendeur</h2><p>Depuis une annonce, un profil vendeur ou une boutique professionnelle, utilisez le bouton « Suivre » pour être informé des prochaines publications.</p><a href="/recherche">Découvrir les annonces</a></section>:<section className={styles.list}>{items.map(item=>{const href=item.targetType==="STORE"&&item.slug?`/boutique/${item.slug}`:`/profil/${item.targetId}`;const initials=(item.name??"PA").trim().slice(0,2).toUpperCase();return <article key={item.id} className={styles.card}><a className={styles.identity} href={href}><span className={styles.avatar}>{item.avatarUrl?<img src={item.avatarUrl} alt=""/>:initials}</span><span className={styles.copy}><small>{item.targetType==="STORE"?"BOUTIQUE PROFESSIONNELLE":"VENDEUR"}</small><strong>{item.name??"Membre Petit Annonces"}</strong><em>Suivi depuis le {new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"short",year:"numeric"}).format(new Date(item.createdAt))}</em></span><AppIcon name="chevron-right"/></a><FollowButton targetType={item.targetType} targetId={item.targetId} label={item.targetType==="STORE"?"Suivre la boutique":"Suivre le vendeur"} followingLabel="Suivi"/></article>})}</section>}
 </section></main></div>;
}
