import {cookies} from "next/headers";
import {notFound,redirect} from "next/navigation";
import {AccountSidebar} from "../../../../../components/account-sidebar";
import {AppIcon} from "../../../../../components/app-icon";
import styles from "./page.module.css";

type Booking={id:string;providerReference:string|null;clientReference:string;hotelCode:number;hotelName:string|null;city:string|null;imageUrl:string|null;checkIn:string;checkOut:string;guests:number;status:string;environment:string;currency:string|null;total:number|null;createdAt:string;updatedAt:string};
const api=()=> (process.env.API_INTERNAL_URL??process.env.NEXT_PUBLIC_API_URL??"http://127.0.0.1:4000").replace(/\/$/,"");
function date(value:string){return new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"long",year:"numeric"}).format(new Date(value.length===10?value+"T12:00:00":value))}
function money(value:number,currency:string){return new Intl.NumberFormat("fr-FR",{style:"currency",currency}).format(value)}
function statusLabel(status:string){const s=status.toUpperCase();return s==="CONFIRMED"||s==="OK"?"Confirmée":s==="PENDING"?"En attente":s==="FAILED"?"Échec":s==="UNKNOWN"?"À vérifier":s==="CANCELLED"||s==="CANCELED"?"Annulée":status}

async function booking(reference:string){
 const store=await cookies();const token=store.get("pa_session")?.value;const next="/mon-compte/reservations/hbx/"+reference;if(!token)redirect("/connexion?next="+encodeURIComponent(next));
 const r=await fetch(api()+"/vacances/hbx/bookings/"+encodeURIComponent(reference),{headers:{cookie:"pa_session="+encodeURIComponent(token)},cache:"no-store"});
 if(r.status===401)redirect("/connexion?next="+encodeURIComponent(next));if(r.status===404)return null;if(!r.ok)return null;
 const p=await r.json() as{booking?:Booking};return p.booking??null;
}
export default async function HbxReservationDetailPage({params}:{params:Promise<{reference:string}>}){
 const {reference}=await params;const b=await booking(reference);if(!b)notFound();
 return <div className={styles.page}><main className={styles.shell}><AccountSidebar/><section className={styles.content}>
  <a className={styles.back} href="/mon-compte/reservations"><AppIcon name="chevron-left"/>Mes réservations</a>
  <div className={styles.hero}><div className={styles.photo}>{b.imageUrl?<img src={b.imageUrl} alt={b.hotelName??"Hôtel HBX"}/>:<span>🏨</span>}<em>HBX · {b.environment.toUpperCase()}</em></div>
   <div className={styles.heroBody}><div className={styles.kicker}>HÔTEL PARTENAIRE HBX</div><div className={styles.titleRow}><div><h1>{b.hotelName??("Hôtel HBX #"+b.hotelCode)}</h1><p><AppIcon name="location"/>{b.city??"France"}</p></div><span className={styles.status+" "+(styles[b.status.toLowerCase()]??"")}>{statusLabel(b.status)}</span></div>{b.total!=null&&<div className={styles.total}><span>Total réservation</span><strong>{money(Number(b.total),b.currency??"EUR")}</strong></div>}</div>
  </div>
  <div className={styles.grid}><section className={styles.card}><div className={styles.cardHead}><span>SÉJOUR</span><h2>Détails de la réservation</h2></div><div className={styles.facts}><div><span>Arrivée</span><b>{date(b.checkIn)}</b></div><div><span>Départ</span><b>{date(b.checkOut)}</b></div><div><span>Voyageurs</span><b>{b.guests}</b></div><div><span>Hôtel</span><b>#{b.hotelCode}</b></div></div></section>
   <section className={styles.card}><div className={styles.cardHead}><span>RÉFÉRENCES</span><h2>Suivi Petit Annonces / HBX</h2></div><div className={styles.refs}><div><span>Référence HBX</span><code>{b.providerReference??"En attente"}</code></div><div><span>Référence Petit Annonces</span><code>{b.clientReference}</code></div><div><span>Environnement</span><b>{b.environment.toUpperCase()}</b></div><div><span>Créée le</span><b>{date(b.createdAt)}</b></div></div></section></div>
  <div className={styles.notice}><AppIcon name="shield"/><div><strong>Réservation hôtel partenaire</strong><span>Cette réservation est fournie par HBX / Hotelbeds. Les conditions tarifaires et d’annulation du fournisseur s’appliquent au séjour.</span></div></div>
 </section></main></div>
}