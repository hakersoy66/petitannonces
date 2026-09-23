"use client";

import {useEffect,useMemo,useState} from "react";
import {AppIcon} from "./app-icon";
import styles from "./listing-appointment-button.module.css";

type Busy={startAt:string;endAt:string};
type Props={listingId:string;domain:string;compact?:boolean;className?:string};

function api(){return(process.env.NEXT_PUBLIC_API_URL??"/api").replace(/\/$/,"")}
function ymd(d:Date){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`}
function initialDate(){const d=new Date();d.setDate(d.getDate()+1);return ymd(d)}
function maxDate(){const d=new Date();d.setDate(d.getDate()+60);return ymd(d)}
function parisDate(date:string,minutes:number){
 const [y,m,d]=date.split("-").map(Number);const h=Math.floor(minutes/60),min=minutes%60;
 let guess=new Date(Date.UTC(y!,m!-1,d!,h,min,0));
 const fmt=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
 for(let i=0;i<2;i++){
  const p=Object.fromEntries(fmt.formatToParts(guess).filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));
  const represented=Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour),Number(p.minute),Number(p.second));
  const offset=represented-guess.getTime();guess=new Date(Date.UTC(y!,m!-1,d!,h,min,0)-offset);
 }
 return guess;
}

export function ListingAppointmentButton({listingId,domain,compact=false,className=""}:Props){
 const isVehicle=domain==="VEHICLE";const label=isVehicle?"Réserver un essai":"Prendre rendez-vous";const shortLabel=isVehicle?"Essai":"Visite";
 const[open,setOpen]=useState(false),[date,setDate]=useState(initialDate),[busy,setBusy]=useState<Busy[]>([]),[loading,setLoading]=useState(false),[selected,setSelected]=useState<number|null>(null),[notes,setNotes]=useState(""),[error,setError]=useState(""),[success,setSuccess]=useState(false),[submitting,setSubmitting]=useState(false);
 useEffect(()=>{if(typeof window!=="undefined"&&new URLSearchParams(window.location.search).get("booking")==="1")setOpen(true)},[]);
 useEffect(()=>{if(!open||!date)return;let stop=false;setLoading(true);setSelected(null);setError("");fetch(`${api()}/listings/${encodeURIComponent(listingId)}/appointments/availability?date=${encodeURIComponent(date)}`,{credentials:"include",cache:"no-store"}).then(async r=>{if(!r.ok)throw new Error();return r.json()}).then(p=>{if(!stop)setBusy(p.busy??[])}).catch(()=>{if(!stop)setError("Impossible de charger les créneaux pour le moment.")}).finally(()=>{if(!stop)setLoading(false)});return()=>{stop=true}},[open,date,listingId]);
 const slots=useMemo(()=>{const out:Array<{minutes:number;label:string;start:Date;end:Date}>=[];for(let minutes=9*60;minutes<=17*60+30;minutes+=30){const start=parisDate(date,minutes),end=new Date(start.getTime()+30*60000);if(start.getTime()<Date.now()+15*60000)continue;const conflict=busy.some(x=>new Date(x.startAt).getTime()<end.getTime()&&new Date(x.endAt).getTime()>start.getTime());if(!conflict)out.push({minutes,label:`${String(Math.floor(minutes/60)).padStart(2,"0")}:${String(minutes%60).padStart(2,"0")}`,start,end})}return out},[date,busy]);
 function close(){setOpen(false);setError("");setSuccess(false);setSelected(null);setNotes("")}
 async function submit(){const slot=slots.find(x=>x.minutes===selected);if(!slot)return;setSubmitting(true);setError("");try{const r=await fetch(`${api()}/listings/${encodeURIComponent(listingId)}/appointments`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({startAt:slot.start.toISOString(),endAt:slot.end.toISOString(),notes:notes.trim()||undefined})});const p=await r.json().catch(()=>({}));if(r.status===401){window.location.href=`/connexion?next=${encodeURIComponent(`${window.location.pathname}?booking=1`)}`;return}if(r.status===409&&p.error==="slot_unavailable"){setError("Ce créneau vient d’être réservé. Choisissez-en un autre.");setBusy(v=>[...v,{startAt:slot.start.toISOString(),endAt:slot.end.toISOString()}]);setSelected(null);return}if(!r.ok){setError(p.error==="cannot_book_own_listing"?"Vous ne pouvez pas réserver sur votre propre annonce.":"La demande n’a pas pu être envoyée.");return}setSuccess(true)}catch{setError("Connexion interrompue. Réessayez dans un instant.")}finally{setSubmitting(false)}}
 return <>
  <button type="button" className={`${styles.trigger} ${compact?styles.compact:""} ${className}`} onClick={()=>setOpen(true)}><AppIcon name="calendar"/>{compact?shortLabel:label}</button>
  {open&&<div className={styles.overlay} onMouseDown={e=>{if(e.target===e.currentTarget)close()}}><section className={styles.modal} role="dialog" aria-modal="true" aria-label={label}><button className={styles.close} type="button" onClick={close} aria-label="Fermer">×</button>{success?<div className={styles.success}><span><AppIcon name="circle-check"/></span><h2>Demande envoyée</h2><p>Le professionnel a reçu votre demande. Vous serez informé dès qu’elle sera confirmée.</p><button type="button" onClick={close}>Fermer</button></div>:<><header><span className={styles.icon}><AppIcon name="calendar"/></span><div><small>{isVehicle?"Essai du véhicule":"Visite du bien"}</small><h2>{label}</h2><p>Choisissez un créneau. Le professionnel pourra ensuite confirmer votre demande.</p></div></header><label className={styles.dateLabel}>Date<input type="date" min={ymd(new Date())} max={maxDate()} value={date} onChange={e=>setDate(e.target.value)}/></label><div className={styles.slotTitle}><strong>Créneaux disponibles</strong><small>Heure de Paris</small></div>{loading?<div className={styles.loading}>Chargement…</div>:slots.length?<div className={styles.slots}>{slots.map(slot=><button type="button" key={slot.minutes} className={selected===slot.minutes?styles.selected:""} onClick={()=>setSelected(slot.minutes)}>{slot.label}</button>)}</div>:<div className={styles.empty}>Aucun créneau disponible ce jour-là.</div>}<label className={styles.notes}>Message <span>(facultatif)</span><textarea maxLength={1000} value={notes} onChange={e=>setNotes(e.target.value)} placeholder={isVehicle?"Ex. Je souhaite essayer ce véhicule avant achat.":"Ex. Je souhaite visiter le bien et poser quelques questions."}/></label>{error&&<div className={styles.error}>{error}</div>}<button type="button" className={styles.submit} disabled={selected===null||submitting} onClick={()=>void submit()}>{submitting?"Envoi…":"Envoyer la demande"}</button></>}</section></div>}
 </>
}
