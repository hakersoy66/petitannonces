'use client';
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';

type Partner = {
 id:string; platform:'instagram'|'tiktok'|'youtube'|'facebook'; handle:string; email:string|null;
 followers:number;averageViews:number;franceAudiencePercent:number|null;suggestedFeeMinor:number;
 status:'PROSPECT'|'NEGOTIATING'|'PARTNER'|'ARCHIVED';notes:string|null;createdAt:string;
};
type Campaign = {
 id:string;partnerId:string;partnerHandle:string;platform:string;title:string;slug:string;
 status:'DRAFT'|'NEGOTIATING'|'SCHEDULED'|'ACTIVE'|'COMPLETED'|'CANCELLED';
 deliverables:string|null;contentUrl:string|null;proofUrl:string|null;feeMinor:number;
 paymentStatus:'UNPAID'|'PENDING'|'PAID';clickCount:number;reportedViews:number;reportedLikes:number;
 visitorsConsented:number;registrationsEstimated:number;publishedListingsEstimated:number;
 notes:string|null;publishedAt:string|null;
};
type Data={partners:Partner[];campaigns:Campaign[];summary:{partners:number;campaigns:number;budgetMinor:number;clicksRaw:number;visitorsConsented:number;registrationsEstimated:number;publishedListingsEstimated:number};definitions:Record<string,string>};
const button:CSSProperties={padding:'9px 14px',border:'1px solid #cbd5e1',borderRadius:10,background:'#fff',color:'#1e293b',fontWeight:700,cursor:'pointer'};
const primary:CSSProperties={...button,background:'#5b4cf0',color:'#fff',borderColor:'#5b4cf0'};
const input:CSSProperties={width:'100%',padding:'10px 12px',border:'1px solid #cbd5e1',borderRadius:9,background:'#fff',color:'#111827',fontSize:14};
const label:CSSProperties={display:'grid',gap:5,fontSize:12,fontWeight:700,color:'#475569'};
const grid:CSSProperties={display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:12};
const money=(n:number)=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format((n||0)/100);
const number=(n:number)=>Number(n||0).toLocaleString('fr-FR');
const makeSlug=(text:string)=>text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,47).replace(/-$/,'');
async function api<T>(path:string,body?:unknown,method='GET'):Promise<T>{
 const r=await fetch(path,{method,credentials:'include',cache:'no-store',headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
 const json=await r.json().catch(()=>({})) as T&{error?:string};if(!r.ok)throw new Error(json.error||`Erreur HTTP ${r.status}`);return json;
}
const statusLabels:Record<string,string>={PROSPECT:'À contacter',NEGOTIATING:'En négociation',PARTNER:'Partenaire',ARCHIVED:'Archivé',DRAFT:'Brouillon',SCHEDULED:'Programmé',ACTIVE:'En cours',COMPLETED:'Terminé',CANCELLED:'Annulé',UNPAID:'Non payé',PENDING:'À payer',PAID:'Payé'};
const partnerStatuses=['PROSPECT','NEGOTIATING','PARTNER','ARCHIVED'] as const;
const campaignStatuses=['DRAFT','NEGOTIATING','SCHEDULED','ACTIVE','COMPLETED','CANCELLED'] as const;
const paymentStatuses=['UNPAID','PENDING','PAID'] as const;
export default function InfluenceursClient(){
 const [data,setData]=useState<Data|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [chosen,setChosen]=useState(''),[newPartner,setNewPartner]=useState(false),[newCampaign,setNewCampaign]=useState(false);
 const [pForm,setPForm]=useState({platform:'instagram',handle:'',email:'',followers:0,averageViews:0,franceAudiencePercent:'',suggestedFee:0,notes:''});
 const [cForm,setCForm]=useState({title:'',slug:'',deliverables:'1 Reel + 1 Story',fee:0,notes:''});
 const [editing,setEditing]=useState<Campaign|null>(null),[editingFee,setEditingFee]=useState('0');
 const refresh=useCallback(async()=>{setError('');try{setData(await api<Data>('/api/admin/influencers'));}catch(e){setError(e instanceof Error?e.message:'Données indisponibles');}},[]);
 useEffect(()=>{void refresh();},[refresh]);
 useEffect(()=>{if(data?.partners.length&&!data.partners.some(p=>p.id===chosen))setChosen(data.partners[0]!.id);},[data,chosen]);
 const partner=useMemo(()=>data?.partners.find(p=>p.id===chosen),[data,chosen]);
 const campaigns=useMemo(()=>data?.campaigns.filter(c=>c.partnerId===chosen)??[],[data,chosen]);
 async function run(task:()=>Promise<void>){setBusy(true);setError('');setMessage('');try{await task();await refresh();}catch(e){setError(e instanceof Error?e.message:'Échec de l’enregistrement');}finally{setBusy(false)}}
 async function addPartner(e:FormEvent){e.preventDefault();await run(async()=>{await api('/api/admin/influencers',{platform:pForm.platform,handle:pForm.handle,email:pForm.email,followers:Number(pForm.followers),averageViews:Number(pForm.averageViews),franceAudiencePercent:pForm.franceAudiencePercent===''?null:Number(pForm.franceAudiencePercent),suggestedFeeMinor:Math.round(Number(pForm.suggestedFee)*100),notes:pForm.notes},'POST');setNewPartner(false);setPForm({platform:'instagram',handle:'',email:'',followers:0,averageViews:0,franceAudiencePercent:'',suggestedFee:0,notes:''});setMessage('Influenceur ajouté.');});}
 async function addCampaign(e:FormEvent){e.preventDefault();if(!chosen)return;await run(async()=>{await api(`/api/admin/influencers/${encodeURIComponent(chosen)}/campaigns`,{title:cForm.title,slug:cForm.slug,deliverables:cForm.deliverables,feeMinor:Math.round(Number(cForm.fee)*100),notes:cForm.notes},'POST');setNewCampaign(false);setCForm({title:'',slug:'',deliverables:'1 Reel + 1 Story',fee:0,notes:''});setMessage('Campagne créée en brouillon. Activez-la lorsque le lien peut être diffusé.');});}
 async function updatePartner(status:Partner['status']){if(!partner)return;await run(async()=>{await api(`/api/admin/influencers/${partner.id}`,{status},'PATCH');setMessage('Statut du partenaire mis à jour.');});}
 async function saveCampaign(e:FormEvent){e.preventDefault();if(!editing)return;await run(async()=>{await api(`/api/admin/influencer-campaigns/${editing.id}`,{status:editing.status,deliverables:editing.deliverables||'',contentUrl:editing.contentUrl||'',proofUrl:editing.proofUrl||'',reportedViews:Number(editing.reportedViews),reportedLikes:Number(editing.reportedLikes),...(Math.round(Number(editingFee)*100)!==editing.feeMinor?{feeMinor:Math.round(Number(editingFee)*100)}:{}),notes:editing.notes||''},'PATCH');setEditing(null);setMessage('Campagne mise à jour. Les paiements passent par le processus de validation ci-dessus.');});}
 const k=data?.summary;
 return <div className="admin-analytics-page" style={{display:'grid',gap:18}}>
  <div className="admin-page-head"><div><p>Marketing</p><h1>Influenceurs & Partenariats</h1><span className="subtitle">Contacts, accords publicitaires, liens de campagne et mesure des résultats</span></div><div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button style={button} disabled={busy} onClick={()=>void refresh()}>Actualiser</button><button style={primary} onClick={()=>setNewPartner(x=>!x)}>+ Influenceur</button></div></div>
  {error&&<div className="admin-flash err" role="alert">{error}</div>}{message&&<div className="admin-flash" role="status">{message}</div>}
  <section style={{...grid,gridTemplateColumns:'repeat(auto-fit,minmax(145px,1fr))'}}>
   {[['Influenceurs',k?.partners],['Campagnes',k?.campaigns],['Budget convenu',money(k?.budgetMinor??0)],['Clics bruts',k?.clicksRaw],['Visiteurs consentis',k?.visitorsConsented],['Inscriptions estimées',k?.registrationsEstimated],['Annonces estimées',k?.publishedListingsEstimated]].map(([name,value])=><article key={String(name)} className="admin-card admin-kpi" style={{padding:16}}><small>{name}</small><strong>{typeof value==='number'?number(value):value??'…'}</strong></article>)}
  </section>
  {newPartner&&<section className="admin-card admin-section"><h2>Ajouter un influenceur</h2><form onSubmit={addPartner} style={{display:'grid',gap:12}}><div style={grid}>
   <label style={label}>Réseau<select style={input} value={pForm.platform} onChange={e=>setPForm({...pForm,platform:e.target.value})}>{['instagram','tiktok','youtube','facebook'].map(x=><option key={x} value={x}>{x}</option>)}</select></label>
   <label style={label}>Compte (@pseudo)<input style={input} required minLength={2} value={pForm.handle} onChange={e=>setPForm({...pForm,handle:e.target.value})}/></label>
   <label style={label}>E-mail<input style={input} type="email" value={pForm.email} onChange={e=>setPForm({...pForm,email:e.target.value})}/></label>
   <label style={label}>Abonnés<input style={input} type="number" min="0" value={pForm.followers} onChange={e=>setPForm({...pForm,followers:Number(e.target.value)})}/></label>
   <label style={label}>Vues moyennes<input style={input} type="number" min="0" value={pForm.averageViews} onChange={e=>setPForm({...pForm,averageViews:Number(e.target.value)})}/></label>
   <label style={label}>Audience en France (%)<input style={input} type="number" min="0" max="100" step="0.1" value={pForm.franceAudiencePercent} onChange={e=>setPForm({...pForm,franceAudiencePercent:e.target.value})}/></label>
   <label style={label}>Tarif annoncé (€)<input style={input} type="number" min="0" step="0.01" value={pForm.suggestedFee} onChange={e=>setPForm({...pForm,suggestedFee:Number(e.target.value)})}/></label>
  </div><label style={label}>Notes<textarea style={input} rows={2} maxLength={4000} value={pForm.notes} onChange={e=>setPForm({...pForm,notes:e.target.value})}/></label><div><button style={primary} disabled={busy}>Enregistrer le profil</button></div></form></section>}
  <section className="admin-card admin-section"><div className="admin-section-head"><div><h2>Influenceurs</h2><p>Sélectionnez un profil pour voir ses campagnes et son suivi.</p></div></div>
   <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:16}}>{(data?.partners??[]).map(p=><button type="button" onClick={()=>{setChosen(p.id);setEditing(null)}} key={p.id} style={{...button,background:chosen===p.id?'#eeeaff':'#fff',borderColor:chosen===p.id?'#5b4cf0':'#cbd5e1'}}><strong>@{p.handle}</strong> · {p.platform}</button>)}{data&&data.partners.length===0&&<p>Aucun influenceur. Cliquez sur « + Influenceur » pour commencer.</p>}</div>
   {partner&&<div style={{display:'grid',gap:12}}><div style={grid}><article><small>Abonnés</small><h3>{number(partner.followers)}</h3></article><article><small>Vues moyennes</small><h3>{number(partner.averageViews)}</h3></article><article><small>Audience française</small><h3>{partner.franceAudiencePercent===null?'Non renseignée':Number(partner.franceAudiencePercent)+' %'}</h3></article><article><small>Prix indicatif</small><h3>{money(partner.suggestedFeeMinor)}</h3></article></div>
   <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}><span>Statut</span><select style={{...input,width:220}} value={partner.status} onChange={e=>void updatePartner(e.target.value as Partner['status'])}>{partnerStatuses.map(x=><option key={x} value={x}>{statusLabels[x]}</option>)}</select>{partner.email&&<a href={`mailto:${partner.email}`}>{partner.email}</a>}</div>{partner.notes&&<p>{partner.notes}</p>}</div>}
  </section>
  {partner&&<section className="admin-card admin-section"><div className="admin-section-head"><div><h2>Campagnes · @{partner.handle}</h2><p>Les liens ne fonctionnent que lorsque le statut est « En cours ».</p></div><button style={primary} onClick={()=>setNewCampaign(x=>!x)}>+ Campagne</button></div>
   {newCampaign&&<form onSubmit={addCampaign} style={{display:'grid',gap:12,marginBottom:24}}><div style={grid}>
    <label style={label}>Nom de campagne<input style={input} required minLength={3} maxLength={160} value={cForm.title} onChange={e=>setCForm({...cForm,title:e.target.value,slug:makeSlug(`${partner.handle}-${e.target.value}`)})}/></label>
    <label style={label}>Code unique /r/<input style={input} required pattern="[a-z0-9][a-z0-9-]{2,49}" value={cForm.slug} onChange={e=>setCForm({...cForm,slug:makeSlug(e.target.value)})}/></label>
    <label style={label}>Montant convenu (€)<input style={input} type="number" min="0" step="0.01" value={cForm.fee} onChange={e=>setCForm({...cForm,fee:Number(e.target.value)})}/></label>
    <label style={label}>Livrables<input style={input} value={cForm.deliverables} onChange={e=>setCForm({...cForm,deliverables:e.target.value})}/></label>
   </div><label style={label}>Notes / accord<textarea style={input} value={cForm.notes} onChange={e=>setCForm({...cForm,notes:e.target.value})}/></label><div><button style={primary} disabled={busy}>Créer la campagne</button></div></form>}
   <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Campagne</th><th>État</th><th>Budget</th><th>Clics</th><th>Visiteurs*</th><th>Inscrits*</th><th>Annonces*</th><th>Contenu</th><th></th></tr></thead><tbody>
    {campaigns.map(c=><tr key={c.id}><td><strong>{c.title}</strong><br/><small><a href={`https://petitannonces.fr/r/${c.slug}`} target="_blank" rel="noreferrer">petitannonces.fr/r/{c.slug}</a></small><br/><button style={{...button,padding:'4px 8px',fontSize:11,marginTop:5}} onClick={()=>void navigator.clipboard.writeText(`https://petitannonces.fr/r/${c.slug}`)}>Copier</button></td><td>{statusLabels[c.status]}</td><td>{money(c.feeMinor)}<br/><small>{statusLabels[c.paymentStatus]}</small></td><td>{number(c.clickCount)}</td><td>{number(c.visitorsConsented)}</td><td>{number(c.registrationsEstimated)}</td><td>{number(c.publishedListingsEstimated)}</td><td>{number(c.reportedViews)} vues<br/>{number(c.reportedLikes)} j’aime</td><td><button style={button} onClick={()=>{setEditing({...c});setEditingFee((c.feeMinor/100).toFixed(2));}}>Modifier</button></td></tr>)}
    {!campaigns.length&&<tr><td colSpan={9}>Aucune campagne pour cet influenceur.</td></tr>}
   </tbody></table></div>
  </section>}
  {editing&&<section className="admin-card admin-section"><div className="admin-section-head"><h2>Modifier · {editing.title}</h2><button type="button" style={button} onClick={()=>setEditing(null)}>Fermer</button></div><form onSubmit={saveCampaign} style={{display:'grid',gap:12}}><div style={grid}>
   <label style={label}>État de la campagne<select style={input} value={editing.status} onChange={e=>setEditing({...editing,status:e.target.value as Campaign['status']})}>{campaignStatuses.map(x=><option key={x} value={x}>{statusLabels[x]}</option>)}</select></label>
   <label style={label}>Paiement (administration uniquement)<select disabled style={input} value={editing.paymentStatus} onChange={e=>setEditing({...editing,paymentStatus:e.target.value as Campaign['paymentStatus']})}>{paymentStatuses.map(x=><option key={x} value={x}>{statusLabels[x]}</option>)}</select></label>
   <label style={label}>Budget (€)<input style={input} type="number" min="0" step="0.01" value={editingFee} onChange={e=>setEditingFee(e.target.value)}/></label>
   <label style={label}>Vues déclarées<input style={input} type="number" min="0" value={editing.reportedViews} onChange={e=>setEditing({...editing,reportedViews:Number(e.target.value)})}/></label>
   <label style={label}>J’aime déclarés<input style={input} type="number" min="0" value={editing.reportedLikes} onChange={e=>setEditing({...editing,reportedLikes:Number(e.target.value)})}/></label>
   <label style={label}>URL publication<input style={input} type="url" placeholder="https://…" value={editing.contentUrl??''} onChange={e=>setEditing({...editing,contentUrl:e.target.value})}/></label>
   <label style={label}>URL justificatif Insights<input style={input} type="url" placeholder="https://…" value={editing.proofUrl??''} onChange={e=>setEditing({...editing,proofUrl:e.target.value})}/></label>
   <label style={label}>Livrables<input style={input} value={editing.deliverables??''} onChange={e=>setEditing({...editing,deliverables:e.target.value})}/></label>
   </div><label style={label}>Notes et engagements<textarea style={input} rows={3} value={editing.notes??''} onChange={e=>setEditing({...editing,notes:e.target.value})}/></label><div><button style={primary} disabled={busy}>Enregistrer les changements</button></div></form></section>}
  <section className="admin-card admin-section"><h2>Interprétation & conformité</h2><p>* Les statistiques issues d’Analytics portent sur les sessions ayant accepté la mesure. Les nouvelles inscriptions et annonces sont des estimations liées à une fenêtre de 30 jours, pas une preuve de causalité. Les clics sont bruts et peuvent inclure des robots.</p><p>Le statut « Payé » est un suivi administratif, sans prélèvement ni virement automatique. Un contrat écrit, la mention « Publicité » / « Collaboration commerciale » et les justificatifs doivent être vérifiés avant diffusion.</p></section>
 </div>;
}
