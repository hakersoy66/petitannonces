"use client";

import { useEffect, useRef, useState, type TouchEvent } from "react";
import { AppIcon, type AppIconName } from "./app-icon";
import { sendSiteAnalyticsEvent } from "./site-telemetry";
import { lockBodyScroll } from "../lib/body-scroll-lock";
import { nativeShellMode, requestNativePush } from "../lib/native-shell";

const COMPLETE_KEY="pa_pwa_onboarding_complete_v1";
const STARTED_SESSION_KEY="pa_pwa_onboarding_started_session_v1";
const PUSH_PROMPT_SEEN_KEY="pa_pwa_push_prompt_seen";
const PUSH_LAST_SYNC_KEY="pa_pwa_push_last_sync";

type Slide={
  eyebrow:string;
  title:string;
  text:string;
  icon:AppIconName;
  accents:AppIconName[];
};

const slides:Slide[]=[
  {
    eyebrow:"Bienvenue",
    title:"Petit Annonces, partout avec vous",
    text:"Achetez, vendez et trouvez près de chez vous depuis une expérience pensée comme une vraie application.",
    icon:"sparkles",
    accents:["search","location","heart"],
  },
  {
    eyebrow:"Simple & rapide",
    title:"Publiez votre annonce en quelques minutes",
    text:"Ajoutez vos photos, votre prix et les informations utiles. La publication d’une annonce reste simple, guidée et gratuite.",
    icon:"plus",
    accents:["camera","list","circle-check"],
  },
  {
    eyebrow:"Achetez en confiance",
    title:"Paiement sécurisé et envoi suivi",
    text:"Payez en ligne, suivez votre envoi et profitez des protections prévues pour sécuriser les échanges entre acheteurs et vendeurs.",
    icon:"shield",
    accents:["credit-card","truck","lock"],
  },
  {
    eyebrow:"Tout au même endroit",
    title:"Messages, favoris et notifications",
    text:"Retrouvez vos conversations, vos annonces favorites, vos alertes et votre espace personnel directement depuis l’application.",
    icon:"comments",
    accents:["bell","heart","store"],
  },
  {
    eyebrow:"Dernière étape",
    title:"Activez les notifications",
    text:"Soyez prévenu dès qu’un message, une offre, une commande ou une mise à jour importante vous attend.",
    icon:"bell",
    accents:["comments","handshake","truck"],
  },
];

function standaloneMode(){
  return nativeShellMode()||window.matchMedia("(display-mode: standalone)").matches||Boolean((navigator as Navigator&{standalone?:boolean}).standalone);
}

