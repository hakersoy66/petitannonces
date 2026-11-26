"use client";

import { MouseEvent, useEffect, useState, useRef } from "react";
import styles from "./favorite-button.module.css";
import { AppIcon } from "./app-icon";

const apiBase=()=> (process.env.NEXT_PUBLIC_API_URL??"/api").replace(/\/$/,"");
let favoriteIds:Set<string>|null=null;
let favoritesLoadedAt=0;
let guestCached=false;
let favoritesPromise:Promise<Set<string>|null>|null=null;

async function loadFavorites(){
 if(Date.now()-favoritesLoadedAt<30000)return guestCached?null:favoriteIds;
 if(!favoritesPromise){
  favoritesPromise=fetch(`${apiBase()}/account/favorites`,{credentials:"include",cache:"no-store"}).then(async r=>{
   if(r.status===401||r.status===403){favoriteIds=null;guestCached=true;favoritesLoadedAt=Date.now();return null;}
   if(!r.ok)throw new Error("favorites_load_failed");
   const payload=await r.json() as {favorites:Array<{listingId:string}>};
   favoriteIds=new Set(payload.favorites.map(item=>item.listingId));guestCached=false;favoritesLoadedAt=Date.now();
   return favoriteIds;
  }).finally(()=>{favoritesPromise=null;});
 }
 return favoritesPromise;
}

export function FavoriteButton({listingId,compact=false,className=""}:{listingId:string;compact?:boolean;className?:string}){
 const [favorite,setFavorite]=useState(false),[ready,setReady]=useState(false),[guest,setGuest]=useState(false),[busy,setBusy]=useState(false);
 useEffect(()=>{let active=true;void loadFavorites().then(ids=>{if(active){setGuest(ids===null);setFavorite(ids?.has(listingId)??false);setReady(true)}}).catch(()=>{if(active)setReady(true)});return()=>{active=false}},[listingId]);
 const lock=useRef(false);
 useEffect(()=>{const sync=(event:Event)=>{const d=(event as CustomEvent<{listingId:string;favorite:boolean}>).detail;if(d?.listingId===listingId)setFavorite(d.favorite)};window.addEventListener("pa:favorites-changed",sync);return()=>window.removeEventListener("pa:favorites-changed",sync)},[listingId]);
 const label=favorite?"Retirer des favoris":"Ajouter aux favoris";
 if(guest)return <a className={`${styles.button} ${compact?styles.compact:""} ${className}`.trim()} href="/connexion" aria-label="Se connecter pour ajouter aux favoris" title="Se connecter pour ajouter aux favoris"><span aria-hidden="true"><AppIcon name="heart"/></span>{!compact&&<b>Ajouter aux favoris</b>}</a>;
 async function toggle(e:MouseEvent<HTMLButtonElement>){e.preventDefault();e.stopPropagation();if(lock.current||!ready)return;lock.current=true;setBusy(true);try{
  const r=await fetch(`${apiBase()}/account/favorites/${encodeURIComponent(listingId)}`,{method:favorite?"DELETE":"POST",credentials:"include"});
  if(r.status===401||r.status===403){favoriteIds=null;favoritesLoadedAt=0;setGuest(true);window.location.assign("/connexion?next="+encodeURIComponent(window.location.pathname+window.location.search));return}if(!r.ok)throw new Error("favorite_update_failed");
  const next=!favorite;setFavorite(next);favoriteIds??=new Set<string>();if(next)favoriteIds.add(listingId);else favoriteIds.delete(listingId);window.dispatchEvent(new CustomEvent("pa:favorites-changed",{detail:{listingId,favorite:next}}));
 }catch{setReady(false);favoritesLoadedAt=0;void loadFavorites().then(ids=>{setGuest(ids===null);setFavorite(ids?.has(listingId)??false)}).catch(()=>{}).finally(()=>setReady(true));}finally{lock.current=false;setBusy(false)}}
 return <button type="button" className={`${styles.button} ${compact?styles.compact:""} ${favorite?styles.active:""} ${className}`.trim()} onClick={toggle} disabled={busy||!ready} aria-label={label} aria-pressed={favorite} title={label}><span aria-hidden="true"><AppIcon name="heart"/></span>{!compact&&<b>{ready?(favorite?"Dans mes favoris":"Ajouter aux favoris"):"Favoris"}</b>}</button>;
}
