"use client";

import { MouseEvent, useEffect, useState } from "react";
import styles from "./favorite-button.module.css";

const apiBase=()=> (process.env.NEXT_PUBLIC_API_URL??"http://127.0.0.1:4000").replace(/\/$/,"");
let favoriteIds:Set<string>|null=null;
let favoritesPromise:Promise<Set<string>|null>|null=null;

async function loadFavorites(){
 if(favoriteIds)return favoriteIds;
 if(!favoritesPromise){
  favoritesPromise=fetch(`${apiBase()}/account/favorites`,{credentials:"include"}).then(async r=>{
   if(r.status===401||r.status===403)return null;
   if(!r.ok)throw new Error("favorites_load_failed");
   const payload=await r.json() as {favorites:Array<{listingId:string}>};
   favoriteIds=new Set(payload.favorites.map(item=>item.listingId));
   return favoriteIds;
  }).finally(()=>{favoritesPromise=null;});
 }
 return favoritesPromise;
}

function safeReturnPath(){
 const path=`${window.location.pathname}${window.location.search}${window.location.hash}`;
 return path.startsWith("/")&&!path.startsWith("//")?path:"/";
}

export function FavoriteButton({listingId,compact=false,className=""}:{listingId:string;compact?:boolean;className?:string}){
 const [favorite,setFavorite]=useState(false);const [ready,setReady]=useState(false);const [busy,setBusy]=useState(false);
 useEffect(()=>{
  let active=true;
  void loadFavorites().then(ids=>{if(active){setFavorite(ids?.has(listingId)??false);setReady(true);}}).catch(()=>{if(active)setReady(true);});
  const sync=(event:Event)=>{const detail=(event as CustomEvent<{listingId:string;favorite:boolean}>).detail;if(detail?.listingId===listingId)setFavorite(detail.favorite);};
  window.addEventListener("pa:favorites-changed",sync);return()=>{active=false;window.removeEventListener("pa:favorites-changed",sync)};
 },[listingId]);
 async function toggle(e:MouseEvent<HTMLButtonElement>){
  e.preventDefault();e.stopPropagation();if(busy)return;setBusy(true);
  try{
   const r=await fetch(`${apiBase()}/account/favorites/${encodeURIComponent(listingId)}`,{method:favorite?"DELETE":"POST",credentials:"include"});
   if(r.status===401||r.status===403){window.location.href=`/connexion?next=${encodeURIComponent(safeReturnPath())}`;return;}
   if(!r.ok)throw new Error("favorite_update_failed");
   const next=!favorite;setFavorite(next);favoriteIds??=new Set<string>();if(next)favoriteIds.add(listingId);else favoriteIds.delete(listingId);
   window.dispatchEvent(new CustomEvent("pa:favorites-changed",{detail:{listingId,favorite:next}}));
  }finally{setBusy(false)}
 }
 const label=favorite?"Retirer des favoris":"Ajouter aux favoris";
 return <button type="button" className={`${styles.button} ${compact?styles.compact:""} ${favorite?styles.active:""} ${className}`.trim()} onClick={toggle} disabled={busy} aria-label={label} aria-pressed={favorite} title={label}><span aria-hidden="true">{favorite?"♥":"♡"}</span>{!compact&&<b>{ready?(favorite?"Dans mes favoris":"Ajouter aux favoris"):"Favoris"}</b>}</button>;
}
