"use client";

import { MouseEvent, useEffect, useState } from "react";
import styles from "./favorite-button.module.css";
import { AppIcon } from "./app-icon";

const apiBase=()=> (process.env.NEXT_PUBLIC_API_URL??"/api").replace(/\/$/,"");
let favoriteIds:Set<string>|null=null;
let favoritesPromise:Promise<Set<string>|null>|null=null;

async function loadFavorites(){
 if(favoriteIds)return favoriteIds;
 if(!favoritesPromise){
  favoritesPromise=fetch(`${apiBase()}/account/favorites`,{credentials:"include"}).then(async r=>{
   if(r.status===401||r.status===403){favoriteIds=new Set(["__pa_guest__"]);return favoriteIds;}
   if(!r.ok)throw new Error("favorites_load_failed");
   const payload=await r.json() as {favorites:Array<{listingId:string}>};
   favoriteIds=new Set(payload.favorites.map(item=>item.listingId));
   return favoriteIds;
  }).finally(()=>{favoritesPromise=null;});
 }
 return favoritesPromise;
}

export function FavoriteButton({listingId,compact=false,className=""}:{listingId:string;compact?:boolean;className?:string}){
 const [favorite,setFavorite]=useState(false),[ready,setReady]=useState(false),[guest,setGuest]=useState(false),[busy,setBusy]=useState(false);
 useEffect(()=>{let active=true;void loadFavorites().then(ids=>{if(active){setGuest(ids===null);setFavorite(ids?.has(listingId)??false);setReady(true)}}).catch(()=>{if(active)setReady(true)});return()=>{active=false}},[listingId]);
 const label=favorite?"Retirer des favoris":"Ajouter aux favoris";
 if(guest)return <a className={`${styles.button} ${compact?styles.compact:""} ${className}`.trim()} href="/connexion" aria-label="Se connecter pour ajouter aux favoris" title="Se connecter pour ajouter aux favoris"><span aria-hidden="true"><AppIcon name="heart"/></span>{!compact&&<b>Ajouter aux favoris</b>}</a>;
 async function toggle(e:MouseEvent<HTMLButtonElement>){e.preventDefault();e.stopPropagation();if(busy)return;setBusy(true);try{
  const r=await fetch(`${apiBase()}/account/favorites/${encodeURIComponent(listingId)}`,{method:favorite?"DELETE":"POST",credentials:"include"});
  if(r.status===401||r.status===403){setGuest(true);return}if(!r.ok)throw new Error("favorite_update_failed");
  const next=!favorite;setFavorite(next);favoriteIds??=new Set<string>();if(next)favoriteIds.add(listingId);else favoriteIds.delete(listingId);
 }finally{setBusy(false)}}
 return <button type="button" className={`${styles.button} ${compact?styles.compact:""} ${favorite?styles.active:""} ${className}`.trim()} onClick={toggle} disabled={busy} aria-label={label} aria-pressed={favorite} title={label}><span aria-hidden="true"><AppIcon name="heart"/></span>{!compact&&<b>{ready?(favorite?"Dans mes favoris":"Ajouter aux favoris"):"Favoris"}</b>}</button>;
}
