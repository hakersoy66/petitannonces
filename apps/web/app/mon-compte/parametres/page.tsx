"use client";

import { FormEvent, useEffect, useState } from "react";
import { AccountSidebar } from "../../../components/account-sidebar";
import styles from "./page.module.css";
import { fetchWithRetry } from "../../../lib/fetch-resilient";

type Preferences={
  inAppMessages:boolean;inAppOffers:boolean;inAppListingUpdates:boolean;
  emailMessages:boolean;emailOffers:boolean;emailListingUpdates:boolean;emailMarketing:boolean;
  pushMessages:boolean;pushOffers:boolean;pushListingUpdates:boolean;
};
type SettingsData={user:{email:string;kind:"PARTICULIER"|"PROFESSIONNEL";emailVerified:boolean};preferences:Preferences;sessions:Array<{id:string;userAgent:string|null;lastSeenAt:string;current:boolean}>};
const defaults:Preferences={inAppMessages:true,inAppOffers:true,inAppListingUpdates:true,emailMessages:true,emailOffers:true,emailListingUpdates:true,emailMarketing:false,pushMessages:true,pushOffers:true,pushListingUpdates:true};
function apiBase(){return(process.env.NEXT_PUBLIC_API_URL??"/api").replace(/\/$/,"");}

export default function SettingsPage(){
  const[data,setData]=useState<SettingsData|null>(null);const[prefs,setPrefs]=useState(defaults);const[message,setMessage]=useState("");const[currentPassword,setCurrentPassword]=useState("");const[newPassword,setNewPassword]=useState("");const[devicePush,setDevicePush]=useState(false);const[pushSupported,setPushSupported]=useState(true);const[pushBusy,setPushBusy]=useState(false);const[prefSaving,setPrefSaving]=useState(false);const[pushStatus,setPushStatus]=useState("Vérification de cet appareil…");
  useEffect(()=>{fetchWithRetry(`${apiBase()}/account/settings`,{credentials:"include",cache:"no-store"},{timeoutMs:7000,retries:1}).then((r)=>r.ok?r.json():Promise.reject()).then((payload:SettingsData)=>{setData(payload);setPrefs(payload.preferences);}).catch(()=>setMessage("Impossible de charger vos paramètres pour le moment."));void inspectDevicePush();},[]);

  function urlBase64ToUint8Array(value:string){const padding="=".repeat((4-(value.length%4))%4);const base64=(value+padding).replace(/-/g,"+").replace(/_/g,"/");const raw=atob(base64);return Uint8Array.from([...raw].map(char=>char.charCodeAt(0)))}
  async function inspectDevicePush(){
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)){setPushSupported(false);setDevicePush(false);setPushStatus("Notifications non prises en charge sur cet appareil.");return}
    try{
      const reg=await navigator.serviceWorker.ready;const sub=await reg.pushManager.getSubscription();
      if(!sub||Notification.permission!=="granted"){setDevicePush(false);setPushStatus(Notification.permission==="denied"?"Notifications bloquées dans les réglages de l’appareil.":"Notifications désactivées sur cet appareil.");return}
      const statusResponse=await fetch(`${apiBase()}/notifications/push/status?endpoint=${encodeURIComponent(sub.endpoint)}`,{credentials:"include",cache:"no-store"});
      if(!statusResponse.ok){setDevicePush(false);setPushStatus("Impossible de vérifier les notifications pour le moment.");return}
      const status=await statusResponse.json() as{active?:boolean};const enabled=Boolean(status.active);setDevicePush(enabled);setPushStatus(enabled?"Notifications activées sur cet appareil.":"Notifications désactivées sur cet appareil.");
    }catch{setDevicePush(false);setPushStatus("Impossible de vérifier les notifications pour le moment.")}
  }
  async function toggleDevicePush(){
    if(!pushSupported)return;setPushBusy(true);
    try{
      const reg=await navigator.serviceWorker.ready;const existing=await reg.pushManager.getSubscription();
      if(devicePush){if(existing){const response=await fetch(`${apiBase()}/notifications/push/unsubscribe`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({endpoint:existing.endpoint})});if(!response.ok)throw new Error("unsubscribe");await existing.unsubscribe()}setDevicePush(false);setPushStatus("Notifications désactivées sur cet appareil.");return}
      const keyResponse=await fetch(`${apiBase()}/notifications/push/public-key`,{credentials:"include",cache:"no-store"});const kp=await keyResponse.json().catch(()=>({})) as{configured?:boolean;publicKey?:string|null};if(!keyResponse.ok||!kp.configured||!kp.publicKey)throw new Error("key");
      const permission=await Notification.requestPermission();if(permission!=="granted"){setPushStatus(permission==="denied"?"Notifications bloquées dans les réglages de l’appareil.":"Autorisation non accordée.");return}
      let sub=existing;if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(kp.publicKey)});const json=sub.toJSON();const response=await fetch(`${apiBase()}/notifications/push/subscribe`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({platform:"WEB",endpoint:sub.endpoint,keys:json.keys,deviceLabel:navigator.platform||"Web"})});if(!response.ok)throw new Error("subscribe");setDevicePush(true);setPushStatus("Notifications activées sur cet appareil.");
    }catch{setPushStatus("Impossible de modifier les notifications pour le moment.")}finally{setPushBusy(false)}
  }
  async function toggle(key:keyof Preferences){if(prefSaving)return;const previous=prefs;const next={...prefs,[key]:!prefs[key]};setPrefs(next);setPrefSaving(true);setMessage("");try{const response=await fetch(`${apiBase()}/account/notification-preferences`,{method:"PUT",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify(next)});if(!response.ok)throw new Error("save_failed");setMessage("Préférence enregistrée.")}catch{setPrefs(previous);setMessage("Impossible d’enregistrer les préférences.")}finally{setPrefSaving(false)}}
  async function changePassword(event:FormEvent){event.preventDefault();const response=await fetch(`${apiBase()}/account/change-password`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({currentPassword,newPassword})});setMessage(response.ok?"Mot de passe modifié. Les autres sessions ont été déconnectées.":"Vérifiez votre mot de passe actuel et le nouveau mot de passe.");if(response.ok){setCurrentPassword("");setNewPassword("");}}
  async function revokeOthers(){const response=await fetch(`${apiBase()}/account/sessions/revoke-others`,{method:"POST",credentials:"include"});setMessage(response.ok?"Les autres appareils ont été déconnectés.":"Action impossible pour le moment.");}
  const options:[keyof Preferences,string,string][]=[
    ["inAppMessages","Dans l’application · Messages","Afficher les nouveaux messages dans le centre de notifications"],
    ["inAppOffers","Dans l’application · Offres","Afficher les nouvelles offres et leurs réponses"],
    ["inAppListingUpdates","Dans l’application · Annonces, commandes & livraison","Afficher validation, commandes, expédition et livraison"],
    ["emailMessages","E-mail · Messages","Recevoir un e-mail pour les nouveaux messages"],
    ["emailOffers","E-mail · Offres","Recevoir les offres et contre-offres par e-mail"],
    ["emailListingUpdates","E-mail · Annonces, commandes & livraison","Recevoir le suivi de publication, commande et livraison par e-mail"],
    ["emailMarketing","E-mail · Conseils","Actualités et recommandations"],
    ["pushMessages","Push · Messages","Alertes instantanées pour les messages"],
    ["pushOffers","Push · Offres","Réagir rapidement à une offre"],
    ["pushListingUpdates","Push · Annonces, commandes & livraison","Alertes de publication, expédition et livraison sur vos appareils"],
  ];
  return <div className={styles.page}><main className={styles.shell}><AccountSidebar/><section className={styles.content}><div className={styles.heading}><span>Mon compte</span><h1>Paramètres</h1><p>Gérez vos notifications et les préférences de votre compte.</p></div>{message&&<div className={styles.message}>{message}</div>}
    <section className={`${styles.card} ${styles.devicePushCard}`}><div className={styles.devicePushRow}><div className={styles.devicePushIcon}>🔔</div><div className={styles.devicePushCopy}><h2>Notifications sur cet appareil</h2><p>{pushStatus}</p><small>Activez ou désactivez ici les notifications push de Petit Annonces pour ce téléphone.</small></div><button type="button" className={`${styles.devicePushToggle} ${devicePush?styles.devicePushOn:""}`} aria-pressed={devicePush} disabled={pushBusy||!pushSupported} onClick={()=>void toggleDevicePush()}><span/></button></div></section>
    <section className={styles.card}><div className={styles.cardHead}><div><h2>Notifications</h2><p>Choisissez séparément les notifications dans l’application, par e-mail et par push. Les changements sont enregistrés automatiquement.</p></div><span>{prefSaving?"Enregistrement…":"Auto-enregistré"}</span></div><div className={styles.prefGrid}>{options.map(([key,title,desc])=><label key={key} className={styles.pref}><div><strong>{title}</strong><small>{desc}</small></div><input type="checkbox" checked={prefs[key]} disabled={prefSaving} onChange={()=>void toggle(key)}/><span/></label>)}</div></section>
    <section className={styles.card}><div className={styles.cardHead}><div><h2>Mot de passe</h2><p>Utilisez au moins 10 caractères. Pour la double authentification et les vérifications, ouvrez le Centre de sécurité.</p></div><a className={styles.outline} href="/mon-compte/securite">Centre de sécurité</a></div><form className={styles.passwordForm} onSubmit={changePassword}><input type="password" placeholder="Mot de passe actuel" value={currentPassword} onChange={(e)=>setCurrentPassword(e.target.value)} required/><input type="password" minLength={10} placeholder="Nouveau mot de passe" value={newPassword} onChange={(e)=>setNewPassword(e.target.value)} required/><button>Modifier le mot de passe</button></form></section>
    <section className={styles.card}><div className={styles.cardHead}><div><h2>Appareils connectés</h2><p>{data?.sessions.length??0} session(s) active(s)</p></div><button type="button" className={styles.outline} onClick={revokeOthers}>Déconnecter les autres</button></div><div className={styles.sessions}>{data?.sessions.map((s)=><div key={s.id}><span>◉</span><div><strong>{s.current?"Cet appareil":"Appareil connecté"}</strong><small>{s.userAgent??"Navigateur inconnu"}</small></div>{s.current&&<b>Actuel</b>}</div>)}</div></section>
    <section className={`${styles.card} ${styles.pro}`}><div><span className={styles.proBadge}>PRO</span><h2>Développez votre activité</h2><p>Boutique, statistiques avancées, crédits de mise en avant et outils professionnels.</p></div><a href="/professionnels">Découvrir les offres Pro →</a></section>
  </section></main></div>;
}
