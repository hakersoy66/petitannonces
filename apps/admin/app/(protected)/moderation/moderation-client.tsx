"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./moderation.module.css";
import { AdminIcon } from "../../../components/admin-icon";

type QueueItem={
  caseId:string;caseStatus:string;priority:number;riskScore:number;submittedAt:string;
  listing:{
    id:string;slug:string|null;title:string|null;description:string|null;priceMinor:number|null;currency:string;
    city:string|null;postalCode:string|null;createdAt:string;updatedAt:string;coverUrl:string|null;
    category:{name:string;slug:string;domain:string};
    seller:{id:string;email:string;kind:string;name:string;memberSince:string;emailVerified:boolean;businessVerified:boolean;stats?:{total:number;published:number;pending:number;suspended:number;sold:number;approved:number;rejected:number}};
    activeReports:number;importSource?:{sourceType:string;sourceUrl:string|null;createdAt:string}|null;promotions?:Array<{code:string;type:string;name:string;endsAt:string|null}>;
  }
};
type Detail={
 id:string;slug:string|null;title:string|null;description:string|null;priceMinor:number|null;currency:string;
 city:string|null;postalCode:string|null;region:string|null;latitude:number|null;longitude:number|null;
 category:{name:string;slug:string;domain:string};attributes:Array<{label:string;key:string;unit:string|null;value:unknown}>;
 vehicle:Record<string,unknown>|null;property:Record<string,unknown>|null;energy:Record<string,unknown>|null;
 media:Array<{id:string;url:string;altText:string|null;isCover:boolean}>;reports:Array<Record<string,unknown>>;
 seller:{id:string;email:string;kind:string;name:string;memberSince:string;emailVerified:boolean;businessVerified:boolean;stats?:{total:number;published:number;pending:number;suspended:number;sold:number;approved:number;rejected:number}};
};

type QueueReply={listings:QueueItem[];summary:{pending:number;highRisk:number}};
const rejectReasons=[
 ["INCOMPLETE_INFORMATION","Informations incomplètes ou incohérentes"],
 ["MISLEADING_CONTENT","Contenu trompeur ou ambigu"],
 ["INSUFFICIENT_PHOTOS","Photos insuffisantes ou non conformes"],
 ["PROHIBITED_CONTENT","Produit ou contenu non autorisé"],
 ["DUPLICATE_LISTING","Annonce en double"],
 ["OTHER","Autre motif"],
] as const;
const rejectTemplates:Record<string,string>={
 INCOMPLETE_INFORMATION:"Certaines informations de l’annonce sont incomplètes ou incohérentes. Merci de les corriger avant de soumettre à nouveau l’annonce.",
 MISLEADING_CONTENT:"Le contenu de l’annonce peut prêter à confusion. Merci de reformuler les informations afin qu’elles décrivent clairement et fidèlement le bien ou le service proposé.",
 INSUFFICIENT_PHOTOS:"Les photos fournies ne permettent pas de vérifier correctement l’annonce. Merci d’ajouter des photos nettes et représentatives du bien proposé.",
 PROHIBITED_CONTENT:"Cette annonce contient un produit, un service ou un contenu qui ne peut pas être publié selon les règles de Petit Annonces.",
 DUPLICATE_LISTING:"Une annonce similaire existe déjà sur votre compte. Merci de conserver une seule annonce active pour le même bien ou service.",
 OTHER:"Merci de corriger les éléments indiqués avant de soumettre à nouveau votre annonce.",
};

function money(minor:number|null,currency="EUR"){
 if(minor==null)return "Prix non renseigné";
 return new Intl.NumberFormat("fr-FR",{style:"currency",currency,maximumFractionDigits:2}).format(minor/100);
}
function dateTime(value:string){return new Intl.DateTimeFormat("fr-FR",{dateStyle:"medium",timeStyle:"short"}).format(new Date(value))}
function riskLabel(score:number){return score>=80?"Critique":score>=55?"Élevé":score>=25?"Moyen":score>0?"Faible":"Non analysé"}
function readable(value:unknown){
 if(value==null||value==="")return "—";
 if(typeof value==="boolean")return value?"Oui":"Non";
 if(Array.isArray(value))return value.join(", ");
 if(typeof value==="object")return JSON.stringify(value);
 return String(value);
}

