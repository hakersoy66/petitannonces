"use client";
import { useState } from "react";
import { AppIcon } from "./app-icon";
import styles from "./listing-seller-phone.module.css";

const api=()=>(process.env.NEXT_PUBLIC_API_URL??"/api").replace(/\/$/,"");
export function ListingSellerPhone({slug}:{slug:string}){
  const[phone,setPhone]=useState<string|null>(null);
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState("");
  async function reveal(){
    if(busy||phone)return;
    setBusy(true);setError("");
    try{
      const response=await fetch(`${api()}/public/listings/${encodeURIComponent(slug)}/seller-phone`,{cache:"no-store"});
      const data=await response.json().catch(()=>({})) as {phone?:string};
      if(!response.ok||!data.phone)throw new Error("phone_unavailable");
      setPhone(data.phone);
    }catch{setError("Numéro indisponible. Réessayez plus tard.");}
    finally{setBusy(false)}
  }
  return <div className={styles.wrapper}>
    {phone?<a className={styles.phoneLink} href={`tel:${phone.replace(/[^+0-9]/g,"")}`}><AppIcon name="phone"/>{phone}</a>:<button type="button" className={styles.revealButton} disabled={busy} onClick={reveal}><AppIcon name="phone"/>{busy?"Recherche…":"Voir le numéro"}</button>}
    {error&&<small role="alert" className={styles.error}>{error}</small>}
  </div>;
}
