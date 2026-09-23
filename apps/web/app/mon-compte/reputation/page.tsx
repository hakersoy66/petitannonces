"use client";

import { useEffect, useMemo, useState } from "react";
import { AccountSidebar } from "../../../components/account-sidebar";
import { AppIcon, type AppIconName } from "../../../components/app-icon";
import { ReputationBadges, type ReputationBadgeView, type ReputationMetricsView } from "../../../components/reputation-badges";
import styles from "./page.module.css";

type Condition={key:string;label:string;currentLabel:string;met:boolean;progress:number};
type BadgeProgress={badge:ReputationBadgeView;earned:boolean;progress:number;conditions:Condition[];nextStep:string|null};
type HistoryItem={id:string;badgeCode:string;badge:ReputationBadgeView;eventType:"EARNED"|"LOST";createdAt:string};
type Payload={
  reputation:{badges:ReputationBadgeView[];trust:{score:number;level:"NEW"|"ESTABLISHED"|"TRUSTED";reliableSeller:boolean};metrics:ReputationMetricsView};
  history:HistoryItem[];
  catalog:BadgeProgress[];
  summary:{earned:number;total:number;overallProgress:number};
};

function apiBase(){return (process.env.NEXT_PUBLIC_API_URL??"/api").replace(/\/$/,"")}
function badgeAction(code:string){
  if(code==="PROFILE_VERIFIE")return{href:"/mon-compte/profil",label:"Compléter mes vérifications"};
  if(code==="REPOND_RAPIDEMENT")return{href:"/messages",label:"Ouvrir mes messages"};
  if(code==="EXPEDITION_RAPIDE")return{href:"/commandes",label:"Voir mes ventes"};
  return{href:"/commandes",label:"Voir mes transactions"};
}
function levelLabel(level:Payload["reputation"]["trust"]["level"]){return level==="TRUSTED"?"Très bon":level==="ESTABLISHED"?"Établi":"Nouveau profil"}
function historyDate(value:string){return new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"long",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date(value))}

