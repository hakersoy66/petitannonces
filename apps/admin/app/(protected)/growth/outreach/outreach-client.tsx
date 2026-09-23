"use client";
import {useEffect,useMemo,useState} from "react";

type Sector="automobile"|"immobilier"|"high-tech"|"occasion";
type ReviewStatus="PENDING"|"APPROVED"|"REJECTED";
type Lead={
 id:string;sector:Sector;companyName:string;email:string;website:string|null;city:string|null;
 sourceUrl:string|null;sourceLabel:string|null;legalBasis:string;status:string;reviewStatus:ReviewStatus;
 reviewedAt:string|null;reviewNote:string|null;sentCount:number;lastSentAt:string|null;unsubscribedAt:string|null;createdAt:string;
};
type SummaryRow={sector:Sector;total:number;ready:number;approved:number;sent:number;unsubscribed:number};
type SectorMeta={code:Sector;label:string;campaign:string;landing:string};
type Funnel={sent:number;delivered:number;opened:number;clicked:number;registered:number;trials:number;bounced:number;complained:number};
type SendRow={id:string;companyName:string;email:string;campaign:string;status:string;sentAt:string|null;deliveredAt:string|null;openedAt:string|null;clickedAt:string|null;lastEventAt:string|null;createdAt:string};
type Data={leads:Lead[];summary:SummaryRow[];sends:SendRow[];funnel:Funnel;emailConfigured:boolean;emailProvider:string;sectors:SectorMeta[]};

const sample=`sector;companyName;email;website;city;sourceUrl;sourceLabel\nautomobile;Garage Exemple;contact@garage-exemple.fr;https://garage-exemple.fr;Lyon;https://garage-exemple.fr/contact;Site web professionnel\nimmobilier;Agence Exemple;contact@agence-exemple.fr;https://agence-exemple.fr;Paris;https://agence-exemple.fr/contact;Site web professionnel`;
const qcLabel=(s:ReviewStatus)=>s==="APPROVED"?"Validé":s==="REJECTED"?"Rejeté":"En attente";
const pct=(value:number,total:number)=>total>0?`${Math.round(value/total*100)}%`:"—";
const sendStatusLabel=(s:string)=>({SENT:"Envoyé",ACCEPTED:"Accepté",DELIVERED:"Livré",OPENED:"Ouvert",CLICKED:"Cliqué",DELAYED:"Retardé",BOUNCED:"Bounce",COMPLAINED:"Plainte",FAILED:"Échec",SUPPRESSED:"Supprimé"} as Record<string,string>)[s]??s;

