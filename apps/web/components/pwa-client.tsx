"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppIcon, type AppIconName } from "./app-icon";
import { PwaOnboarding } from "./pwa-onboarding";
import { sendSiteAnalyticsEvent } from "./site-telemetry";
import { lockBodyScroll } from "../lib/body-scroll-lock";
import { nativeShellMode, requestNativePush } from "../lib/native-shell";

type NavItem={label:string;href:string;icon:AppIconName;post?:boolean};
type InstallPromptEvent=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:"accepted"|"dismissed"}>};
type InstalledRelatedApp={platform?:string;id?:string;url?:string};
type RelatedAppsNavigator=Navigator&{getInstalledRelatedApps?:()=>Promise<InstalledRelatedApp[]>;standalone?:boolean};
type Platform="android"|"ios"|null;
const nav:NavItem[]=[
  {label:"Accueil",href:"/",icon:"home"},
  {label:"Recherche",href:"/recherche",icon:"search"},
  {label:"Déposer",href:"/deposer-une-annonce",icon:"plus",post:true},
  {label:"Messages",href:"/messages",icon:"comments"},
  {label:"Compte",href:"/mon-compte",icon:"user"},
];
const INSTALLED_KEY="pa_pwa_installed";
const HIDDEN_UNTIL_KEY="pa_pwa_install_hidden_until";
const INSTALLED_COOKIE="pa_pwa_installed";
const DAY_MS=24*60*60*1000;
const IOS_INSTALL_INTENT_MS=180*DAY_MS;

function hasInstalledCookie(){return document.cookie.split(";").some(part=>part.trim()===`${INSTALLED_COOKIE}=1`)}
function rememberPwaInstalled(){
  try{localStorage.setItem(INSTALLED_KEY,"1")}catch{}
  try{document.cookie=`${INSTALLED_COOKIE}=1; Max-Age=31536000; Path=/; SameSite=Lax; Secure`}catch{}
}
async function detectInstalledPwa(){
  if(standaloneMode())return true;
  const nav=navigator as RelatedAppsNavigator;
  if(typeof nav.getInstalledRelatedApps==="function"){
    try{const apps=await nav.getInstalledRelatedApps();if(apps.some(app=>app.platform==="webapp"||(app.platform==="play"&&app.id==="fr.petitannonces.petitannoncesapp")))return true}catch{}
  }
  try{if(localStorage.getItem(INSTALLED_KEY)==="1")return true}catch{}
  return hasInstalledCookie();
}

