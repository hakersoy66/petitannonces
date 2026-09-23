"use client";

import { useEffect, useState } from "react";
import { AppIcon } from "./app-icon";
import styles from "./vacation-stay-review-form.module.css";

const api=()=> (process.env.NEXT_PUBLIC_API_URL??"/api").replace(/\/$/,"");
type Review={id:string;rating:number;comment:string|null;direction:string;createdAt:string};
type Payload={eligible:boolean;review:Review|null;listingTitle:string|null};

export function VacationStayReviewForm({reservationId,role}:{reservationId:string;role:"HOST"|"GUEST"}){
 const[data,setData]=useState<Payload|null>(null),[rating,setRating]=useState(5),[comment,setComment]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 async function load(){try{const r=await fetch(`${api()}/vacances/reservations/${encodeURIComponent(reservationId)}/review`,{credentials:"include",cache:"no-store"});if(r.ok)setData(await r.json())}catch{}}
 useEffect(()=>{void load()},[reservationId]);
 async function submit(){if(!data?.eligible||data.review)return;setBusy(true);setMessage("");try{const r=await fetch(`${api()}/vacances/reservations/${encodeURIComponent(reservationId)}/review`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({rating,comment:comment.trim()||undefined})});const p=await r.json().catch(()=>null) as {error?:string}|null;if(!r.ok){setMessage(p?.error==="review_already_submitted"?"Vous avez déjà publié un avis pour ce séjour.":"Impossible de publier l’avis pour le moment.");return}setMessage("Merci, votre avis a été publié.");await load()}finally{setBusy(false)}}
 if(!data?.eligible)return null;
 if(data.review)return <div className={styles.saved}><AppIcon name="star"/><div><strong>Votre avis · {data.review.rating}/5</strong><span>{data.review.comment||"Avis publié après un séjour vérifié."}</span><small>Séjour vérifié Petit Annonces</small></div></div>;
 return <div className={styles.box}><div className={styles.head}><AppIcon name="star"/><div><strong>{role==="GUEST"?"Évaluer votre séjour":"Évaluer le voyageur"}</strong><span>{role==="GUEST"?"Votre avis apparaîtra sur l’annonce comme séjour vérifié.":"Votre avis contribue à la confiance entre membres."}</span></div></div><div className={styles.stars} aria-label="Note sur 5">{[1,2,3,4,5].map(n=><button key={n} type="button" className={n<=rating?styles.active:""} onClick={()=>setRating(n)} aria-label={`${n} étoile${n>1?"s":""}`}><AppIcon name="star"/></button>)}</div><textarea rows={3} maxLength={1200} value={comment} onChange={e=>setComment(e.target.value)} placeholder={role==="GUEST"?"Propreté, accueil, conformité de l’annonce…":"Communication, respect du logement…"}/><button type="button" disabled={busy} onClick={()=>void submit()}>{busy?"Publication…":"Publier mon avis"}</button>{message&&<p>{message}</p>}</div>
}
