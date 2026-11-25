"use client";

import {useEffect,useRef,useState} from "react";
import {usePathname} from "next/navigation";
import Link from "next/link";
import {AppIcon} from "./app-icon";
import styles from "./emploi-launch-popup.module.css";

// Do not change this key between releases: a dismissal is permanent in this browser.
const DISMISSED_KEY="pa_animal_popup_dismissed_v1";
const CONSENT_KEY="pa_cookie_consent_v1";
const CONSENT_POLICY="2026-09-meta";
const CONSENT_TTL_MS=180*24*60*60*1000;

function safeToInterrupt(path:string){
 if(path!=="/"&&!path.startsWith("/categorie/animaux"))return false;
 return ![
  "/connexion","/inscription","/mot-de-passe-oublie","/reinitialiser-mot-de-passe",
  "/verifier-email","/verifiez-votre-email","/checkout","/paiement",
  "/deposer-une-annonce","/importer-une-annonce","/messages","/mon-compte",
  "/commandes","/espace-pro","/notifications","/maintenance-preview",
 ].some(prefix=>path===prefix||path.startsWith(prefix+"/"));
}
function privacyChoiceMade(){
 try{
  const raw=window.localStorage.getItem(CONSENT_KEY);
  if(!raw)return false;
  const saved=JSON.parse(raw) as {policyVersion?:string;savedAt?:string};
  const timestamp=Date.parse(saved.savedAt??"");
  return saved.policyVersion===CONSENT_POLICY&&Number.isFinite(timestamp)&&Date.now()-timestamp>=0&&Date.now()-timestamp<CONSENT_TTL_MS;
 }catch{return false}
}
function alreadyDismissed(){
 try{
  if(window.localStorage.getItem(DISMISSED_KEY)==="1")return true;
 }catch{}
 return document.cookie.split(";").some(part=>part.trim()==="pa_animal_popup_dismissed=1");
}
function saveDismissal(){
 try{window.localStorage.setItem(DISMISSED_KEY,"1")}catch{}
 try{document.cookie="pa_animal_popup_dismissed=1; Max-Age=31536000; Path=/; SameSite=Lax; Secure"}catch{}
}

export function AnimalLaunchPopup(){
 const pathname=usePathname();
 const [open,setOpen]=useState(false);
 const closeRef=useRef<HTMLButtonElement|null>(null);
 const previouslyFocused=useRef<HTMLElement|null>(null);

 useEffect(()=>{
  if(!safeToInterrupt(pathname)||alreadyDismissed()){
   setOpen(false);
   return;
  }
  let timer:number|undefined;
  let cancelled=false;
  const schedule=()=>{
   if(cancelled||!privacyChoiceMade()||!safeToInterrupt(window.location.pathname)||alreadyDismissed())return;
   window.clearTimeout(timer);
   timer=window.setTimeout(()=>{
    if(!cancelled&&document.visibilityState==="visible"&&safeToInterrupt(window.location.pathname)&&!alreadyDismissed())setOpen(true);
   },1700);
  };
  schedule();
  window.addEventListener("pa:consent-changed",schedule);
  const onVisible=()=>{if(document.visibilityState==="visible")schedule()};
  document.addEventListener("visibilitychange",onVisible);
  return()=>{
   cancelled=true;
   window.clearTimeout(timer);
   window.removeEventListener("pa:consent-changed",schedule);
   document.removeEventListener("visibilitychange",onVisible);
  };
 },[pathname]);

 useEffect(()=>{
  if(!open)return;
  previouslyFocused.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
  closeRef.current?.focus({preventScroll:true});
  const onKeyDown=(event:KeyboardEvent)=>{
   if(event.key==="Escape"){event.preventDefault();dismiss();return}
   if(event.key!=="Tab")return;
   const container=document.getElementById("pa-animal-announcement");
   if(!container)return;
   const focusable=Array.from(container.querySelectorAll<HTMLElement>('a[href],button:not([disabled])'));
   if(!focusable.length)return;
   const first=focusable[0],last=focusable[focusable.length-1];
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
  };
  document.addEventListener("keydown",onKeyDown);
  return()=>{
   document.removeEventListener("keydown",onKeyDown);
   previouslyFocused.current?.focus({preventScroll:true});
  };
 },[open]);

 function dismiss(){
  saveDismissal();
  setOpen(false);
 }
 if(!open)return null;

 return <div className={styles.backdrop} data-no-pull-refresh>
  <section id="pa-animal-announcement" className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="pa-animal-popup-title" aria-describedby="pa-animal-popup-description">
   <button ref={closeRef} className={styles.close} type="button" onClick={dismiss} aria-label="Fermer cette annonce définitivement"><AppIcon name="xmark"/></button>
   <div className={styles.top}>
    <div className={styles.brand}><span className={styles.brandMark}>PA</span><span>Petit Annonces</span><span className={styles.brandDivider}>/</span><span>Animaux</span></div>
    <span className={styles.new}><span className={styles.pulse}/> NOUVEAUTÉ</span>
    <div className={styles.heroContent}>
     <div className={styles.eyebrow}><AppIcon name="sparkles"/> UN ESPACE ANIMAUX PLUS RESPONSABLE</div>
     <h2 id="pa-animal-popup-title">Vos annonces d’animaux <span>en toute responsabilité.</span></h2>
     <p id="pa-animal-popup-description">Préparez et enregistrez dès maintenant vos annonces de vente et d’adoption de chiens et de chats. Leur publication nécessitera la vérification officielle <strong>I-CAD</strong>.</p>
    </div>
    <div className={styles.preview} aria-hidden="true">
     <div className={styles.previewIcon}><AppIcon name="paw"/></div>
     <div className={styles.previewText}><strong>Contrôle I-CAD avant publication</strong><span>Chiens · Chats</span></div>
     <span className={styles.previewSpark}><AppIcon name="shield"/></span>
    </div>
   </div>
   <div className={styles.bottom}>
    <div className={styles.advantages}>
     <div><span className={styles.advIcon}><AppIcon name="paw"/></span><span><strong>Identification des animaux</strong><small>Vérification des informations requises</small></span></div>
     <div><span className={styles.advIcon}><AppIcon name="circle-check"/></span><span><strong>Contrôle officiel I-CAD</strong><small>Vérification obligatoire avant publication</small></span></div>
     <div><span className={styles.advIcon}><AppIcon name="shield"/></span><span><strong>Bien-être animal</strong><small>Pour des annonces responsables</small></span></div>
    </div>
    <Link href="/deposer-une-annonce" className={styles.primary} onClick={dismiss}>Préparer une annonce <AppIcon name="arrow-right"/></Link>
    <button className={styles.later} type="button" onClick={dismiss}>Peut-être plus tard</button>
    <p className={styles.footnote}><AppIcon name="lock"/> Cette annonce ne sera plus affichée après fermeture.</p>
   </div>
  </section>
 </div>;
}