export default function ReputationPage(){
  const[data,setData]=useState<Payload|null>(null);const[loading,setLoading]=useState(true);const[error,setError]=useState("");
  async function load(){setLoading(true);setError("");try{const r=await fetch(`${apiBase()}/account/reputation`,{credentials:"include",cache:"no-store"});if(r.status===401){window.location.replace("/connexion?next=%2Fmon-compte%2Freputation");return}if(!r.ok)throw new Error();setData(await r.json())}catch{setError("Impossible de charger votre réputation pour le moment.")}finally{setLoading(false)}}
  useEffect(()=>{void load()},[]);
  const nextBadge=useMemo(()=>data?.catalog.filter(item=>!item.earned).sort((a,b)=>b.progress-a.progress)[0]??null,[data]);
  return <div className={styles.page}><main className={styles.shell}><AccountSidebar/><section className={styles.content}>
    <header className={styles.hero}><div><span className={styles.eyebrow}>Réputation & badges</span><h1>Votre réputation Petit Annonces</h1><p>Suivez vos badges, comprenez les critères et voyez précisément ce qu’il vous reste à accomplir.</p></div><div className={styles.heroIcon}><AppIcon name="star"/></div></header>
    {loading?<div className={styles.loading}><div/><div/><div/></div>:error?<div className={styles.error}><AppIcon name="info"/><div><strong>Chargement impossible</strong><p>{error}</p><button type="button" onClick={()=>void load()}>Réessayer</button></div></div>:data&&<>
      <section className={styles.summaryGrid}><article className={styles.scoreCard}><span><AppIcon name="shield"/></span><div><small>Indice de confiance</small><strong>{data.reputation.trust.score}<em>/100</em></strong><p>{levelLabel(data.reputation.trust.level)}</p></div></article><article><span><AppIcon name="star"/></span><div><small>Badges obtenus</small><strong>{data.summary.earned}<em>/{data.summary.total}</em></strong><p>{data.summary.earned?"Continuez sur cette lancée":"Votre progression commence ici"}</p></div></article><article><span><AppIcon name="gauge"/></span><div><small>Progression globale</small><strong>{data.summary.overallProgress}<em>%</em></strong><div className={styles.miniProgress}><i style={{width:`${data.summary.overallProgress}%`}}/></div></div></article></section>

      {data.reputation.badges.length>0&&<section className={styles.earnedPanel}><div className={styles.sectionHead}><div><span className={styles.eyebrow}>Obtenus</span><h2>Vos badges actuels</h2><p>Touchez un badge pour revoir ses critères.</p></div><b>{data.reputation.badges.length}</b></div><ReputationBadges badges={data.reputation.badges} metrics={data.reputation.metrics} variant="profile"/></section>}

      {nextBadge&&<section className={styles.nextPanel}><div className={styles.nextIcon}><AppIcon name={nextBadge.badge.icon as AppIconName}/></div><div className={styles.nextCopy}><span>Votre prochain badge le plus proche</span><h2>{nextBadge.badge.label}</h2><p>{nextBadge.nextStep??nextBadge.badge.description}</p><div className={styles.nextProgress}><i style={{width:`${nextBadge.progress}%`}}/></div><small>{nextBadge.progress}% accompli</small></div><a href={badgeAction(nextBadge.badge.code).href}>{badgeAction(nextBadge.badge.code).label}<AppIcon name="chevron-right"/></a></section>}

      <section className={styles.catalogPanel}><div className={styles.sectionHead}><div><span className={styles.eyebrow}>Objectifs</span><h2>Tous les badges</h2><p>Les critères sont calculés uniquement à partir de l’activité Petit Annonces.</p></div></div><div className={styles.catalog}>{data.catalog.map(item=>{const action=badgeAction(item.badge.code);return <article key={item.badge.code} className={`${styles.badgeCard} ${item.earned?styles.earned:styles.locked}`} data-code={item.badge.code}><div className={styles.badgeTop}><div className={styles.badgeIdentity}><span className={styles.badgeIcon}><AppIcon name={item.badge.icon as AppIconName}/></span><div><small>{item.earned?"Badge obtenu":"En progression"}</small><h3>{item.badge.label}</h3><p>{item.badge.description}</p></div></div><strong className={styles.percent}>{item.earned?<AppIcon name="circle-check"/>:`${item.progress}%`}</strong></div><div className={styles.progress}><i style={{width:`${item.earned?100:item.progress}%`}}/></div><div className={styles.conditions}>{item.conditions.map(c=><div key={c.key} className={c.met?styles.conditionDone:""}><span><AppIcon name={c.met?"circle-check":"clock"}/></span><div><strong>{c.label}</strong><small>{c.currentLabel}</small></div><em>{c.met?"Atteint":`${c.progress}%`}</em></div>)}</div>{!item.earned&&<div className={styles.cardFoot}><p><AppIcon name="info"/>{item.nextStep??"Continuez votre activité pour progresser vers ce badge."}</p><a href={action.href}>{action.label}<AppIcon name="chevron-right"/></a></div>}</article>})}</div></section>

      <section className={styles.historyPanel}><div className={styles.sectionHead}><div><span className={styles.eyebrow}>Historique</span><h2>Évolution de vos badges</h2><p>Le suivi des changements est actif depuis le 9 septembre 2026.</p></div></div>{data.history.length?<div className={styles.historyList}>{data.history.map(event=><article key={event.id} data-event={event.eventType}><span><AppIcon name={event.eventType==="EARNED"?"circle-check":"info"}/></span><div><strong>{event.eventType==="EARNED"?"Badge obtenu":"Badge retiré"} · {event.badge.label}</strong><small>{historyDate(event.createdAt)}</small></div></article>)}</div>:<div className={styles.emptyHistory}><AppIcon name="clock"/><div><strong>Aucun changement enregistré pour le moment</strong><p>Vos prochains badges obtenus ou retirés apparaîtront ici avec leur date.</p></div></div>}</section>
      <p className={styles.disclaimer}>Les badges sont automatiques. Ils ne peuvent pas être achetés ni attribués manuellement et peuvent être retirés lorsque les critères ne sont plus remplis.</p>
    </>}
  </section></main></div>;
}
