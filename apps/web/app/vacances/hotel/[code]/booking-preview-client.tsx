"use client";
import {useState} from "react";
import {AppIcon} from "../../../../components/app-icon";
import styles from "../../page.module.css";

type Pax={name:string;surname:string};
type BookingResult={reference:string;status:string;clientReference:string;currency:string|null;total:number|null;hotelName?:string|null;hotelCode:number;checkIn:string;checkOut:string;guests:number};
type CancelSimulation={status:string|null;total:number|null;currency:string|null};

export function HbxBookingPreview({bookingToken,guests,hotelName}:{bookingToken:string;guests:number;hotelName:string}){
 const [holder,setHolder]=useState<Pax>({name:"",surname:""});
 const[paxes,setPaxes]=useState<Pax[]>(()=>Array.from({length:guests},()=>({name:"",surname:""})));
 const[busy,setBusy]=useState<""|"preview"|"book"|"cancel">("");
 const[result,setResult]=useState<null|{ok:boolean;message:string}>(null);
 const[prepared,setPrepared]=useState(false);
 const[booking,setBooking]=useState<BookingResult|null>(null);
 const[cancelSimulation,setCancelSimulation]=useState<CancelSimulation|null>(null);

 function pax(i:number,key:keyof Pax,value:string){setPaxes(prev=>prev.map((p,index)=>index===i?{...p,[key]:value}:p))}
 function login(){const next=window.location.pathname+window.location.search;window.location.href="/connexion?next="+encodeURIComponent(next)}

 async function submit(e:React.FormEvent){
  e.preventDefault();setBusy("preview");setResult(null);setPrepared(false);
  try{
   const r=await fetch("/api/vacances/hbx/booking-preview",{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({bookingToken,holder,paxes})});
   const p=await r.json().catch(()=>({}));
   if(r.ok){setPrepared(true);setResult({ok:true,message:"Données voyageurs validées. Vérifiez les informations puis confirmez la réservation TEST."})}
   else setResult({ok:false,message:p.error==="guest_count_mismatch"?"Le nombre de voyageurs ne correspond plus à l’offre. Relancez la recherche.":"Impossible de préparer la réservation. L’offre a peut-être expiré."});
  }catch{setResult({ok:false,message:"Impossible de préparer la réservation pour le moment."})}finally{setBusy("")}
 }

 async function confirmBooking(){
  if(!prepared||booking)return;setBusy("book");setResult(null);
  try{
   const r=await fetch("/api/vacances/hbx/book",{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({bookingToken,holder,paxes})});
   const p=await r.json().catch(()=>({}));
   if(r.status===401){login();return}
   if(r.ok&&p.booking){setBooking(p.booking as BookingResult);setResult({ok:true,message:"Réservation TEST confirmée chez HBX. Référence : "+p.booking.reference+"."})}
   else if(p.error==="hbx_booking_status_unknown")setResult({ok:false,message:"La confirmation a expiré avant de recevoir la réponse HBX. Ne recommencez pas immédiatement. Référence interne : "+(p.clientReference??"indisponible")+"."});
   else setResult({ok:false,message:"La réservation TEST n’a pas pu être confirmée. Relancez une recherche pour obtenir une nouvelle offre."});
  }catch{setResult({ok:false,message:"Impossible de confirmer la réservation TEST pour le moment."})}finally{setBusy("")}
 }

 async function simulateCancellation(){
  if(!booking)return;setBusy("cancel");setCancelSimulation(null);
  try{
   const r=await fetch("/api/vacances/hbx/cancel-simulation",{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({reference:booking.reference})});
   const p=await r.json().catch(()=>({}));
   if(r.status===401){login();return}
   if(r.ok){setCancelSimulation({status:p.rawSummary?.status??p.booking?.status??null,total:p.rawSummary?.total??p.booking?.total??null,currency:p.rawSummary?.currency??p.booking?.currency??booking.currency});}
   else setResult({ok:false,message:"Impossible de simuler l’annulation de cette réservation TEST."});
  }catch{setResult({ok:false,message:"La simulation d’annulation HBX est momentanément indisponible."})}finally{setBusy("")}
 }

 return <section id="voyageurs" className={styles.hotelInfoCard}><div className={styles.hotelSectionTitle}><span>Réservation TEST</span><h2>Informations des voyageurs</h2><p>Ces données seront transmises à HBX uniquement lorsque vous confirmerez la réservation TEST.</p></div>
 <form className={styles.hotelGuestForm} onSubmit={submit}>
  <fieldset disabled={Boolean(booking)}><legend>Titulaire de la réservation</legend><div className={styles.hotelGuestGrid}><label>Prénom<input required autoComplete="given-name" value={holder.name} onChange={e=>setHolder({...holder,name:e.target.value})}/></label><label>Nom<input required autoComplete="family-name" value={holder.surname} onChange={e=>setHolder({...holder,surname:e.target.value})}/></label></div></fieldset>
  {paxes.map((p,i)=><fieldset disabled={Boolean(booking)} key={i}><legend>Voyageur {i+1}</legend><div className={styles.hotelGuestGrid}><label>Prénom<input required value={p.name} onChange={e=>pax(i,"name",e.target.value)}/></label><label>Nom<input required value={p.surname} onChange={e=>pax(i,"surname",e.target.value)}/></label></div></fieldset>)}
  {result&&<div className={result.ok?styles.hotelPreviewOk:styles.hotelPreviewError}><AppIcon name={result.ok?"circle-check":"shield"}/><span>{result.message}</span></div>}
  {!booking&&!prepared&&<button disabled={Boolean(busy)}>{busy==="preview"?"Vérification…":"Vérifier les voyageurs"} <AppIcon name="arrow-right"/></button>}
  {!booking&&prepared&&<button type="button" className={styles.hotelConfirmButton} disabled={Boolean(busy)} onClick={()=>void confirmBooking()}>{busy==="book"?"Confirmation HBX…":"Confirmer la réservation TEST"} <AppIcon name="circle-check"/></button>}
 </form>
 {booking&&<div className={styles.hotelBookingConfirmed}><div className={styles.hotelBookingConfirmedHead}><span><AppIcon name="circle-check"/></span><div><small>RÉSERVATION TEST HBX</small><strong>{booking.reference}</strong></div></div><div className={styles.hotelBookingSummary}><p><b>Statut</b><span>{booking.status}</span></p><p><b>Référence Petit Annonces</b><span>{booking.clientReference}</span></p>{booking.total!=null&&<p><b>Montant</b><span>{new Intl.NumberFormat("fr-FR",{style:"currency",currency:booking.currency??"EUR"}).format(booking.total)}</span></p>}</div><button type="button" disabled={Boolean(busy)} onClick={()=>void simulateCancellation()}>{busy==="cancel"?"Simulation…":"Simuler l’annulation"} <AppIcon name="shield"/></button>{cancelSimulation&&<div className={styles.hotelCancellationSimulation}><strong>Simulation d’annulation</strong><span>{cancelSimulation.total!=null?"Frais simulés : "+new Intl.NumberFormat("fr-FR",{style:"currency",currency:cancelSimulation.currency??"EUR"}).format(cancelSimulation.total):"Aucun montant de frais n’a été retourné par HBX."}</span><small>Aucune annulation réelle n’a été effectuée.</small></div>}</div>}
 </section>
}