function devicePlatform():Platform{
  const ua=navigator.userAgent||"";
  const ios=/iPhone|iPad|iPod/i.test(ua)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
  if(ios)return "ios";
  if(/Android/i.test(ua))return "android";
  return null;
}
function standaloneMode(){return nativeShellMode()||window.matchMedia("(display-mode: standalone)").matches||Boolean((navigator as Navigator&{standalone?:boolean}).standalone)}
type MessageSummary={unreadConversations?:number;pendingOffers?:number;unreadNotifications?:number};
async function syncAppBadge():Promise<MessageSummary|null>{
  const nav=navigator as Navigator&{setAppBadge?:(count:number)=>Promise<void>;clearAppBadge?:()=>Promise<void>};
  try{
    const r=await fetch(`${(process.env.NEXT_PUBLIC_API_URL??"/api").replace(/\/$/,"")}/account/message-summary`,{credentials:"include",cache:"no-store"});
    if(!r.ok)return null;
    const p=await r.json() as MessageSummary;
    const count=Math.max(0,Number(p.unreadNotifications??0));
    if(nav.setAppBadge){if(count>0)await nav.setAppBadge(count);else{await nav.setAppBadge(0);await nav.clearAppBadge?.().catch(()=>undefined)}}
    return p;
  }catch{return null}
}
function urlBase64ToUint8Array(value:string){const padding="=".repeat((4-(value.length%4))%4);const base64=(value+padding).replace(/-/g,"+").replace(/_/g,"/");const raw=atob(base64);return Uint8Array.from([...raw].map(char=>char.charCodeAt(0)))}
async function enableDevicePush(){
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) throw new Error("push_unsupported");
  const base=(process.env.NEXT_PUBLIC_API_URL??"/api").replace(/\/$/,"");
  const keyResponse=await fetch(`${base}/notifications/push/public-key`,{credentials:"include",cache:"no-store"});
  if(!keyResponse.ok)throw new Error(keyResponse.status===401?"unauthorized":"push_key_unavailable");
  const payload=await keyResponse.json() as {configured?:boolean;publicKey?:string|null};
  if(!payload.configured||!payload.publicKey)throw new Error("push_unavailable");
  const permission=await Notification.requestPermission();
  if(permission!=="granted")throw new Error(permission==="denied"?"permission_denied":"permission_not_granted");
  const registration=await navigator.serviceWorker.ready;
  let subscription=await registration.pushManager.getSubscription();
  if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(payload.publicKey)});
  const json=subscription.toJSON();
  const response=await fetch(`${base}/notifications/push/subscribe`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({platform:"WEB",endpoint:subscription.endpoint,keys:json.keys,deviceLabel:navigator.platform||"Web"})});
  if(!response.ok)throw new Error("subscribe_failed");
}
const ONBOARDING_COMPLETE_KEY="pa_pwa_onboarding_complete_v1";
const PUSH_PROMPT_SEEN_KEY="pa_pwa_push_prompt_seen";
const PUSH_PROMPT_SESSION_KEY="pa_pwa_push_prompt_session_v1";
const PUSH_LAST_SYNC_KEY="pa_pwa_push_last_sync";
const PUSH_SYNC_INTERVAL_MS=6*60*60*1000;

async function syncGrantedDevicePush(){
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window) || Notification.permission!=="granted") return false;
  const base=(process.env.NEXT_PUBLIC_API_URL??"/api").replace(/\/$/,"");
  const keyResponse=await fetch(`${base}/notifications/push/public-key`,{credentials:"include",cache:"no-store"});
  if(!keyResponse.ok)return false;
  const payload=await keyResponse.json() as {configured?:boolean;publicKey?:string|null};
  if(!payload.configured||!payload.publicKey)return false;
  const registration=await navigator.serviceWorker.ready;
  let subscription=await registration.pushManager.getSubscription();
  if(!subscription){
    subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(payload.publicKey)});
  }
  const json=subscription.toJSON();
  if(!json.keys?.p256dh||!json.keys?.auth)return false;
  const response=await fetch(`${base}/notifications/push/subscribe`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({platform:"WEB",endpoint:subscription.endpoint,keys:json.keys,deviceLabel:navigator.platform||"Web"})});
  if(!response.ok)return false;
  localStorage.setItem(PUSH_LAST_SYNC_KEY,String(Date.now()));
  return true;
}

