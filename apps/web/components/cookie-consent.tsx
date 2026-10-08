"use client";

import {useEffect,useRef,useState} from "react";
import {
 COOKIE_STORAGE_KEY,COOKIE_POLICY_VERSION,COOKIE_ACCEPT_ALL,COOKIE_REJECT_ALL,
 cookieDecisionValid,type CookieChoices,type StoredCookieConsent
} from "../lib/cookie-consent-policy";
import styles from "./cookie-consent.module.css";

const purposes:[
 keyof CookieChoices,string,string,string
][]=[
 ["analytics","Mesure d’audience","Comprendre les visites et améliorer les performances.","chart"],
 ["personalization","Personnalisation","Adapter votre expérience et vos préférences.","sparkle"],
 ["advertising","Publicité & campagnes","Mesurer les campagnes et proposer des annonces adaptées.","megaphone"]
];

function Icon({name}:{name:string}){
 if(name==="chart")return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V11m6 8V5m6 14v-7m4 7H2" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"/></svg>;
 if(name==="sparkle")return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4L12 2Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/></svg>;
 if(name==="megaphone")return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 14-6v16L3 14v-4Zm4 5v5h3l1-4M20 9a4 4 0 0 1 0 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>;
 return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2a4 4 0 0 0 4 5 4 4 0 0 0 5 4 10 10 0 1 1-9-9Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><circle cx="9" cy="9" r="1" fill="currentColor"/><circle cx="15" cy="14" r="1.2" fill="currentColor"/><circle cx="8" cy="16" r="1" fill="currentColor"/></svg>;
}

function anonymousId(){
 const key="pa_anon_id";
 try{
  const existing=localStorage.getItem(key);
  if(existing)return existing;
  const value=crypto?.randomUUID?.()??"anon-"+Date.now()+"-"+Math.random().toString(36).slice(2);
  localStorage.setItem(key,value);
  return value;
 }catch{return "anon-"+Date.now()+"-"+Math.random().toString(36).slice(2)}
}

