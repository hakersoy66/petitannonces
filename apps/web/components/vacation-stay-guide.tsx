"use client";

import {useEffect,useState} from "react";
import {AppIcon} from "./app-icon";
import styles from "./vacation-stay-guide.module.css";

const api=()=> (process.env.NEXT_PUBLIC_API_URL??"/api").replace(/\/$/,"");
type Guide={reservationId:string;listingId:string;title:string|null;checkIn:string;checkOut:string;checkInFrom:string;checkInUntil:string|null;checkOutUntil:string;keyHandoverMode:"IN_PERSON"|"LOCKBOX"|"SMART_LOCK"|"RECEPTION"|"OTHER";arrivalInstructions:string|null;houseRules:string|null;accessInstructions:string|null;accessVisible:boolean;accessRevealAt:string};
const keyLabels:Record<Guide["keyHandoverMode"],string>={IN_PERSON:"Remise en main propre",LOCKBOX:"Boîte à clés",SMART_LOCK:"Serrure connectée",RECEPTION:"Réception",OTHER:"Autre modalité"};
function dateTime(value:string){return new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",timeZone:"Europe/Paris"}).format(new Date(value))}

export function VacationStayGuide({reservationId}:{reservationId:string}){
 const[data,setData]=useState<Guide|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState("");
 useEffect(()=>{let alive=true;(async()=>{setLoading(true);setError("");try{const r=await fetch(`${api()}/vacances/reservations/${encodeURIComponent(reservationId)}/stay-guide`,{credentials:"include",cache:"no-store"});const p=await r.json().catch(()=>null) as Guide|{error?:string}|null;if(!alive)return;if(!r.ok||!p||!("reservationId" in p)){setError("Les informations d’arrivée ne sont pas encore disponibles.");return}setData(p as Guide)}catch{if(alive)setError("Impossible de charger les informations d’arrivée.")}finally{if(alive)setLoading(false)}})();return()=>{alive=false}},[reservationId]);
 if(loading)return <div className={styles.box}><span>Chargement des informations d’arrivée…</span></div>;
 if(error&&!data)return null;
 if(!data)return null;
 return <section className={styles.box}>
  <div className={styles.head}><span><AppIcon name="door"/></span><div><small>VOTRE ARRIVÉE</small><h3>Guide de séjour</h3></div></div>
  <div className={styles.facts}><div><span>Arrivée</span><b>{data.checkInFrom}{data.checkInUntil?` – ${data.checkInUntil}`:""}</b></div><div><span>Départ</span><b>avant {data.checkOutUntil}</b></div><div><span>Remise des clés</span><b>{keyLabels[data.keyHandoverMode]}</b></div></div>
  {data.arrivalInstructions&&<div className={styles.section}><strong><AppIcon name="map"/>Instructions d’arrivée</strong><p>{data.arrivalInstructions}</p></div>}
  {data.houseRules&&<div className={styles.section}><strong><AppIcon name="home"/>Règles du logement</strong><p>{data.houseRules}</p></div>}
  {data.accessVisible&&data.accessInstructions?<div className={`${styles.section} ${styles.access}`}><strong><AppIcon name="lock"/>Accès et remise des clés</strong><p>{data.accessInstructions}</p></div>:!data.accessVisible?<div className={styles.locked}><AppIcon name="shield"/><div><b>Instructions d’accès protégées</b><span>Elles seront disponibles à partir du {dateTime(data.accessRevealAt)} pour limiter l’exposition des codes et consignes sensibles.</span></div></div>:null}
 </section>
}
