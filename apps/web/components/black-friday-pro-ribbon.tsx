"use client";
import {useEffect,useState} from "react";
import styles from "../app/professionnels/page.module.css";
type C={visible:boolean;giftMonthsMultiplier:number;maxPrepaidMonths:number;edition:number;startsAt:string;endsAt:string};
export function BlackFridayProRibbon(){
  const[c,setC]=useState<C|null>(null);
  useEffect(()=>{let mounted=true;fetch((process.env.NEXT_PUBLIC_API_URL??"/api").replace(/\/$/,"")+"/public/campaigns/black-friday",{cache:"no-store"}).then(r=>r.ok?r.json():null).then(v=>{if(mounted&&v)setC(v as C)}).catch(()=>{});return()=>{mounted=false}},[]);
  if(!c?.visible||c.giftMonthsMultiplier<1)return null;
  const gifted=c.maxPrepaidMonths*c.giftMonthsMultiplier;
  return <section className={styles.bfProRibbon} aria-label={"Black Friday Pro "+c.edition}>
    <div className={styles.shell}>
      <div><small>BLACK FRIDAY PRO · {c.edition}</small>
        <h2>1 mois payé = {c.giftMonthsMultiplier} mois offert{c.giftMonthsMultiplier>1?"s":""}.</h2>
        <p>Jusqu’à {c.maxPrepaidMonths} mois achetés + {gifted} mois offerts. Paiement unique, sans renouvellement automatique. Les jours de votre formule actuelle sont conservés.</p>
      </div>
      <a href="/espace-pro/abonnement">Voir l’offre spéciale →</a>
    </div>
  </section>;
}
