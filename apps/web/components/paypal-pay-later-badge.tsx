"use client";

import { useEffect, useState } from "react";
import styles from "./paypal-pay-later-badge.module.css";

const API=process.env.NEXT_PUBLIC_API_URL??"/api";

export function PayPalPayLaterBadge({priceMinor,currency="EUR",compact=false,className}:{priceMinor:number;currency?:string;compact?:boolean;className?:string}){
 const [paypalEnabled,setPaypalEnabled]=useState(false);
 const eligible=currency.toUpperCase()==="EUR"&&priceMinor>=2000&&priceMinor<=300000;
 useEffect(()=>{
  let active=true;
  fetch(`${API}/checkout/payment-methods`,{cache:"no-store"}).then(async r=>r.ok?r.json():null).then(p=>{if(active)setPaypalEnabled(Boolean(p?.paypal?.enabled))}).catch(()=>undefined);
  return()=>{active=false};
 },[]);
 if(!paypalEnabled)return null;
 return <div className={`${styles.box} ${compact?styles.compact:""} ${className??""}`} aria-label={eligible?"Paiement par Visa, Mastercard ou PayPal, avec paiement en 4X possible via PayPal":"Paiement par Visa, Mastercard ou PayPal"}>
  <div className={styles.brands} aria-hidden="true">
   <span className={styles.brandTile}><img src="/payment-brands/visa.svg" alt="" loading="eager"/></span>
   <span className={styles.brandTile}><img src="/payment-brands/mastercard.svg" alt="" loading="eager"/></span>
   <span className={`${styles.brandTile} ${styles.paypalTile}`}><img src="/payment-brands/paypal.svg" alt="" loading="eager"/></span>
  </div>
  <div className={styles.copy}>
   <strong>Carte bancaire · PayPal</strong>
   {eligible&&<small>Paiement en 4X possible</small>}
  </div>
 </div>;
}
