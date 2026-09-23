"use client";

import {useEffect,useState} from "react";
import {AppIcon} from "./app-icon";
import styles from "./vacation-listing-reviews.module.css";

const api=()=> (process.env.NEXT_PUBLIC_API_URL??"/api").replace(/\/$/,"");
type Review={id:string;rating:number;comment:string|null;createdAt:string;reviewerName:string|null;verifiedStay:true};
type Payload={summary:{count:number;average:number|null};reviews:Review[]};
function date(value:string){return new Intl.DateTimeFormat("fr-FR",{month:"short",year:"numeric"}).format(new Date(value))}

export function VacationListingReviews({listingId}:{listingId:string}){
 const[data,setData]=useState<Payload|null>(null);
 useEffect(()=>{let alive=true;fetch(`${api()}/vacances/listings/${encodeURIComponent(listingId)}/reviews?limit=8`,{cache:"no-store"}).then(async r=>r.ok?await r.json():null).then(p=>{if(alive&&p)setData(p)}).catch(()=>undefined);return()=>{alive=false}},[listingId]);
 if(!data||data.summary.count===0)return null;
 return <section className={styles.card}><div className={styles.head}><div><span>PETIT ANNONCES VACANCES</span><h2>Avis des voyageurs</h2></div><div className={styles.score}><AppIcon name="star"/><strong>{data.summary.average?.toFixed(1).replace(".",",")}</strong><small>{data.summary.count} séjour{data.summary.count>1?"s":""} vérifié{data.summary.count>1?"s":""}</small></div></div><div className={styles.grid}>{data.reviews.map(review=><article key={review.id}><div className={styles.meta}><strong>{review.reviewerName||"Voyageur Petit Annonces"}</strong><span>{"★".repeat(review.rating)}{"☆".repeat(5-review.rating)}</span></div><p>{review.comment||"Séjour évalué sans commentaire."}</p><small><AppIcon name="circle-check"/>Séjour vérifié · {date(review.createdAt)}</small></article>)}</div></section>
}