export default function ModerationClient(){
 const[items,setItems]=useState<QueueItem[]>([]),[summary,setSummary]=useState({pending:0,highRisk:0});
 const[loading,setLoading]=useState(true),[error,setError]=useState(""),[query,setQuery]=useState(""),[sourceFilter,setSourceFilter]=useState("ALL");
 const[selected,setSelected]=useState<QueueItem|null>(null),[detail,setDetail]=useState<Detail|null>(null),[detailLoading,setDetailLoading]=useState(false);
 const[actionBusy,setActionBusy]=useState(false),[rejecting,setRejecting]=useState(false),[reason,setReason]=useState("INCOMPLETE_INFORMATION"),[statement,setStatement]=useState("");
 const[notice,setNotice]=useState("");

 async function loadQueue(){
  setLoading(true);setError("");
  try{
   const r=await fetch("/api/admin/moderation/listings",{credentials:"include",cache:"no-store"});
   if(r.status===401||r.status===403){window.location.replace("/connexion");return}
   if(!r.ok)throw new Error("queue");
   const p=await r.json() as QueueReply;setItems(p.listings??[]);setSummary(p.summary??{pending:0,highRisk:0});
  }catch{setError("La file de modération n’a pas pu être chargée.")}finally{setLoading(false)}
 }
 useEffect(()=>{void loadQueue()},[]);

 const filtered=useMemo(()=>{
  const q=query.trim().toLocaleLowerCase("fr-FR");return items.filter(i=>{const sourceOk=sourceFilter==="ALL"?true:sourceFilter==="NATIVE"?!i.listing.importSource:i.listing.importSource?.sourceType===sourceFilter;if(!sourceOk)return false;if(!q)return true;return [i.listing.title,i.listing.category.name,i.listing.city,i.listing.postalCode,i.listing.seller.name,i.listing.seller.email,i.listing.importSource?.sourceType].filter(Boolean).join(" ").toLocaleLowerCase("fr-FR").includes(q)});
 },[items,query,sourceFilter]);

 async function examine(item:QueueItem){
  setSelected(item);setDetail(null);setRejecting(false);setStatement("");setDetailLoading(true);
  try{const r=await fetch(`/api/admin/moderation/listings/${encodeURIComponent(item.listing.id)}`,{credentials:"include",cache:"no-store"});if(!r.ok)throw 0;const p=await r.json();setDetail(p.listing as Detail)}catch{setNotice("Impossible de charger le détail de cette annonce.")}finally{setDetailLoading(false)}
 }
 function closeReview(){if(actionBusy)return;setSelected(null);setDetail(null);setRejecting(false);setStatement("")}

 async function approve(item:QueueItem){
  if(actionBusy)return;setActionBusy(true);setNotice("");
  try{
   const r=await fetch(`/api/admin/moderation/cases/${encodeURIComponent(item.caseId)}/decision`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({action:"NONE",reasonCode:"MANUAL_APPROVAL",statement:"Annonce vérifiée manuellement et approuvée pour publication."})});
   if(!r.ok)throw 0;
   setNotice(`« ${item.listing.title??"Annonce"} » a été publiée.`);setSelected(null);setDetail(null);await loadQueue();
  }catch{setNotice("L’annonce n’a pas pu être approuvée.")}finally{setActionBusy(false)}
 }
 async function reject(item:QueueItem){
  if(statement.trim().length<10){setNotice("Ajoutez une explication d’au moins 10 caractères pour le vendeur.");return}
  setActionBusy(true);setNotice("");
  try{
   const r=await fetch(`/api/admin/moderation/cases/${encodeURIComponent(item.caseId)}/decision`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({action:"HIDE_LISTING",reasonCode:reason,statement:statement.trim()})});
   if(!r.ok)throw 0;
   setNotice(`« ${item.listing.title??"Annonce"} » a été refusée.`);setSelected(null);setDetail(null);setRejecting(false);setStatement("");await loadQueue();
  }catch{setNotice("La décision de refus n’a pas pu être enregistrée.")}finally{setActionBusy(false)}
 }
 async function assess(item:QueueItem){
  setActionBusy(true);setNotice("");
  try{const r=await fetch(`/api/trust/assess/listings/${encodeURIComponent(item.listing.id)}`,{method:"POST",credentials:"include"});if(!r.ok)throw 0;const p=await r.json();setNotice(`Analyse terminée : risque ${String(p.risk?.level??"").toLowerCase()} (${p.risk?.score??0}/100).`);await loadQueue()}catch{setNotice("L’analyse de risque n’a pas pu être lancée.")}finally{setActionBusy(false)}
 }

 return <main className={styles.page}>
  <section className={styles.shell}>
   <div className={styles.hero}><div><span className={styles.eyebrow}>Trust & Safety</span><h1>Validation des annonces</h1><p>Contrôlez les annonces avant publication, vérifiez les informations importantes et prenez une décision traçable.</p></div><button type="button" className={styles.refresh} onClick={()=>void loadQueue()} disabled={loading}><AdminIcon name="clock"/>Actualiser</button></div>
   <section className={styles.stats}>
    <article><span>En attente</span><strong>{summary.pending}</strong><small>Annonces à examiner</small></article>
    <article><span>Risque élevé</span><strong>{summary.highRisk}</strong><small>Score ≥ 55/100</small></article>
    <article><span>Dans la vue</span><strong>{filtered.length}</strong><small>Après recherche</small></article>
   </section>
   {notice&&<div className={styles.notice}><span><AdminIcon name="check"/></span>{notice}<button type="button" onClick={()=>setNotice("")}>×</button></div>}

   <section className={styles.queueCard}>
    <div className={styles.queueHead}><div><h2>File de publication</h2><p>Les plus prioritaires apparaissent en premier.</p></div><select value={sourceFilter} onChange={e=>setSourceFilter(e.target.value)} aria-label="Filtrer par source"><option value="ALL">Toutes les sources</option><option value="NATIVE">Créées sur Petit Annonces</option><option value="FACEBOOK_MARKETPLACE">Facebook Marketplace</option><option value="LEBONCOIN">Leboncoin</option><option value="CSV">CSV</option><option value="JSON_FEED">API JSON</option><option value="XML_FEED">API XML</option><option value="LINK">Lien externe</option></select><label className={styles.search}><span><AdminIcon name="search"/></span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Titre, vendeur, ville, catégorie…"/></label></div>
    {loading?<div className={styles.state}>Chargement des annonces…</div>:error?<div className={styles.errorState}>{error}<button type="button" onClick={()=>void loadQueue()}>Réessayer</button></div>:filtered.length===0?<div className={styles.empty}><span><AdminIcon name="check"/></span><h3>Aucune annonce en attente</h3><p>La file de validation est à jour.</p></div>:<div className={styles.list}>{filtered.map(item=><article className={styles.row} key={item.caseId}>
      <div className={styles.cover}>{item.listing.coverUrl?<img src={item.listing.coverUrl} alt=""/>:<span>PA</span>}</div>
      <div className={styles.info}><div className={styles.titleLine}><h3>{item.listing.title??"Annonce sans titre"}</h3><span className={`${styles.risk} ${item.riskScore>=55?styles.riskHigh:item.riskScore>=25?styles.riskMid:styles.riskLow}`}>{riskLabel(item.riskScore)} · {item.riskScore}/100</span></div><strong className={styles.price}>{money(item.listing.priceMinor,item.listing.currency)}</strong>{Boolean(item.listing.promotions?.length)&&<div className={styles.promotionBadges}>{item.listing.promotions!.map(p=><span key={p.code}><AdminIcon name="growth"/>{p.name}</span>)}</div>}<div className={styles.meta}><span>{item.listing.category.name}</span><span>{[item.listing.postalCode,item.listing.city].filter(Boolean).join(" ")||"Localisation non renseignée"}</span>{item.listing.importSource&&<span title={item.listing.importSource.sourceUrl??undefined}>Import · {({FACEBOOK_MARKETPLACE:"Facebook Marketplace",LEBONCOIN:"Leboncoin",CSV:"CSV",JSON_FEED:"API JSON",XML_FEED:"API XML",LINK:"Lien externe"} as Record<string,string>)[item.listing.importSource.sourceType]??item.listing.importSource.sourceType}</span>}<span>{item.listing.activeReports} signalement{item.listing.activeReports===1?"":"s"}</span></div><div className={styles.seller}><span className={styles.avatar}>{item.listing.seller.name.slice(0,2).toUpperCase()}</span><div><b>{item.listing.seller.name}</b><small>{item.listing.seller.email}</small></div></div></div>
      <div className={styles.side}><small>Soumise le {dateTime(item.submittedAt)}</small><div className={styles.actions}><button type="button" className={styles.secondary} onClick={()=>void assess(item)} disabled={actionBusy}>Analyser</button><button type="button" className={styles.secondary} onClick={()=>void examine(item)}>Examiner</button><button type="button" className={styles.approve} onClick={()=>void approve(item)} disabled={actionBusy}><AdminIcon name="check"/>Publier</button></div></div>
    </article>)}</div>}
   </section>
  </section>
  {selected&&<div className={styles.overlay} onMouseDown={e=>{if(e.target===e.currentTarget)closeReview()}}><section className={styles.drawer}>
    <header className={styles.drawerHead}><div><span>Contrôle avant publication</span><h2>{selected.listing.title??"Annonce"}</h2></div><button type="button" onClick={closeReview}>×</button></header>
    {detailLoading?<div className={styles.drawerLoading}>Chargement du dossier…</div>:detail?<div className={styles.drawerBody}>
      <div className={styles.gallery}>{detail.media.length?detail.media.slice(0,8).map((m,i)=><img key={m.id} className={i===0?styles.mainPhoto:""} src={m.url} alt={m.altText??""}/>):<div className={styles.noPhoto}>Aucune photo disponible</div>}</div>
      <section className={styles.reviewGrid}><article><span>Prix</span><strong>{money(detail.priceMinor,detail.currency)}</strong></article><article><span>Catégorie</span><strong>{detail.category.name}</strong></article><article><span>Localisation</span><strong>{[detail.postalCode,detail.city].filter(Boolean).join(" ")||"—"}</strong></article><article><span>Vendeur</span><strong>{detail.seller.name}</strong></article></section>
      <section className={styles.block}><h3>Description</h3><p className={styles.description}>{detail.description||"Aucune description."}</p></section>
      {detail.attributes.length>0&&<section className={styles.block}><h3>Caractéristiques</h3><div className={styles.attributes}>{detail.attributes.map(a=><div key={a.key}><span>{a.label}</span><strong>{readable(a.value)}{a.unit?` ${a.unit}`:""}</strong></div>)}</div></section>}
      <section className={styles.block}><h3>Vendeur</h3><div className={styles.sellerReview}><div><b>{detail.seller.name}</b><span>{detail.seller.email}</span></div><div className={styles.badges}><span className={detail.seller.emailVerified?styles.good:styles.warn}>{detail.seller.emailVerified?"E-mail vérifié":"E-mail non vérifié"}</span>{detail.seller.kind==="PROFESSIONNEL"&&<span className={detail.seller.businessVerified?styles.good:styles.warn}>{detail.seller.businessVerified?"Pro vérifié":"Pro non vérifié"}</span>}</div></div>{detail.seller.stats&&<div className={styles.sellerStats}><div><span>Annonces</span><strong>{detail.seller.stats.total}</strong></div><div><span>Publiées</span><strong>{detail.seller.stats.published}</strong></div><div><span>Vendues</span><strong>{detail.seller.stats.sold}</strong></div><div><span>Validations</span><strong>{detail.seller.stats.approved}</strong></div><div><span>Refus</span><strong>{detail.seller.stats.rejected}</strong></div></div>}</section>
      {detail.reports.length>0&&<section className={styles.block}><h3>Signalements actifs</h3><div className={styles.reports}>{detail.reports.map((r,i)=><div key={String(r.id??i)}><b>{String(r.reason??"Signalement")}</b><span>{String(r.details??"Aucun détail")}</span></div>)}</div></section>}
      {rejecting&&<section className={styles.rejectBox}><h3>Refuser l’annonce</h3><label>Motif<select value={reason} onChange={e=>{const next=e.target.value;setReason(next);setStatement(rejectTemplates[next]??"")}}>{rejectReasons.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><label>Explication communiquée au vendeur<textarea rows={4} value={statement} onChange={e=>setStatement(e.target.value)} placeholder="Expliquez clairement ce qui doit être corrigé…"/></label><div><button type="button" className={styles.cancelReject} onClick={()=>setRejecting(false)}>Annuler</button><button type="button" className={styles.confirmReject} disabled={actionBusy||statement.trim().length<10} onClick={()=>void reject(selected)}>Confirmer le refus</button></div></section>}
    </div>:<div className={styles.drawerLoading}>Détail indisponible.</div>}
    <footer className={styles.drawerFoot}>{!rejecting&&<><button type="button" className={styles.reject} onClick={()=>{setRejecting(true);setStatement(rejectTemplates[reason]??"")}}>Refuser</button><button type="button" className={styles.approveLarge} disabled={actionBusy} onClick={()=>void approve(selected)}>{actionBusy?"Traitement…":<><AdminIcon name="check"/>Publier l’annonce</>}</button></>}</footer>
  </section></div>}
 </main>
}


[executed on device: mail.petitannonces.fr (b9fdfe5f-3df4-4e4a-a34e-5aa72c2ab64d)]