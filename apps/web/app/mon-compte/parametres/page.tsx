"use client";

import { FormEvent, useEffect, useState } from "react";
import { SiteHeader } from "../../../components/site-header";
import styles from "./page.module.css";

type Preferences={
  inAppMessages:boolean;inAppOffers:boolean;inAppListingUpdates:boolean;
  emailMessages:boolean;emailOffers:boolean;emailListingUpdates:boolean;emailMarketing:boolean;
  pushMessages:boolean;pushOffers:boolean;pushListingUpdates:boolean;
};
type SettingsData={user:{email:string;kind:"PARTICULIER"|"PROFESSIONNEL";emailVerified:boolean};preferences:Preferences;sessions:Array<{id:string;userAgent:string|null;lastSeenAt:string;current:boolean}>};
const defaults:Preferences={inAppMessages:true,inAppOffers:true,inAppListingUpdates:true,emailMessages:true,emailOffers:true,emailListingUpdates:true,emailMarketing:false,pushMessages:true,pushOffers:true,pushListingUpdates:true};
function apiBase(){return(process.env.NEXT_PUBLIC_API_URL??"http://127.0.0.1:4000").replace(/\/$/,"");}

export default function SettingsPage(){
  const[data,setData]=useState<SettingsData|null>(null);const[prefs,setPrefs]=useState(defaults);const[message,setMessage]=useState("");const[currentPassword,setCurrentPassword]=useState("");const[newPassword,setNewPassword]=useState("");
  useEffect(()=>{fetch(`${apiBase()}/account/settings`,{credentials:"include"}).then((r)=>r.ok?r.json():Promise.reject()).then((payload:SettingsData)=>{setData(payload);setPrefs(payload.preferences);}).catch(()=>setMessage("Connectez-vous pour gérer vos paramètres."));},[]);
  async function savePrefs(){const response=await fetch(`${apiBase()}/account/notification-preferences`,{method:"PUT",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify(prefs)});setMessage(response.ok?"Préférences enregistrées.":"Impossible d’enregistrer les préférences.");}
  async function changePassword(event:FormEvent){event.preventDefault();const response=await fetch(`${apiBase()}/account/change-password`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({currentPassword,newPassword})});setMessage(response.ok?"Mot de passe modifié. Les autres sessions ont été déconnectées.":"Vérifiez votre mot de passe actuel et le nouveau mot de passe.");if(response.ok){setCurrentPassword("");setNewPassword("");}}
  async function revokeOthers(){const response=await fetch(`${apiBase()}/account/sessions/revoke-others`,{method:"POST",credentials:"include"});setMessage(response.ok?"Les autres appareils ont été déconnectés.":"Action impossible pour le moment.");}
  const toggle=(key:keyof Preferences)=>setPrefs((p)=>({...p,[key]:!p[key]}));
  const options:[keyof Preferences,string,string][]=[
    ["inAppMessages","Dans l’application · Messages","Afficher les nouveaux messages dans le centre de notifications"],
    ["inAppOffers","Dans l’application · Offres","Afficher les nouvelles offres et leurs réponses"],
    ["inAppListingUpdates","Dans l’application · Annonces","Afficher validation, refus et expiration"],
    ["emailMessages","E-mail · Messages","Recevoir un e-mail pour les nouveaux messages"],
    ["emailOffers","E-mail · Offres","Recevoir les offres et contre-offres par e-mail"],
    ["emailListingUpdates","E-mail · Annonces","Recevoir le suivi de publication par e-mail"],
    ["emailMarketing","E-mail · Conseils","Actualités et recommandations"],
    ["pushMessages","Push · Messages","Alertes instantanées pour les messages"],
    ["pushOffers","Push · Offres","Réagir rapidement à une offre"],
    ["pushListingUpdates","Push · Annonces","Suivi de publication sur vos appareils"],
  ];
  return <div className={styles.page}><SiteHeader/><main className={styles.shell}><aside className={styles.side}><a href="/mon-compte">← Tableau de bord</a><a href="/mon-compte/profil">Profil & vérification</a><a href="/mon-compte/adresses">Adresses</a><a className={styles.active} href="/mon-compte/parametres">Paramètres & sécurité</a></aside><section className={styles.content}><div className={styles.heading}><span>Mon compte</span><h1>Paramètres & sécurité</h1><p>Gérez vos notifications, votre mot de passe et vos appareils connectés.</p></div>{message&&<div className={styles.message}>{message}</div>}
    <section className={styles.card}><div className={styles.cardHead}><div><h2>Notifications</h2><p>Choisissez séparément les notifications dans l’application, par e-mail et par push.</p></div><button onClick={savePrefs}>Enregistrer</button></div><div className={styles.prefGrid}>{options.map(([key,title,desc])=><label key={key} className={styles.pref}><div><strong>{title}</strong><small>{desc}</small></div><input type="checkbox" checked={prefs[key]} onChange={()=>toggle(key)}/><span/></label>)}</div></section>
    <section className={styles.card}><div className={styles.cardHead}><div><h2>Mot de passe</h2><p>Utilisez au moins 10 caractères.</p></div></div><form className={styles.passwordForm} onSubmit={changePassword}><input type="password" placeholder="Mot de passe actuel" value={currentPassword} onChange={(e)=>setCurrentPassword(e.target.value)} required/><input type="password" minLength={10} placeholder="Nouveau mot de passe" value={newPassword} onChange={(e)=>setNewPassword(e.target.value)} required/><button>Modifier le mot de passe</button></form></section>
    <section className={styles.card}><div className={styles.cardHead}><div><h2>Appareils connectés</h2><p>{data?.sessions.length??0} session(s) active(s)</p></div><button className={styles.outline} onClick={revokeOthers}>Déconnecter les autres</button></div><div className={styles.sessions}>{data?.sessions.map((s)=><div key={s.id}><span>◉</span><div><strong>{s.current?"Cet appareil":"Appareil connecté"}</strong><small>{s.userAgent??"Navigateur inconnu"}</small></div>{s.current&&<b>Actuel</b>}</div>)}</div></section>
    <section className={`${styles.card} ${styles.pro}`}><div><span className={styles.proBadge}>PRO</span><h2>Développez votre activité</h2><p>Boutique, statistiques avancées, crédits de mise en avant et outils professionnels.</p></div><a href="/boutique">Découvrir les offres Pro →</a></section>
  </section></main></div>;
}