export function PwaClient({initialPwaIconUrl="/icons/icon-192.png",initialAppLogoUrl="/icons/icon-192.png"}:{initialPwaIconUrl?:string;initialAppLogoUrl?:string}){
  const pathname=usePathname();
  const router=useRouter();
  const [installPrompt,setInstallPrompt]=useState<InstallPromptEvent|null>(null);
  const [installed,setInstalled]=useState(false);
  const [platform,setPlatform]=useState<Platform>(null);
  const [showInstall,setShowInstall]=useState(false);
  const [iosHelp,setIosHelp]=useState(false);
  const [accountAvatarUrl,setAccountAvatarUrl]=useState<string|null>(null);
  const [authenticated,setAuthenticated]=useState(false);
  const [unreadConversations,setUnreadConversations]=useState(0);
  const [showPushPrompt,setShowPushPrompt]=useState(false);
  const [pushBusy,setPushBusy]=useState(false);
  const [pushPromptMessage,setPushPromptMessage]=useState("");
  const [pwaIconUrl]=useState(initialPwaIconUrl);
  const [appLogoUrl]=useState(initialAppLogoUrl);

  useEffect(()=>{
    const root=document.documentElement;
    if(!standaloneMode()||localStorage.getItem(ONBOARDING_COMPLETE_KEY)!=="1"){root.classList.remove("pa-pwa-launch-splash-active");return;}
    root.classList.add("pa-pwa-launch-splash-active");
    const timer=window.setTimeout(()=>{
      root.classList.remove("pa-pwa-launch-splash-active");
    },500);
    return()=>{window.clearTimeout(timer);root.classList.remove("pa-pwa-launch-splash-active")};
  },[]);

  useEffect(()=>{
    const onServiceWorkerMessage=(event:MessageEvent)=>{
      const data=event.data as {type?:string;url?:string;count?:number}|undefined;
      if(data?.type==="NOTIFICATION_COUNT"){
        const count=Math.max(0,Number(data.count??0));
        if(Number.isFinite(count)){
          window.dispatchEvent(new CustomEvent("pa:notification-count",{detail:count}));
          window.dispatchEvent(new CustomEvent("pa:message-summary",{detail:{unreadNotifications:count}}));
        }
        return;
      }
      if(data?.type!=="NAVIGATE_TO"||!data.url)return;
      try{
        const target=new URL(data.url,window.location.origin);
        if(target.origin!==window.location.origin)return;
        const next=`${target.pathname}${target.search}${target.hash}`;
        if(standaloneMode())window.location.assign(next);else router.push(next);
      }catch{}
    };
    if("serviceWorker" in navigator){
      const swReloadKey="pa_sw_reloaded_v45";
      const onControllerChange=()=>{
        try{
          if(sessionStorage.getItem(swReloadKey)==="1")return;
          sessionStorage.setItem(swReloadKey,"1");
        }catch{}
        const sensitivePath=window.location.pathname.startsWith("/checkout")||window.location.pathname.startsWith("/deposer-une-annonce")||window.location.pathname.startsWith("/importer-une-annonce");
        if(!sensitivePath)window.location.reload();
      };
      navigator.serviceWorker.addEventListener("controllerchange",onControllerChange);
      navigator.serviceWorker.register("/sw.js?v=45",{scope:"/",updateViaCache:"none"}).then(reg=>{const update=()=>void reg.update().catch(()=>undefined);if(typeof window.requestIdleCallback==="function")window.requestIdleCallback(update,{timeout:3000});else window.setTimeout(update,1400)}).catch(()=>undefined);
      navigator.serviceWorker.addEventListener("message",onServiceWorkerMessage);
    }
    let disposed=false;
    const currentPlatform=devicePlatform();
    setPlatform(currentPlatform);
    const evaluateInstallState=async()=>{
      const isInstalled=await detectInstalledPwa();if(disposed)return;
      if(isInstalled){rememberPwaInstalled();setInstalled(true);setShowInstall(false);return true;}
      setInstalled(false);
      const hiddenUntil=Number(localStorage.getItem(HIDDEN_UNTIL_KEY)??0);
      if(currentPlatform&&(!Number.isFinite(hiddenUntil)||Date.now()>=hiddenUntil))setShowInstall(true);
      return false;
    };
    void evaluateInstallState();

    const before=(event:Event)=>{
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
      void detectInstalledPwa().then(isInstalled=>{
        if(disposed)return;
        if(isInstalled){rememberPwaInstalled();setInstalled(true);setShowInstall(false);return;}
        const hiddenUntil=Number(localStorage.getItem(HIDDEN_UNTIL_KEY)??0);
        if(Date.now()>=hiddenUntil)setShowInstall(true);
      });
    };
    const done=()=>{
      rememberPwaInstalled();
      localStorage.removeItem(HIDDEN_UNTIL_KEY);
      localStorage.removeItem(ONBOARDING_COMPLETE_KEY);
      localStorage.removeItem(PUSH_PROMPT_SEEN_KEY);
      sessionStorage.removeItem(PUSH_PROMPT_SESSION_KEY);
      setInstalled(true);
      setShowInstall(false);
      setInstallPrompt(null);
    };
    const displayQuery=window.matchMedia("(display-mode: standalone)");
    const displayChanged=()=>{if(displayQuery.matches)done();else void evaluateInstallState()};
    window.addEventListener("beforeinstallprompt",before);
    window.addEventListener("appinstalled",done);
    displayQuery.addEventListener?.("change",displayChanged);
    return()=>{disposed=true;window.removeEventListener("beforeinstallprompt",before);window.removeEventListener("appinstalled",done);displayQuery.removeEventListener?.("change",displayChanged);if("serviceWorker" in navigator)navigator.serviceWorker.removeEventListener("message",onServiceWorkerMessage)};
  },[router]);

  // Internal same-origin links are handled once by NavigationExperience.
  // Keeping a second capture-phase router interceptor here caused duplicate PWA transitions.

  useEffect(()=>{
    const root=document.documentElement;
    const updateKeyboardState=()=>{
      if(window.innerWidth>760){root.classList.remove("pa-mobile-keyboard-open");return;}
      const viewport=window.visualViewport;
      const visibleHeight=viewport?.height??window.innerHeight;
      const active=document.activeElement instanceof HTMLElement?document.activeElement:null;
      const textField=Boolean(active?.matches("textarea,select,input:not([type='checkbox']):not([type='radio']):not([type='file']):not([type='button']):not([type='submit']),[contenteditable='true']"));
      const keyboardOpen=window.innerHeight-visibleHeight>140||textField;
      root.classList.toggle("pa-mobile-keyboard-open",keyboardOpen);
    };
    const updateAfterFocus=()=>window.setTimeout(updateKeyboardState,30);
    updateKeyboardState();
    window.addEventListener("resize",updateKeyboardState);
    document.addEventListener("focusin",updateAfterFocus);
    document.addEventListener("focusout",updateAfterFocus);
    window.visualViewport?.addEventListener("resize",updateKeyboardState);
    window.visualViewport?.addEventListener("scroll",updateKeyboardState);
    return()=>{window.removeEventListener("resize",updateKeyboardState);document.removeEventListener("focusin",updateAfterFocus);document.removeEventListener("focusout",updateAfterFocus);window.visualViewport?.removeEventListener("resize",updateKeyboardState);window.visualViewport?.removeEventListener("scroll",updateKeyboardState);root.classList.remove("pa-mobile-keyboard-open")};
  },[]);

  useEffect(()=>{
    if(!authenticated)return;
    let disposed=false;
    const syncIfNeeded=()=>{
      if(disposed||!("Notification" in window)||Notification.permission!=="granted")return;
      const last=Number(localStorage.getItem(PUSH_LAST_SYNC_KEY)??0);
      if(Number.isFinite(last)&&Date.now()-last<PUSH_SYNC_INTERVAL_MS)return;
      void syncGrantedDevicePush().catch(()=>undefined);
    };
    syncIfNeeded();
    const onVisible=()=>{if(document.visibilityState==="visible")syncIfNeeded()};
    document.addEventListener("visibilitychange",onVisible);
    return()=>{disposed=true;document.removeEventListener("visibilitychange",onVisible)};
  },[authenticated]);

  useEffect(()=>{
    if(!showPushPrompt)return;
    const unlock=lockBodyScroll();
    document.body.classList.add("pa-pwa-push-open");
    return()=>{unlock();document.body.classList.remove("pa-pwa-push-open")};
  },[showPushPrompt]);

  useEffect(()=>{
    if(!authenticated||!standaloneMode())return;
    let timer:ReturnType<typeof setTimeout>|null=null;
    const maybeShow=()=>{
      if(localStorage.getItem(ONBOARDING_COMPLETE_KEY)!=="1")return;
      if(localStorage.getItem(PUSH_PROMPT_SEEN_KEY)==="1")return;
      if(sessionStorage.getItem(PUSH_PROMPT_SESSION_KEY)==="1")return;
      if(document.body.classList.contains("pa-pwa-onboarding-open"))return;
      if(!nativeShellMode()){
        if(!("serviceWorker" in navigator)||!("PushManager" in window)||!("Notification" in window))return;
        if(Notification.permission==="granted"){localStorage.setItem(PUSH_PROMPT_SEEN_KEY,"1");void syncGrantedDevicePush().catch(()=>undefined);return;}
        if(Notification.permission==="denied"){localStorage.setItem(PUSH_PROMPT_SEEN_KEY,"1");return;}
      }
      sessionStorage.setItem(PUSH_PROMPT_SESSION_KEY,"1");
      setShowPushPrompt(true);
      void sendSiteAnalyticsEvent("PWA_PUSH_PROMPTED");
    };
    const schedule=()=>{if(timer)clearTimeout(timer);timer=setTimeout(maybeShow,650)};
    schedule();
    window.addEventListener("pa:pwa-onboarding-complete",schedule);
    return()=>{if(timer)clearTimeout(timer);window.removeEventListener("pa:pwa-onboarding-complete",schedule)};
  },[authenticated,pathname]);

  useEffect(()=>{
    const onMessageSummary=(event:Event)=>{
      const detail=(event as CustomEvent<MessageSummary>).detail;
      if(!detail||typeof detail!=="object")return;
      if(detail.unreadConversations!=null)setUnreadConversations(Math.max(0,Number(detail.unreadConversations)));
    };
    window.addEventListener("pa:message-summary",onMessageSummary);
    return()=>window.removeEventListener("pa:message-summary",onMessageSummary);
  },[]);

  useEffect(()=>{
    const syncSummary=()=>void syncAppBadge().then(summary=>setUnreadConversations(Math.max(0,Number(summary?.unreadConversations??0))));
    let signedIn=false;
    fetch(`${(process.env.NEXT_PUBLIC_API_URL??"/api").replace(/\/$/,"")}/auth/me`,{credentials:"include",cache:"no-store"}).then(async response=>{
      if(!response.ok){signedIn=false;setAuthenticated(false);setAccountAvatarUrl(null);setUnreadConversations(0);return;}
      signedIn=true;setAuthenticated(true);
      const payload=await response.json() as {user?:{profile?:{avatarUrl?:string|null}}};
      setAccountAvatarUrl(payload.user?.profile?.avatarUrl??null);
      syncSummary();
    }).catch(()=>{signedIn=false;setAuthenticated(false);setAccountAvatarUrl(null);setUnreadConversations(0)});
    const onVisible=()=>{if(document.visibilityState==="visible"&&signedIn)syncSummary()};
    document.addEventListener("visibilitychange",onVisible);
    return()=>{document.removeEventListener("visibilitychange",onVisible)};
  },[pathname]);

  function hideForDay(){
    localStorage.setItem(HIDDEN_UNTIL_KEY,String(Date.now()+DAY_MS));
    setShowInstall(false);
    setIosHelp(false);
  }
  function hideIosInstallHelp(){
    localStorage.setItem(HIDDEN_UNTIL_KEY,String(Date.now()+IOS_INSTALL_INTENT_MS));
    setShowInstall(false);
    setIosHelp(false);
  }

  async function install(){
    if(platform==="ios"){
      localStorage.setItem(HIDDEN_UNTIL_KEY,String(Date.now()+IOS_INSTALL_INTENT_MS));
      setShowInstall(false);
      setIosHelp(true);
      return;
    }
    if(!installPrompt){
      hideForDay();
      return;
    }
    await installPrompt.prompt();
    const choice=await installPrompt.userChoice;
    if(choice.outcome==="accepted"){
      rememberPwaInstalled();
      localStorage.removeItem(HIDDEN_UNTIL_KEY);
      localStorage.removeItem(ONBOARDING_COMPLETE_KEY);
      localStorage.removeItem(PUSH_PROMPT_SEEN_KEY);
      sessionStorage.removeItem(PUSH_PROMPT_SESSION_KEY);
      setInstalled(true);
      setShowInstall(false);
      setInstallPrompt(null);
    }else hideForDay();
  }

  function dismissPushPrompt(){localStorage.setItem(PUSH_PROMPT_SEEN_KEY,"1");void sendSiteAnalyticsEvent("PWA_PUSH_DECLINED");setShowPushPrompt(false);setPushPromptMessage("")}
  async function activatePushFromPrompt(){
    setPushBusy(true);setPushPromptMessage("");
    try{
      if(nativeShellMode()){
        const result=await requestNativePush();
        if(!result.ok)throw new Error(result.permission==="denied"?"permission_denied":result.authenticated===false?"unauthorized":"push_failed");
      }else await enableDevicePush();
      localStorage.setItem(PUSH_PROMPT_SEEN_KEY,"1");void sendSiteAnalyticsEvent("PWA_PUSH_ACCEPTED");setShowPushPrompt(false)
    }
    catch(error){const code=error instanceof Error?error.message:"push_failed";if(code==="permission_denied"||code==="permission_not_granted"){localStorage.setItem(PUSH_PROMPT_SEEN_KEY,"1");void sendSiteAnalyticsEvent("PWA_PUSH_DECLINED");setPushPromptMessage("Les notifications sont bloquées ou n’ont pas été autorisées. Vous pourrez les réactiver dans les réglages de votre appareil.");}else if(code==="unauthorized")setPushPromptMessage("Reconnectez-vous pour activer les notifications.");else setPushPromptMessage("Impossible d’activer les notifications pour le moment.");}
    finally{setPushBusy(false)}
  }

  return <>
    <PwaOnboarding appLogoUrl={appLogoUrl}/>
    {!installed&&showInstall&&platform&&<aside className="pwa-install-flash" role="dialog" aria-label="Installer l’application Petit Annonces">
      <img src={pwaIconUrl} alt="" className="pwa-install-flash-icon"/>
      <div className="pwa-install-flash-copy">
        <strong>Petit Annonces sur votre téléphone</strong>
        <span>{platform==="ios"?"Installez l’app sur votre iPhone ou iPad.":"Installez l’app Android pour un accès plus rapide et les notifications."}</span>
      </div>
      <button type="button" className="pwa-install-action" onClick={()=>void install()}>Installer</button>
      <button type="button" className="pwa-install-close" onClick={hideForDay} aria-label="Fermer pendant 24 heures">×</button>
    </aside>}
    {iosHelp&&<div className="pwa-ios-overlay" role="presentation" onClick={()=>setIosHelp(false)}>
      <section className="pwa-ios-sheet" role="dialog" aria-modal="true" aria-labelledby="pwa-ios-title" onClick={e=>e.stopPropagation()}>
        <div className="pwa-ios-grabber"/>
        <button type="button" className="pwa-ios-sheet-close" onClick={()=>setIosHelp(false)} aria-label="Fermer">×</button>
        <img src={pwaIconUrl} alt="" className="pwa-ios-sheet-icon"/>
        <div className="pwa-ios-sheet-head">
          <span>Installation sur iPhone</span>
          <h2 id="pwa-ios-title">Installer Petit Annonces</h2>
          <p>Ajoutez Petit Annonces comme une vraie app sur votre écran d’accueil.</p>
        </div>
        <ol className="pwa-ios-steps">
          <li><b>1</b><div><strong>Touchez Partager</strong><span>Dans Safari, utilisez l’icône de partage en bas de l’écran.</span></div><span className="pwa-ios-share-symbol">↥</span></li>
          <li><b>2</b><div><strong>Choisissez « Sur l’écran d’accueil »</strong><span>Faites défiler la feuille de partage si nécessaire.</span></div></li>
          <li><b>3</b><div><strong>Touchez Ajouter</strong><span>L’icône Petit Annonces apparaîtra comme une application.</span></div></li>
        </ol>
        <div className="pwa-ios-tip">Après l’installation, ouvrez Petit Annonces depuis l’icône créée pour profiter du mode application et des notifications.</div>
        <button type="button" className="pwa-ios-done" onClick={hideIosInstallHelp}>J’ai compris</button>
      </section>
    </div>}
    {authenticated&&showPushPrompt&&<div className="pwa-push-overlay" role="presentation" onClick={dismissPushPrompt}>
      <section className="pwa-push-sheet" role="dialog" aria-modal="true" aria-labelledby="pwa-push-title" onClick={e=>e.stopPropagation()}>
        <span className="pwa-push-icon"><AppIcon name="bell"/></span>
        <div><small>Restez informé</small><h2 id="pwa-push-title">Activer les notifications ?</h2><p>Recevez vos nouveaux messages, offres, commandes et mises à jour importantes directement sur votre téléphone.</p></div>
        {pushPromptMessage&&<p className="pwa-push-error">{pushPromptMessage}</p>}
        <div className="pwa-push-actions"><button type="button" className="pwa-push-later" onClick={dismissPushPrompt}>Plus tard</button><button type="button" className="pwa-push-enable" disabled={pushBusy} onClick={()=>void activatePushFromPrompt()}>{pushBusy?"Activation…":"Activer les notifications"}</button></div>
      </section>
    </div>}
    <nav className="mobile-bottom-nav" aria-label="Navigation mobile">
      {nav.map(item=>{
        const accountItem=item.href==="/mon-compte";
        const messagesItem=item.href==="/messages";
        const active=mobileNavItemActive(item,pathname);
        const classes=`${active?"is-active ":""}${item.post?"is-post ":""}${accountItem&&accountAvatarUrl?"has-account-avatar":""}`.trim();
        const content=<><span>{accountItem&&accountAvatarUrl?<img className="mobile-bottom-avatar" src={accountAvatarUrl} alt="Photo de profil"/>:<AppIcon name={item.icon}/>}</span>{messagesItem&&authenticated&&unreadConversations>0&&<i className="mobile-bottom-count">{unreadConversations>99?"99+":unreadConversations}</i>}{!item.post&&<small>{item.label}</small>}</>;
        if(accountItem&&authenticated)return <button key={item.href} type="button" className={classes} aria-label="Ouvrir le menu du compte" aria-pressed={active} onClick={()=>window.dispatchEvent(new CustomEvent("pa:toggle-mobile-account"))}>{content}</button>;
        return <a key={item.href} href={accountItem?"/connexion":item.href} className={classes} aria-label={item.label} aria-current={active?"page":undefined}>{content}</a>
      })}
    </nav>
  </>;
}

function mobileNavItemActive(item:NavItem,pathname:string){
  if(item.href==="/")return pathname==="/";
  if(item.href==="/recherche")return pathname==="/recherche"||pathname.startsWith("/categorie/")||pathname.startsWith("/c/")||pathname.startsWith("/vehicules/")||pathname.startsWith("/immobilier/")||pathname.startsWith("/ville/")||pathname.startsWith("/annonce/")||pathname.startsWith("/boutique/")||pathname.startsWith("/profil/")||pathname==="/professionnels";
  if(item.href==="/deposer-une-annonce")return pathname==="/deposer-une-annonce"||pathname==="/annonce-ajoutee";
  if(item.href==="/messages")return pathname==="/messages"||pathname.startsWith("/espace-pro/messages");
  if(item.href==="/mon-compte")return pathname.startsWith("/mon-compte")||(pathname.startsWith("/espace-pro")&&!pathname.startsWith("/espace-pro/messages"))||pathname.startsWith("/commandes")||pathname.startsWith("/assistance")||pathname.startsWith("/notifications")||pathname.startsWith("/parrainage")||pathname.startsWith("/checkout");
  return pathname===item.href||pathname.startsWith(`${item.href}/`);
}
