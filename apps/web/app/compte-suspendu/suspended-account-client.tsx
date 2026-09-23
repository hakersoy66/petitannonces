"use client";

import { useEffect, useState } from "react";
import { AppIcon } from "../../components/app-icon";
import styles from "./page.module.css";

const api=()=> (process.env.NEXT_PUBLIC_API_URL??"/api").replace(/\/$/,"");
type AccessState={blocked:boolean;status?:string;reasons?:string[];createdAt?:string;reviewPending?:boolean};
const reasonCopy:Record<string,string>={FORBIDDEN_TERM:"des termes interdits",CONTACT_EMAIL:"une adresse e-mail dans l’annonce",CONTACT_PHONE:"un numéro de téléphone dans l’annonce"};

export function SuspendedAccountClient(){
 const[state,setState]=useState<AccessState|null>(null),[checking,setChecking]=useState(true),[message,setMessage]=useState("");
 async function check(){setChecking(true);setMessage("");try{const r=await fetch(`${api()}/security/access-state`,{credentials:"include",cache:"no-store"});if(!r.ok)throw 0;const p=await r.json() as AccessState;setState(p);if(!p.blocked){setMessage("La restriction a été levée. Redirection vers Petit Annonces…");window.setTimeout(()=>window.location.replace("/"),700)}}catch{setMessage("Impossible de vérifier le statut pour le moment.")}finally{setChecking(false)}}
 useEffect(()=>{void check()},[]);
 const reasons=(state?.reasons??[]).map(code=>reasonCopy[code]??"un contenu contraire aux règles");
 return <main className={styles.page}>
  <section className={styles.card}>
   <div className={styles.logo}><span>PA</span><strong>Petit Annonces</strong></div>
   <div className={styles.alertIcon}><AppIcon name="shield"/></div>
   <span className={styles.kicker}>Sécurité & modération</span>
   <h1>Votre compte est temporairement suspendu</h1>
   <p className={styles.lead}>Une tentative de publication a déclenché nos protections anti-spam. L’annonce concernée n’a pas été publiée et n’a pas été conservée comme brouillon.</p>
   <div className={styles.reasonBox}><strong>Pourquoi cette restriction ?</strong><p>{reasons.length?`Notre système a détecté ${reasons.join(", ")}.`:"Notre système a détecté un contenu interdit ou des coordonnées directes dans une annonce."}</p><small>Pour protéger les utilisateurs, les adresses e-mail, numéros de téléphone et contenus interdits ne sont pas acceptés dans le titre ou la description d’une annonce.</small></div>
   <div className={styles.steps}>
    <div><span><AppIcon name="circle-check"/></span><p><b>Annonce bloquée</b><small>Elle n’est visible par aucun utilisateur.</small></p></div>
    <div><span><AppIcon name="shield"/></span><p><b>Compte et connexion placés en contrôle</b><small>Les actions du compte restent bloquées pendant la vérification.</small></p></div>
    <div><span><AppIcon name="clock"/></span><p><b>Vérification manuelle</b><small>Seul un modérateur peut lever cette restriction.</small></p></div>
   </div>
   <div className={styles.status}><span className={state?.status==="REJECTED"?styles.blocked:styles.pending}/><div><strong>{state?.status==="REJECTED"?"Blocage maintenu par la modération":"Vérification par un modérateur en attente"}</strong><small>La restriction reste active tant qu’elle n’a pas été approuvée manuellement.</small></div></div>
   {message&&<div className={styles.message}>{message}</div>}
   <button className={styles.checkButton} type="button" onClick={()=>void check()} disabled={checking}><AppIcon name="clock"/>{checking?"Vérification…":"Vérifier le statut"}</button>
   <p className={styles.help}>Si vous pensez qu’il s’agit d’une erreur, contactez l’assistance Petit Annonces en indiquant l’adresse e-mail de votre compte. N’essayez pas de recréer un compte depuis la même connexion pendant la vérification.</p>
  </section>
 </main>
}
