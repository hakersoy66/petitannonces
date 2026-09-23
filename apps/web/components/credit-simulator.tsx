"use client";

import { useMemo, useState } from "react";
import { AppIcon } from "./app-icon";
import styles from "./credit-simulator.module.css";

const HOUSING_RATE = 3.27;
const CONSUMER_RATE = 6.27;
const RATE_PERIOD = "juin 2026";

function euro(value:number){return new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR",maximumFractionDigits:0}).format(value)}

export function CreditSimulator({priceMinor,isRealEstate}:{priceMinor:number;isRealEstate:boolean}){
 const price=priceMinor/100;
 const[years,setYears]=useState(isRealEstate?20:5);
 const annualRate=isRealEstate?HOUSING_RATE:CONSUMER_RATE;
 const result=useMemo(()=>{
  const months=Math.max(1,years*12);
  const monthlyRate=annualRate/100/12;
  const payment=monthlyRate===0?price/months:(price*monthlyRate)/(1-Math.pow(1+monthlyRate,-months));
  const total=payment*months;
  return{months,payment,total,interest:Math.max(0,total-price)};
 },[price,years,annualRate]);
 const presets=[1,3,5,10,15,20,25];
 return <section className={styles.card} aria-label="Simulation de crédit indicative">
  <div className={styles.head}><div><span className={styles.icon}><AppIcon name="credit-card"/></span><div><small>Simulation indicative</small><h3>Estimez votre mensualité</h3></div></div><span className={styles.rate}>{annualRate.toFixed(2).replace(".",",")} %</span></div>
  <p className={styles.lead}>Une estimation simple basée sur le prix de l’annonce et le dernier taux moyen Banque de France disponible pour {isRealEstate?"les nouveaux crédits à l’habitat":"les prêts amortissables à la consommation"}.</p>
  <div className={styles.controls}><div className={styles.durationHead}><span>Durée</span><strong>{years} an{years>1?"s":""}</strong></div><input type="range" min="1" max="25" step="1" value={years} onChange={e=>setYears(Number(e.target.value))}/><div className={styles.presets}>{presets.map(y=><button type="button" key={y} className={years===y?styles.active:""} onClick={()=>setYears(y)}>{y} an{y>1?"s":""}</button>)}</div></div>
  <div className={styles.results}><div className={styles.primary}><span>Mensualité estimée</span><strong>{euro(result.payment)}<small>/mois</small></strong></div><div><span>Montant simulé</span><b>{euro(price)}</b></div><div><span>Intérêts estimés</span><b>{euro(result.interest)}</b></div><div><span>Total estimé</span><b>{euro(result.total)}</b></div></div>
  <div className={styles.note}><AppIcon name="info"/><p>Taux de référence : {RATE_PERIOD}, hors assurance et frais. Cette simulation n’est ni une offre de crédit ni une garantie d’acceptation. {isRealEstate?"La durée réelle dépend de votre dossier et de l’établissement prêteur.":"Pour un crédit à la consommation, les durées réellement proposées sont généralement bien plus courtes que 25 ans ; les longues durées sont affichées uniquement à titre de comparaison."} <a href="https://www.banque-france.fr/fr/publications-et-statistiques/statistiques/credit/credits-aux-particuliers" target="_blank" rel="noreferrer">Source Banque de France</a>.</p></div>
 </section>
}