export default function OutreachClient(){
 const[data,setData]=useState<Data|null>(null);
 const[sector,setSector]=useState<""|Sector>("");
 const[q,setQ]=useState("");
 const[csv,setCsv]=useState("");
 const[busy,setBusy]=useState(false);
 const[msg,setMsg]=useState("");

 async function load(){
  const p=new URLSearchParams();if(sector)p.set("sector",sector);if(q.trim())p.set("q",q.trim());
  const r=await fetch(`/api/admin/outreach?${p}`,{credentials:"include",cache:"no-store"});
  if(r.ok)setData(await r.json());
 }
 useEffect(()=>{void load()},[]);

 const totals=useMemo(()=>({
  total:data?.summary.reduce((n,x)=>n+Number(x.total),0)??0,
  ready:data?.summary.reduce((n,x)=>n+Number(x.ready),0)??0,
  approved:data?.summary.reduce((n,x)=>n+Number(x.approved),0)??0,
  sent:data?.summary.reduce((n,x)=>n+Number(x.sent),0)??0,
  optout:data?.summary.reduce((n,x)=>n+Number(x.unsubscribed),0)??0,
 }),[data]);
 const funnel=data?.funnel??{sent:0,delivered:0,opened:0,clicked:0,registered:0,trials:0,bounced:0,complained:0};

 async function importCsv(){
  if(!csv.trim())return;setBusy(true);setMsg("");
  const r=await fetch("/api/admin/outreach/import",{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({csv})});
  const p=await r.json().catch(()=>({}));setBusy(false);
  if(r.ok){setMsg(`${p.imported} nouveau(x), ${p.updated} mis à jour, ${p.suppressed} bloqué(s), ${p.invalid} invalide(s). Les nouveaux prospects restent en attente de QC.`);setCsv("");await load()}else setMsg("Import impossible.");
 }
 async function review(id:string,status:"APPROVED"|"REJECTED"){
  setBusy(true);setMsg("");
  const r=await fetch(`/api/admin/outreach/leads/${id}/review`,{method:"PATCH",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({status,note:status==="APPROVED"?"Source officielle, e-mail professionnel public et activité sectorielle vérifiés.":"Rejeté lors du contrôle qualité."})});
  setBusy(false);setMsg(r.ok?(status==="APPROVED"?"Prospect validé QC.":"Prospect rejeté."):"Mise à jour QC impossible.");await load();
 }
 async function sendOne(id:string){
  if(!window.confirm("Envoyer maintenant cet e-mail de prospection professionnelle ?"))return;
  setBusy(true);setMsg("");const r=await fetch(`/api/admin/outreach/leads/${id}/send`,{method:"POST",credentials:"include"});const p=await r.json().catch(()=>({}));setBusy(false);
  setMsg(r.ok?"E-mail envoyé.":p.error==="lead_suppressed"?"Adresse dans la liste d’opposition.":p.error==="lead_already_contacted"?"Ce prospect a déjà été contacté.":p.error==="lead_not_reviewed"?"Le prospect doit d’abord être validé QC.":"Envoi impossible.");await load();
 }
 async function sendBatch(){
  if(!sector){setMsg("Choisissez d’abord un secteur.");return}
  if(!window.confirm(`Envoyer jusqu’à 10 e-mails au secteur ${sector} ? Seuls les prospects validés QC et jamais contactés seront sélectionnés.`))return;
  setBusy(true);const r=await fetch("/api/admin/outreach/send-batch",{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({sector,limit:10})});const p=await r.json().catch(()=>({}));setBusy(false);setMsg(r.ok?`${p.sent} e-mail(s) envoyé(s), ${p.failed} échec(s).`:"Envoi batch impossible.");await load();
 }

 return <>
  <div className="admin-page-head"><div><p>Growth · Acquisition</p><h1>Prospection B2B</h1><span className="subtitle">Prospects professionnels, contrôle qualité, opposition CNIL et campagnes sectorielles avec attribution UTM.</span></div><div style={{display:"flex",gap:8,flexWrap:"wrap"}}><a className="admin-btn" href="/growth">← Croissance</a><button className="admin-btn" onClick={()=>void load()}>Actualiser</button></div></div>
  {msg&&<div className="admin-flash ok">{msg}</div>}
  {!data?.emailConfigured&&<div className="admin-flash err">Aucun fournisseur e-mail n’est configuré : les leads peuvent être importés et contrôlés, mais aucun e-mail ne sera envoyé.</div>}

  <div className="admin-grid admin-kpis">
   <article className="admin-card admin-kpi"><small>Prospects</small><strong>{totals.total}</strong><p>Toutes sources</p></article>
   <article className="admin-card admin-kpi"><small>À contrôler</small><strong>{Math.max(0,totals.ready-totals.approved)}</strong><p>QC en attente / rejeté</p></article>
   <article className="admin-card admin-kpi"><small>Validés QC</small><strong>{totals.approved}</strong><p>Éligibles à l’envoi</p></article>
   <article className="admin-card admin-kpi"><small>Contactés</small><strong>{totals.sent}</strong><p>1 envoi maximum</p></article>
   <article className="admin-card admin-kpi"><small>Oppositions</small><strong>{totals.optout}</strong><p>Exclus durablement</p></article>
  </div>

  <section className="admin-card admin-section" style={{marginTop:16}}><div className="admin-section-head"><div><h2>Entonnoir de conversion</h2><p>{sector?`Résultats du secteur ${data?.sectors.find(s=>s.code===sector)?.label??sector}.`:"Résultats de toutes les campagnes B2B."} La livraison, les inscriptions et les essais sont suivis. Les indicateurs d’ouverture/clic restent disponibles pour les campagnes disposant d’un consentement de suivi approprié ; aucun pixel de suivi individuel n’est forcé sur cette prospection B2B.</p></div></div><div className="admin-grid admin-kpis"><article className="admin-card admin-kpi"><small>Envoyés</small><strong>{funnel.sent}</strong><p>100% de la base envoyée</p></article><article className="admin-card admin-kpi"><small>Livrés</small><strong>{funnel.delivered}</strong><p>{pct(funnel.delivered,funnel.sent)} des envois</p></article><article className="admin-card admin-kpi"><small>Ouverts</small><strong>{funnel.opened}</strong><p>{pct(funnel.opened,funnel.delivered)} des livrés</p></article><article className="admin-card admin-kpi"><small>Cliqués</small><strong>{funnel.clicked}</strong><p>{pct(funnel.clicked,funnel.delivered)} des livrés</p></article><article className="admin-card admin-kpi"><small>Inscriptions Pro</small><strong>{funnel.registered}</strong><p>{pct(funnel.registered,funnel.sent)} des envois</p></article><article className="admin-card admin-kpi"><small>Essais Pro</small><strong>{funnel.trials}</strong><p>{pct(funnel.trials,funnel.sent)} des envois</p></article></div><p style={{fontSize:12,color:"#747487",marginTop:12}}>Qualité d’envoi : {funnel.bounced} bounce(s) · {funnel.complained} plainte(s). Les bounces, plaintes et suppressions sont automatiquement exclus des prochains envois.</p></section>

  <section className="admin-card admin-section" style={{marginTop:16}}><div className="admin-section-head"><div><h2>Importer une liste professionnelle</h2><p>CSV uniquement. Conservez l’URL/source publique et ciblez seulement des contacts dont l’activité correspond à l’offre. Tout import doit ensuite être validé QC.</p></div></div><textarea className="admin-input" style={{minHeight:150,width:"100%"}} value={csv} onChange={e=>setCsv(e.target.value)} placeholder={sample}/><div style={{display:"flex",gap:8,marginTop:10,flexWrap:"wrap"}}><button className="admin-btn primary" disabled={busy||!csv.trim()} onClick={()=>void importCsv()}>{busy?"Traitement…":"Importer le CSV"}</button><button className="admin-btn" onClick={()=>setCsv(sample)}>Charger un exemple</button></div><p style={{fontSize:12,color:"#747487",marginTop:10}}>Colonnes : sector, companyName, email, website, city, sourceUrl, sourceLabel. Secteurs : automobile, immobilier, high-tech, occasion.</p></section>

  <section className="admin-card admin-section" style={{marginTop:16}}><div className="admin-section-head"><div><h2>Prospects</h2><p>Aucun envoi automatique. Un prospect doit être validé QC avant tout envoi; les oppositions restent bloquées même après réimport.</p></div><div style={{display:"flex",gap:8,flexWrap:"wrap"}}><select className="admin-select" value={sector} onChange={e=>setSector(e.target.value as ""|Sector)}><option value="">Tous les secteurs</option>{data?.sectors.map(s=><option key={s.code} value={s.code}>{s.label}</option>)}</select><input className="admin-input" value={q} onChange={e=>setQ(e.target.value)} placeholder="Entreprise, e-mail, ville"/><button className="admin-btn" onClick={()=>void load()}>Filtrer</button><button className="admin-btn primary" disabled={busy||!sector||!data?.emailConfigured} onClick={()=>void sendBatch()}>Envoyer 10 validés max.</button></div></div>
   <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Entreprise</th><th>Secteur</th><th>Source</th><th>QC</th><th>Statut</th><th>Dernier envoi</th><th>Actions</th></tr></thead><tbody>
    {(data?.leads??[]).map(l=><tr key={l.id}><td><strong>{l.companyName}</strong><small style={{display:"block"}}>{l.email}{l.city?` · ${l.city}`:""}</small></td><td>{data?.sectors.find(s=>s.code===l.sector)?.label??l.sector}</td><td>{l.sourceUrl?<a href={l.sourceUrl} target="_blank" rel="noreferrer">{l.sourceLabel||"Source publique"}</a>:l.sourceLabel||"—"}</td><td><span className={`admin-badge ${l.reviewStatus==="APPROVED"?"green":l.reviewStatus==="REJECTED"?"red":"orange"}`}>{qcLabel(l.reviewStatus)}</span>{l.reviewedAt&&<small style={{display:"block"}}>{new Date(l.reviewedAt).toLocaleDateString("fr-FR")}</small>}</td><td><span className={`admin-badge ${l.status==="READY"?"orange":l.status==="SENT"?"green":"red"}`}>{l.status}</span></td><td>{l.lastSentAt?new Date(l.lastSentAt).toLocaleString("fr-FR"):"—"}</td><td><div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{l.status==="READY"&&l.reviewStatus!=="APPROVED"&&<button className="admin-btn" disabled={busy} onClick={()=>void review(l.id,"APPROVED")}>Valider QC</button>}{l.status==="READY"&&l.reviewStatus!=="REJECTED"&&<button className="admin-btn" disabled={busy} onClick={()=>void review(l.id,"REJECTED")}>Rejeter</button>}{l.status==="READY"&&l.reviewStatus==="APPROVED"&&<button className="admin-btn primary" disabled={busy||!data?.emailConfigured} onClick={()=>void sendOne(l.id)}>Envoyer</button>}</div></td></tr>)}
    {data&&!data.leads.length&&<tr><td colSpan={7}><div className="admin-empty">Aucun prospect dans ce filtre.</div></td></tr>}
   </tbody></table></div>
  </section>

  <section className="admin-card admin-section" style={{marginTop:16}}><div className="admin-section-head"><div><h2>Derniers envois</h2><p>Les statuts détaillés de livraison sont disponibles lorsqu’un fournisseur avec webhook les remonte. Hostinger SMTP confirme principalement l’acceptation de l’envoi.</p></div></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Entreprise</th><th>Campagne</th><th>Statut livraison</th><th>Date</th></tr></thead><tbody>{(data?.sends??[]).map(s=><tr key={s.id}><td><strong>{s.companyName}</strong><small style={{display:"block"}}>{s.email}</small></td><td>{s.campaign}</td><td><span className={`admin-badge ${s.status==="DELIVERED"||s.status==="OPENED"||s.status==="CLICKED"?"green":s.status==="BOUNCED"||s.status==="COMPLAINED"||s.status==="FAILED"||s.status==="SUPPRESSED"?"red":"orange"}`}>{sendStatusLabel(s.status)}</span>{s.openedAt&&<small style={{display:"block"}}>Ouvert {new Date(s.openedAt).toLocaleString("fr-FR")}</small>}{s.clickedAt&&<small style={{display:"block"}}>Cliqué {new Date(s.clickedAt).toLocaleString("fr-FR")}</small>}</td><td>{s.sentAt?new Date(s.sentAt).toLocaleString("fr-FR"):new Date(s.createdAt).toLocaleString("fr-FR")}</td></tr>)}{data&&!data.sends.length&&<tr><td colSpan={4}><div className="admin-empty">Aucun envoi enregistré.</div></td></tr>}</tbody></table></div></section>

  <section className="admin-card admin-section" style={{marginTop:16}}><div className="admin-section-head"><div><h2>Campagnes prêtes</h2><p>Chaque secteur utilise sa landing page et son UTM dédié.</p></div></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Secteur</th><th>Campagne</th><th>Landing</th></tr></thead><tbody>{data?.sectors.map(s=><tr key={s.code}><td><strong>{s.label}</strong></td><td>{s.campaign}</td><td><a href={s.landing} target="_blank">{s.landing}</a></td></tr>)}</tbody></table></div></section>
 </>;
}