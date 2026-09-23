"use client";

import {useEffect,useState} from "react";
import {AdminIcon} from "../../../components/admin-icon";
import {ContentPolicyPanel} from "../moderation/content-policy-panel";
import styles from "../moderation/moderation.module.css";

type SafetyContext={id:string;body?:string|null;kind?:string;senderId:string;senderName?:string;createdAt:string};
type SafetyReport={id:string;reason:string;details?:string|null;status:string;createdAt:string;messageId:string;conversationId:string;body?:string|null;senderName:string;reporterName:string;context?:SafetyContext[]};
type SafetyBlock={id:string;createdAt:string;blockerName:string;blockedName:string;blockerId:string;blockedId:string};
const dateTime=(value:string)=>new Intl.DateTimeFormat("fr-FR",{dateStyle:"medium",timeStyle:"short"}).format(new Date(value));

export default function BlockedUsersClient(){
 const[reports,setReports]=useState<SafetyReport[]>([]);
 const[blocks,setBlocks]=useState<SafetyBlock[]>([]);
 const[loading,setLoading]=useState(true);
 const[error,setError]=useState("");
 async function load(){
  setLoading(true);setError("");
  try{
   const r=await fetch("/api/admin/moderation/messaging-safety",{credentials:"include",cache:"no-store"});
   if(r.status===401||r.status===403){location.href="/connexion";return}
   if(!r.ok)throw new Error("load");
   const p=await r.json();setReports(p.reports??[]);setBlocks(p.blocks??[]);
  }catch{setError("Les informations de sécurité utilisateurs n’ont pas pu être chargées.")}finally{setLoading(false)}
 }
 useEffect(()=>{void load()},[]);
 return <main className={styles.page}>
  <section className={styles.shell}>
   <div className={styles.hero}><div><span className={styles.eyebrow}>Trust & Safety</span><h1>Utilisateurs bloqués</h1><p>Gérez les comptes bloqués par le filtre anti-spam, les blocages manuels, les termes interdits et les incidents de messagerie.</p></div><button type="button" className={styles.refresh} onClick={()=>void load()} disabled={loading}><AdminIcon name="clock"/>Actualiser</button></div>
   {error&&<div className={styles.errorState}>{error}<button type="button" onClick={()=>void load()}>Réessayer</button></div>}
   <ContentPolicyPanel/>
   <section className={styles.safetyGrid}>
    <article className={styles.safetyCard}><div className={styles.queueHead}><div><h2>Signalements messagerie</h2><p>Messages signalés avec leur contexte de conversation.</p></div><span className={styles.safetyCount}>{reports.length}</span></div><div className={styles.safetyList}>{loading?<p className={styles.safetyEmpty}>Chargement…</p>:reports.length===0?<p className={styles.safetyEmpty}>Aucun signalement récent.</p>:reports.slice(0,20).map(r=><div key={r.id}><div><strong>{r.reason}</strong><span>{r.senderName} · signalé par {r.reporterName}</span></div><p>{r.body||r.details||"Message sans texte"}</p>{r.details&&<small style={{display:"block",marginBottom:7}}>Détail : {r.details}</small>}<details><summary>Voir le contexte ({r.context?.length??0} messages)</summary><div style={{display:"grid",gap:6,marginTop:8}}>{(r.context??[]).map(m=><div key={m.id} style={{padding:"7px 8px",borderRadius:8,background:m.id===r.messageId?"#fff0f1":"#f7f6fb"}}><b style={{fontSize:11}}>{m.senderName??"Membre"}</b><span style={{display:"block",fontSize:11,marginTop:2}}>{m.body||`[${m.kind??"message"}]`}</span></div>)}</div></details></div>)}</div></article>
    <article className={styles.safetyCard}><div className={styles.queueHead}><div><h2>Blocages entre utilisateurs</h2><p>Blocages actifs déclarés dans la messagerie.</p></div><span className={styles.safetyCount}>{blocks.length}</span></div><div className={styles.safetyList}>{loading?<p className={styles.safetyEmpty}>Chargement…</p>:blocks.length===0?<p className={styles.safetyEmpty}>Aucun blocage actif.</p>:blocks.slice(0,30).map(b=><div key={b.id}><div><strong>{b.blockerName}</strong><span>a bloqué {b.blockedName}</span></div><p>{dateTime(b.createdAt)}</p><a href={`/users/${b.blockedId}`}>Voir le profil bloqué</a></div>)}</div></article>
   </section>
  </section>
 </main>
}
