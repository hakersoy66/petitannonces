"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AppIcon, type AppIconName } from "./app-icon";
import { lockBodyScroll } from "../lib/body-scroll-lock";
import styles from "./reputation-badges.module.css";

export type ReputationBadgeView={code:string;label:string;shortLabel:string;description:string;icon:AppIconName;priority?:number};
export type ReputationMetricsView={reviewCount:number;reviewAverage:number|null;completedSales:number;cancellationRate:number;disputeRate:number;responseSamples:number;responseWithinTwoHoursRate:number;averageResponseMinutes:number|null;shipmentSamples:number;shipmentWithin48HoursRate:number};

type Variant="listing-card"|"seller"|"profile";

const criteria:Record<string,string[]>={
  PROFILE_VERIFIE:["Activité professionnelle / boutique vérifiée, ou e-mail et téléphone vérifiés.","Le badge disparaît si les conditions de vérification ne sont plus remplies."],
  PHONE_VERIFIE:["Numéro de téléphone confirmé avec un code SMS envoyé par Petit Annonces.","La vérification est liée au numéro actuellement enregistré sur le compte."],
  REPOND_RAPIDEMENT:["Au moins 3 premières réponses analysées sur les 90 derniers jours.","Au moins 80 % des premières réponses envoyées en moins de 2 heures.","Temps de réponse moyen inférieur ou égal à 2 heures."],
  VENDEUR_FIABLE:["Indice de confiance d’au moins 75/100.","Au moins 3 ventes finalisées et 3 avis après transaction.","Note moyenne d’au moins 4,3/5.","Taux d’annulation ≤ 10 % et taux de litige ≤ 5 %."],
  EXPEDITION_RAPIDE:["Au moins 3 expéditions analysées.","Au moins 80 % des commandes expédiées dans les 48 heures après confirmation du paiement."],
  TOP_VENDEUR:["Remplir les critères « Vendeur fiable » et « Répond rapidement ».","Au moins 10 ventes finalisées et 5 avis.","Note moyenne d’au moins 4,7/5."],
};

function pct(value:number){return `${Math.round(value*100)} %`}
function currentFacts(code:string,m?:ReputationMetricsView){if(!m)return[] as string[];switch(code){case"REPOND_RAPIDEMENT":return m.responseSamples?[`${pct(m.responseWithinTwoHoursRate)} sous 2 h sur ${m.responseSamples} conversation${m.responseSamples>1?"s":""}`,m.averageResponseMinutes!=null?`Moyenne : ${Math.round(m.averageResponseMinutes)} min`:""]:[];case"EXPEDITION_RAPIDE":return m.shipmentSamples?[`${pct(m.shipmentWithin48HoursRate)} sous 48 h sur ${m.shipmentSamples} expédition${m.shipmentSamples>1?"s":""}`]:[];case"VENDEUR_FIABLE":case"TOP_VENDEUR":return [`${m.completedSales} ventes finalisées`,m.reviewAverage!=null?`${m.reviewAverage.toFixed(1)}/5 sur ${m.reviewCount} avis`:`${m.reviewCount} avis`,`${pct(m.cancellationRate)} d’annulations · ${pct(m.disputeRate)} de litiges`];default:return[]}}

export function ReputationBadges({badges,metrics,variant="seller",max}:{badges:ReputationBadgeView[];metrics?:ReputationMetricsView;variant?:Variant;max?:number}){
  const visible=badges.slice(0,max??badges.length);const[selected,setSelected]=useState<ReputationBadgeView|null>(null);
  useEffect(()=>{if(!selected)return;const onKey=(e:KeyboardEvent)=>{if(e.key==="Escape")setSelected(null)};const unlock=lockBodyScroll();window.addEventListener("keydown",onKey);return()=>{window.removeEventListener("keydown",onKey);unlock()}},[selected]);
  if(!visible.length)return null;
  const modal=selected&&typeof document!=="undefined"?createPortal(<div className={styles.backdrop} role="presentation" onMouseDown={()=>setSelected(null)}><section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="reputation-badge-title" onMouseDown={e=>e.stopPropagation()}><button type="button" className={styles.close} onClick={()=>setSelected(null)} aria-label="Fermer">×</button><div className={styles.modalHead} data-code={selected.code}><span><AppIcon name={selected.icon}/></span><div><small>Badge Petit Annonces</small><h2 id="reputation-badge-title">{selected.label}</h2></div></div><p className={styles.description}>{selected.description}</p><div className={styles.criteria}><h3>Critères d’attribution</h3><ul>{(criteria[selected.code]??[]).map(x=><li key={x}><AppIcon name="circle-check"/><span>{x}</span></li>)}</ul></div>{currentFacts(selected.code,metrics).filter(Boolean).length>0&&<div className={styles.current}><h3>Données actuellement prises en compte</h3>{currentFacts(selected.code,metrics).filter(Boolean).map(x=><span key={x}>{x}</span>)}</div>}<p className={styles.note}>Les badges sont calculés automatiquement à partir de l’activité Petit Annonces. Ils ne peuvent pas être choisis manuellement et peuvent être retirés si les critères ne sont plus remplis.</p></section></div>,document.body):null;
  return <><div className={`${styles.wrap} ${styles[variant]}`}>{visible.map(b=><button key={b.code} type="button" className={styles.badge} data-code={b.code} onClick={()=>setSelected(b)} aria-label={`${b.label} : voir les critères`}><span className={styles.icon}><AppIcon name={b.icon}/></span><span className={styles.copy}><b>{variant==="listing-card"?b.shortLabel:b.label}</b>{variant==="profile"&&<small>{b.description}</small>}</span></button>)}</div>{modal}</>;
}
