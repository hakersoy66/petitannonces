"use client";

import {useState} from "react";
import {AppIcon} from "./app-icon";
import styles from "./search-view-controls.module.css";

const api=()=> (process.env.NEXT_PUBLIC_API_URL??"/api").replace(/\/$/,"");
type Props={view:"list"|"map"};

export function SearchViewControls({view}:Props){
  const[locating,setLocating]=useState(false);const[error,setError]=useState("");
  function switchView(next:"list"|"map"){
    const url=new URL(window.location.href);url.searchParams.delete("page");
    if(next==="map")url.searchParams.set("view","map");else url.searchParams.delete("view");
    window.location.assign(`${url.pathname}${url.searchParams.size?`?${url.searchParams.toString()}`:""}`);
  }
  async function aroundMe(){
    if(!navigator.geolocation){setError("La localisation n’est pas disponible sur cet appareil.");return}
    setLocating(true);setError("");
    try{
      const position=await new Promise<GeolocationPosition>((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:false,timeout:9000,maximumAge:300000}));
      const response=await fetch(`${api()}/search/around-me`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({latitude:position.coords.latitude,longitude:position.coords.longitude})});
      const payload=await response.json().catch(()=>null) as {city?:string;postalCode?:string;radiusKm?:number;nearToken?:string}|null;
      if(!response.ok||!payload?.city||!payload.nearToken)throw new Error("location_not_resolved");
      const url=new URL(window.location.href);url.searchParams.set("view","map");url.searchParams.set("city",payload.city);url.searchParams.set("radiusKm",String(payload.radiusKm??25));url.searchParams.set("near",payload.nearToken);
      for(const key of ["north","south","east","west","lat","lng","page"])url.searchParams.delete(key);
      window.location.assign(`${url.pathname}?${url.searchParams.toString()}`);
    }catch(err){
      const code=(err as GeolocationPositionError)?.code;
      setError(code===1?"Autorisez la localisation pour afficher les annonces autour de vous.":"Impossible de déterminer votre zone pour le moment.");
    }finally{setLocating(false)}
  }
  return <div className={styles.shell}>
    <div className={styles.segmented} role="group" aria-label="Mode d’affichage">
      <button type="button" className={view==="list"?styles.active:""} onClick={()=>switchView("list")}><AppIcon name="list"/>Liste</button>
      <button type="button" className={view==="map"?styles.active:""} onClick={()=>switchView("map")}><AppIcon name="map"/>Carte</button>
    </div>
    <button type="button" className={styles.around} disabled={locating} onClick={()=>void aroundMe()}><AppIcon name="location"/>{locating?"Localisation…":"Autour de moi"}</button>
    {error&&<span className={styles.error}>{error}</span>}
  </div>
}