export function CookieConsent(){
 const [open,setOpen]=useState(false);
 const [ready,setReady]=useState(false);
 const [settings,setSettings]=useState(false);
 const [hasDecision,setHasDecision]=useState(false);
 const [choices,setChoices]=useState<CookieChoices>(COOKIE_REJECT_ALL);
 const [lastSaved,setLastSaved]=useState<CookieChoices>(COOKIE_REJECT_ALL);
 const dialogRef=useRef<HTMLDivElement>(null);
 const primaryRef=useRef<HTMLButtonElement>(null);
 const savedFocus=useRef<HTMLElement|null>(null);

 useEffect(()=>{
  const openPreferences=()=>{
   setSettings(true);
   setOpen(true);
  };
  window.addEventListener("pa:open-cookie-settings",openPreferences);
  try{
   const raw=localStorage.getItem(COOKIE_STORAGE_KEY);
   if(raw){
    const decision=JSON.parse(raw) as StoredCookieConsent;
    if(cookieDecisionValid(decision)){
     const selected:CookieChoices={analytics:decision.analytics,personalization:decision.personalization,advertising:decision.advertising};
     setChoices(selected);setLastSaved(selected);setHasDecision(true);setOpen(false);
    }else{setOpen(true)}
   }else{setOpen(true)}
  }catch{setOpen(true)}
  finally{setReady(true)}
  return()=>window.removeEventListener("pa:open-cookie-settings",openPreferences);
 },[]);

 useEffect(()=>{
  if(!open)return;
  const previousOverflow=document.body.style.overflow;
  savedFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
  document.body.style.overflow="hidden";
  const focusTimer=window.setTimeout(()=>primaryRef.current?.focus({preventScroll:true}),40);
  const onKey=(event:KeyboardEvent)=>{
   if(event.key==="Escape"){event.preventDefault();if(hasDecision){setChoices(lastSaved);setSettings(false);setOpen(false)}else{save(COOKIE_REJECT_ALL)}}
   if(event.key!=="Tab"||!dialogRef.current)return;
   const elements=Array.from(dialogRef.current.querySelectorAll<HTMLElement>("a[href],button:not([disabled]),input:not([disabled])")).filter(e=>e.getClientRects().length>0);
   const first=elements[0],last=elements[elements.length-1];
   if(!first||!last)return;
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
  };
  document.addEventListener("keydown",onKey);
  return()=>{window.clearTimeout(focusTimer);document.body.style.overflow=previousOverflow;document.removeEventListener("keydown",onKey);savedFocus.current?.focus({preventScroll:true})};
 },[open,hasDecision,lastSaved]);

 function save(next:CookieChoices){
  const decision:StoredCookieConsent={...next,policyVersion:COOKIE_POLICY_VERSION,savedAt:new Date().toISOString()};
  try{localStorage.setItem(COOKIE_STORAGE_KEY,JSON.stringify(decision))}catch{}
  setChoices(next);setLastSaved(next);setHasDecision(true);setSettings(false);setOpen(false);
  window.dispatchEvent(new CustomEvent("pa:consent-changed",{detail:next}));
  void (async()=>{
   try{
    await fetch((process.env.NEXT_PUBLIC_API_URL??"/api")+"/privacy/cookies",{
     method:"POST",credentials:"include",keepalive:true,
     headers:{"content-type":"application/json"},
     body:JSON.stringify({anonymousId:anonymousId(),policyVersion:COOKIE_POLICY_VERSION,source:"WEB",choices:next})
    });
   }catch{/* The locally saved choice still controls optional trackers. */}
  })();
 }

 function dismiss(){
  if(hasDecision){setChoices(lastSaved);setSettings(false);setOpen(false)}
  else save(COOKIE_REJECT_ALL);
 }

 if(!ready||!open)return null;
 return <div className={styles.backdrop} data-no-pull-refresh onMouseDown={event=>{if(event.target===event.currentTarget)dismiss()}}>
  <div className={styles.modal} ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="pa-cookie-title" aria-describedby="pa-cookie-description">
   <div className={styles.hero}>
    <div className={styles.heroTop}>
     <span className={styles.brand}><span className={styles.brandMark}>pa</span> Petit Annonces</span>
     <button type="button" className={styles.close} aria-label={hasDecision?"Fermer les préférences":"Continuer sans accepter les cookies"} title={hasDecision?"Fermer":"Continuer sans accepter"} onClick={dismiss}>×</button>
    </div>
    <div className={styles.heroContent}>
     <div className={styles.cookieIcon}><Icon name="cookie"/></div>
     <div><span className={styles.kicker}>VOTRE VIE PRIVÉE COMPTE</span><h2 id="pa-cookie-title">{settings?"Personnalisez vos choix":"Vos données, vos choix."}</h2></div>
    </div>
   </div>

   <div className={styles.body}>
    <p id="pa-cookie-description" className={styles.intro}>
     Nous utilisons des cookies indispensables au fonctionnement du site. Avec votre accord, nous pouvons également mesurer l’audience, personnaliser votre expérience et améliorer nos campagnes.
    </p>
    {!settings?<div className={styles.purposeGrid} aria-label="Utilisation des cookies">
     <div><span className={styles.miniIcon}><Icon name="chart"/></span><strong>Comprendre</strong><small>Les visites</small></div>
     <div><span className={styles.miniIcon}><Icon name="sparkle"/></span><strong>Personnaliser</strong><small>L’expérience</small></div>
     <div><span className={styles.miniIcon}><Icon name="megaphone"/></span><strong>Améliorer</strong><small>Les campagnes</small></div>
    </div>:<div className={styles.preferences}>
     <div className={styles.essential}><span className={styles.miniIcon}><Icon name="cookie"/></span><span className={styles.purposeText}><strong>Cookies essentiels</strong><small>Connexion, sécurité et fonctionnement du site.</small></span><span className={styles.alwaysOn}>Toujours actifs</span></div>
     {purposes.map(([key,label,description,icon])=><label key={key} className={styles.preference}>
      <span className={styles.miniIcon}><Icon name={icon}/></span>
      <span className={styles.purposeText}><strong>{label}</strong><small>{description}</small></span>
      <input type="checkbox" role="switch" aria-label={label} checked={choices[key]} onChange={event=>setChoices(current=>({...current,[key]:event.target.checked}))}/>
      <span className={styles.switch} aria-hidden="true"/>
     </label>)}
    </div>}
    <p className={styles.details}>Votre choix (acceptation ou refus) est mémorisé pendant <strong>6 mois</strong>. Vous pouvez le modifier à tout moment. <a href="/cookies" target="_blank" rel="noopener noreferrer">Consulter la politique de cookies <span aria-hidden="true">↗</span></a></p>
    <div className={styles.actions}>
     <button type="button" className={styles.reject} onClick={()=>save(COOKIE_REJECT_ALL)}>Tout refuser</button>
     {settings?<button type="button" ref={primaryRef} className={styles.accept} onClick={()=>save(choices)}>Enregistrer mes choix</button>:<button type="button" ref={primaryRef} className={styles.accept} onClick={()=>save(COOKIE_ACCEPT_ALL)}>Tout accepter</button>}
     <button type="button" className={styles.customize} onClick={()=>setSettings(current=>!current)}>{settings?"← Revenir aux options":"Personnaliser mes choix"}<span aria-hidden="true">{settings?"":" →"}</span></button>
    </div>
   </div>
  </div>
 </div>;
}