export function PwaOnboarding({appLogoUrl}:{appLogoUrl?:string|null}){
  const [open,setOpen]=useState(false);
  const [index,setIndex]=useState(0);
  const [pushBusy,setPushBusy]=useState(false);
  const [pushState,setPushState]=useState<"idle"|"granted"|"denied"|"unsupported">("idle");
  const touchStart=useRef<{x:number;y:number}|null>(null);
  const pushPromptTracked=useRef(false);

  useEffect(()=>{
    const onInstalled=()=>{localStorage.removeItem(COMPLETE_KEY);sessionStorage.removeItem(STARTED_SESSION_KEY)};
    window.addEventListener("appinstalled",onInstalled);
    if(standaloneMode()&&localStorage.getItem(COMPLETE_KEY)!=="1"){
      setOpen(true);
      if(sessionStorage.getItem(STARTED_SESSION_KEY)!=="1"){sessionStorage.setItem(STARTED_SESSION_KEY,"1");void sendSiteAnalyticsEvent("PWA_ONBOARDING_STARTED")}
    }
    return()=>window.removeEventListener("appinstalled",onInstalled);
  },[]);

  useEffect(()=>{
    if(!open)return;
    const body=document.body;
    const unlock=lockBodyScroll();
    body.classList.add("pa-pwa-onboarding-open");
    return()=>{unlock();body.classList.remove("pa-pwa-onboarding-open")};
  },[open]);

  useEffect(()=>{
    if(!open)return;
    const onKey=(event:KeyboardEvent)=>{
      if(event.key==="ArrowLeft")setIndex(value=>Math.max(0,value-1));
      if(event.key==="ArrowRight")setIndex(value=>Math.min(slides.length-1,value+1));
    };
    window.addEventListener("keydown",onKey);
    return()=>window.removeEventListener("keydown",onKey);
  },[open]);

  useEffect(()=>{
    if(!open||index!==slides.length-1||pushPromptTracked.current)return;
    pushPromptTracked.current=true;
    void sendSiteAnalyticsEvent("PWA_PUSH_PROMPTED");
    if(nativeShellMode()){setPushState("idle");return}
    if(!("Notification" in window)){setPushState("unsupported");return}
    if(Notification.permission==="granted")setPushState("granted");
    else if(Notification.permission==="denied")setPushState("denied");
  },[open,index]);

  async function registerGrantedPush(){
    if(!("serviceWorker" in navigator)||!("PushManager" in window))return;
    const base=(process.env.NEXT_PUBLIC_API_URL??"/api").replace(/\/$/,"");
    const keyResponse=await fetch(`${base}/notifications/push/public-key`,{credentials:"include",cache:"no-store"});
    if(!keyResponse.ok)return;
    const payload=await keyResponse.json() as {configured?:boolean;publicKey?:string|null};
    if(!payload.configured||!payload.publicKey)return;
    const padding="=".repeat((4-(payload.publicKey.length%4))%4);
    const base64=(payload.publicKey+padding).replace(/-/g,"+").replace(/_/g,"/");
    const raw=atob(base64);
    const key=Uint8Array.from([...raw].map(char=>char.charCodeAt(0)));
    const registration=await navigator.serviceWorker.ready;
    let subscription=await registration.pushManager.getSubscription();
    if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
    const json=subscription.toJSON();
    if(!json.keys?.p256dh||!json.keys?.auth)return;
    const response=await fetch(`${base}/notifications/push/subscribe`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({platform:"WEB",endpoint:subscription.endpoint,keys:json.keys,deviceLabel:navigator.platform||"Web"})});
    if(response.ok)localStorage.setItem(PUSH_LAST_SYNC_KEY,String(Date.now()));
  }

  function finish(){
    localStorage.setItem(COMPLETE_KEY,"1");
    void sendSiteAnalyticsEvent("PWA_ONBOARDING_COMPLETED");
    setOpen(false);
    window.dispatchEvent(new CustomEvent("pa:pwa-onboarding-complete"));
    if(window.location.pathname!=="/"||window.location.search||window.location.hash)window.location.assign("/");
    else window.scrollTo({top:0,behavior:"auto"});
  }

  function skipNotifications(){
    localStorage.setItem(PUSH_PROMPT_SEEN_KEY,"1");
    void sendSiteAnalyticsEvent("PWA_PUSH_DECLINED");
    finish();
  }

  async function activateNotifications(){
    if(pushBusy)return;
    if(nativeShellMode()){
      setPushBusy(true);
      try{
        const result=await requestNativePush();
        localStorage.setItem(PUSH_PROMPT_SEEN_KEY,"1");
        if(result.ok){setPushState("granted");void sendSiteAnalyticsEvent("PWA_PUSH_ACCEPTED");}
        else{setPushState(result.permission==="denied"?"denied":"unsupported");void sendSiteAnalyticsEvent("PWA_PUSH_DECLINED");}
        finish();
      }finally{setPushBusy(false)}
      return;
    }
    if(!("Notification" in window)){
      setPushState("unsupported");
      localStorage.setItem(PUSH_PROMPT_SEEN_KEY,"1");
      finish();
      return;
    }
    setPushBusy(true);
    try{
      const permission=Notification.permission==="granted"?"granted":await Notification.requestPermission();
      localStorage.setItem(PUSH_PROMPT_SEEN_KEY,"1");
      if(permission!=="granted"){
        setPushState("denied");
        void sendSiteAnalyticsEvent("PWA_PUSH_DECLINED");
        finish();
        return;
      }
      setPushState("granted");
      void sendSiteAnalyticsEvent("PWA_PUSH_ACCEPTED");
      await registerGrantedPush().catch(()=>undefined);
      finish();
    }finally{setPushBusy(false)}
  }

  function next(){
    if(index===slides.length-1)return;
    setIndex(index+1);
  }

  function previous(){setIndex(Math.max(0,index-1));}

  function onTouchStart(event:TouchEvent<HTMLDivElement>){
    if(event.touches.length!==1)return;
    touchStart.current={x:event.touches[0]!.clientX,y:event.touches[0]!.clientY};
  }

  function onTouchEnd(event:TouchEvent<HTMLDivElement>){
    const start=touchStart.current;
    touchStart.current=null;
    if(!start||event.changedTouches.length!==1)return;
    const end=event.changedTouches[0]!;
    const dx=end.clientX-start.x;
    const dy=end.clientY-start.y;
    if(Math.abs(dx)<48||Math.abs(dx)<=Math.abs(dy)*1.15)return;
    if(dx<0){
      if(index<slides.length-1)setIndex(index+1);
    }else if(index>0)setIndex(index-1);
  }

  if(!open)return null;
  const slide=slides[index]!;
  const last=index===slides.length-1;

  return <div className="pwa-onboarding-overlay" role="dialog" aria-modal="true" aria-labelledby="pwa-onboarding-title" data-no-pull-refresh onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
    <div className="pwa-onboarding-shell">
      <header className="pwa-onboarding-brand">
        <img src={appLogoUrl||"/icons/icon-192.png"} alt=""/>
        <div><strong>Petit Annonces</strong><span>L’application qui vous accompagne</span></div>
      </header>

      <main className="pwa-onboarding-slide" key={index} aria-live="polite">
        <div className={`pwa-onboarding-visual pwa-onboarding-visual-${index+1}`} aria-hidden="true">
          <span className="pwa-onboarding-orbit orbit-a"><AppIcon name={slide.accents[0]!}/></span>
          <span className="pwa-onboarding-orbit orbit-b"><AppIcon name={slide.accents[1]!}/></span>
          <span className="pwa-onboarding-orbit orbit-c"><AppIcon name={slide.accents[2]!}/></span>
          <span className="pwa-onboarding-main-icon"><AppIcon name={slide.icon}/></span>
          <i className="pwa-onboarding-ring ring-one"/><i className="pwa-onboarding-ring ring-two"/>
        </div>
        <div className="pwa-onboarding-copy">
          <span>{slide.eyebrow}</span>
          <h1 id="pwa-onboarding-title">{slide.title}</h1>
          <p>{slide.text}</p>
          {last&&<div className="pwa-onboarding-notification-points"><span><AppIcon name="comments"/> Nouveaux messages</span><span><AppIcon name="handshake"/> Offres reçues</span><span><AppIcon name="truck"/> Suivi des commandes</span></div>}
          {last&&pushState==="denied"&&<small className="pwa-onboarding-notification-note">Les notifications sont bloquées dans les réglages de votre appareil. Vous pourrez les réactiver plus tard depuis Paramètres.</small>}
          {last&&pushState==="unsupported"&&<small className="pwa-onboarding-notification-note">Les notifications ne sont pas disponibles sur cet appareil.</small>}
        </div>
        {!last&&<div className="pwa-onboarding-swipe" aria-hidden="true"><span className="pwa-onboarding-swipe-line">←</span><b>☝</b><span>Glissez à gauche ou à droite</span><span className="pwa-onboarding-swipe-line">→</span></div>}
      </main>

      <footer className="pwa-onboarding-footer">
        <div className="pwa-onboarding-dots" role="tablist" aria-label="Étapes de présentation">
          {slides.map((item,i)=><button key={item.title} type="button" className={i===index?"is-active":""} onClick={()=>setIndex(i)} aria-label={`Étape ${i+1} sur ${slides.length}`} aria-selected={i===index}/>) }
        </div>
        {last?<div className="pwa-onboarding-actions pwa-onboarding-notification-actions">
          <button type="button" className="pwa-onboarding-back" onClick={skipNotifications} disabled={pushBusy}><span>Plus tard</span></button>
          <button type="button" className="pwa-onboarding-next" onClick={()=>void activateNotifications()} disabled={pushBusy||pushState==="denied"||pushState==="unsupported"}><AppIcon name="bell"/><span>{pushBusy?"Activation…":pushState==="granted"?"Continuer vers l’accueil":"Activer les notifications"}</span></button>
          {(pushState==="denied"||pushState==="unsupported")&&<button type="button" className="pwa-onboarding-home-fallback" onClick={skipNotifications}>Continuer vers l’accueil <AppIcon name="arrow-right"/></button>}
        </div>:<div className="pwa-onboarding-actions">
          <button type="button" className="pwa-onboarding-back" onClick={previous} disabled={index===0} aria-label="Étape précédente"><AppIcon name="chevron-left"/> <span>Précédent</span></button>
          <button type="button" className="pwa-onboarding-next" onClick={next}><span>Suivant</span><AppIcon name="chevron-right"/></button>
        </div>}
      </footer>
    </div>
  </div>;
}
