"use client";
import { useEffect,useState } from "react";
import { AccountSidebar } from "../../../components/account-sidebar";
import { AppIcon } from "../../../components/app-icon";
import { MarketplaceListingCard } from "../../../components/marketplace-listing-card";
import { fetchWithRetry } from "../../../lib/fetch-resilient";
import styles from "./page.module.css";
function api(){return (process.env.NEXT_PUBLIC_API_URL??"/api").replace(/\/$/,"")}
type Fav={id:string;listingId:string;title:string|null;slug:string|null;priceMinor:number|null;currency:string;city:string|null;categoryName:string;categorySlug?:string|null;categoryDomain:string;propertyTransactionType:string|null;imageUrl:string|null};
export default function FavoritesPage(){
 const [items,setItems]=useState<Fav[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState("");
 async function load(){setLoading(true);setError("");try{const r=await fetchWithRetry(`${api()}/account/favorites`,{credentials:"include",cache:"no-store"},{timeoutMs:7000,retries:1});if(r.status===401){location.href="/connexion?next=%2Fmon-compte%2Ffavoris";return}if(!r.ok)throw new Error();const p=await r.json();setItems(p.favorites??[])}catch{setError("Impossible de charger vos favoris pour le moment.")}finally{setLoading(false)}}
 useEffect(()=>{void load();const sync=(event:Event)=>{const detail=(event as CustomEvent<{listingId:string;favorite:boolean}>).detail;if(detail&&!detail.favorite)setItems(v=>v.filter(x=>x.listingId!==detail.listingId));};window.addEventListener("pa:favorites-changed",sync);return()=>window.removeEventListener("pa:favorites-changed",sync)},[]);
 return <div className={styles.page}><main className={styles.shell}><AccountSidebar/><section className={styles.content}>
  <header className={styles.hero}><div><span className={styles.eyebrow}>Votre sélection</span><h1>Mes favoris</h1><p>Gardez vos annonces préférées sous la main et reprenez votre recherche quand vous le souhaitez.</p></div><div className={styles.heroSide}><strong>{items.length}</strong><span>annonce{items.length>1?"s":""} enregistrée{items.length>1?"s":""}</span><a href="/recherche"><AppIcon name="search"/> Continuer ma recherche</a></div></header>
  <div className={styles.quickNav}><a className={styles.active} href="/mon-compte/favoris"><AppIcon name="heart"/> Favoris</a><a href="/mon-compte/suivis"><AppIcon name="bell"/> Comptes suivis</a><a href="/mon-compte/recherches"><AppIcon name="search"/> Recherches enregistrées</a><a href="/mon-compte/notifications"><AppIcon name="bell"/> Notifications</a></div>
  {error&&<div className={styles.errorState} role="alert"><span><AppIcon name="info"/>{error}</span><button type="button" onClick={()=>void load()}>Réessayer</button></div>}
  {loading?<div className={styles.skeletonGrid}>{Array.from({length:6}).map((_,i)=><i key={i}/>)}</div>:items.length===0?<section className={styles.empty}><span><AppIcon name="heart"/></span><h2>Votre liste est encore vide</h2><p>Repérez une annonce qui vous plaît et touchez le cœur pour la retrouver ici.</p><a href="/recherche">Découvrir les annonces</a></section>:<section className={styles.grid}>{items.map(x=><MarketplaceListingCard key={x.id} item={{id:x.listingId,slug:x.slug,title:x.title,priceMinor:x.priceMinor,currency:x.currency,city:x.city,imageUrl:x.imageUrl,category:{name:x.categoryName,slug:x.categorySlug??"",domain:x.categoryDomain},property:x.propertyTransactionType?{transactionType:x.propertyTransactionType}:null}}/>)}</section>}
 </section></main></div>
}