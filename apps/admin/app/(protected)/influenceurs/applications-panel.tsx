'use client';
import { useCallback,useEffect,useMemo,useState, type CSSProperties } from 'react';
type Application={id:string;platform:string;handle:string;email:string;followers:number;averageViews:number;franceAudiencePercent:number|null;requestedFeeMinor:number;mediaKitUrl:string|null;message:string|null;status:'PENDING'|'APPROVED'|'REJECTED';createdAt:string;reviewNote:string|null};
type Campaign={id:string;title:string;partnerHandle:string;platform:string;feeMinor:number;clickCount:number;visitorsConsented:number;registrationsEstimated:number;publishedListingsEstimated:number;reportedViews:number;reportedLikes:number;status:string};
const euro=(n:number)=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',maximumFractionDigits:2}).format(n/100);
const num=(n:number)=>Number(n||0).toLocaleString('fr-FR');
const base:CSSProperties={padding:'10px 15px',fontWeight:750,borderRadius:10,border:'1px solid #d4d9e6',background:'white',color:'#273449',cursor:'pointer'};
const action:CSSProperties={...base,color:'#fff',background:'#5b4cf0',borderColor:'#5b4cf0'};
const box:CSSProperties={padding:22,display:'grid',gap:16};
const badge:Record<string,string>={PENDING:'En attente',APPROVED:'Validée',REJECTED:'Refusée'};
const colors:Record<string,string>={PENDING:'#fff5d8',APPROVED:'#e5f7ec',REJECTED:'#fce5e7'};
export default function ApplicationsPanel(){
 const [applications,setApplications]=useState<Application[]>([]),[campaigns,setCampaigns]=useState<Campaign[]>([]);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [filter,setFilter]=useState('PENDING'),[notes,setNotes]=useState<Record<string,string>>({});
 const refresh=useCallback(async()=>{
  try{
   const [a,b]=await Promise.all([fetch('/api/admin/influencer-applications',{credentials:'include',cache:'no-store'}),fetch('/api/admin/influencers',{credentials:'include',cache:'no-store'})]);
   if(!a.ok||!b.ok)throw new Error('Impossible de charger les candidatures.');
   const ap=await a.json() as{applications:Application[]};
   const cp=await b.json() as{campaigns:Campaign[]};
   setApplications(ap.applications);setCampaigns(cp.campaigns);
  }catch(e){setError(e instanceof Error?e.message:'Données momentanément indisponibles.');}
 },[]);
 useEffect(()=>{void refresh();},[refresh]);
 const filtered=useMemo(()=>applications.filter(a=>filter==='ALL'||a.status===filter),[applications,filter]);
 const pending=applications.filter(a=>a.status==='PENDING').length;
 async function review(item:Application,status:'APPROVED'|'REJECTED'){
  const intent=status==='APPROVED'?'valider':'refuser';
  if(!window.confirm('Confirmer : '+intent+' la candidature de @'+item.handle+' ?'))return;
  setBusy(true);setError('');setMessage('');
  try{
   const r=await fetch('/api/admin/influencer-applications/'+encodeURIComponent(item.id),{method:'PATCH',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({status,note:notes[item.id]??''})});
   if(!r.ok)throw new Error('Cette candidature a peut-être déjà été traitée. Actualisez la page.');
   setMessage(status==='APPROVED'?'Candidature acceptée : prospect ajouté aux influenceurs. Aucun contrat ni paiement créé.':'Candidature refusée. Aucune notification automatique envoyée.');
   await refresh();
  }catch(e){setError(e instanceof Error?e.message:'Erreur');}finally{setBusy(false);}
 }
 function safeLink(url:string|null){try{if(!url)return null;const x=new URL(url);return x.protocol==='https:'?x.href:null;}catch{return null;}}
 return <div style={{display:'grid',gap:18,marginBottom:22}}>
  <section className="admin-card admin-section" style={box}>
   <div className="admin-section-head">
    <div><h2>Candidatures des créateurs <span className="admin-badge">{pending} en attente</span></h2><p>Demandes envoyées depuis <a href="https://petitannonces.fr/devenir-partenaire" target="_blank" rel="noreferrer">petitannonces.fr/devenir-partenaire ↗</a>. Vérifiez les statistiques avant toute proposition.</p></div>
    <button style={base} type="button" onClick={()=>void refresh()}>Actualiser</button>
   </div>
   {message&&<div className="admin-flash" role="status">{message}</div>}
   {error&&<div className="admin-flash err" role="alert">{error}</div>}
   <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{[['PENDING','À étudier'],['APPROVED','Acceptées'],['REJECTED','Refusées'],['ALL','Toutes']].map(([value,label])=><button type="button" key={value} onClick={()=>setFilter(value??'PENDING')} style={{...base,background:filter===value?'#ece9ff':'white',color:filter===value?'#4938ca':'#334155'}}>{label}</button>)}</div>
   {!filtered.length&&<p style={{color:'#64748b',margin:0}}>Aucune candidature dans cette catégorie.</p>}
   <div style={{display:'grid',gap:12}}>{filtered.map(a=><article key={a.id} style={{border:'1px solid #e2e8f0',borderRadius:13,padding:18,display:'grid',gap:12}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12,flexWrap:'wrap'}}>
      <div><strong style={{fontSize:18}}>@{a.handle}</strong><span style={{paddingLeft:9,color:'#64748b',fontSize:12}}>{a.platform}</span><div style={{marginTop:5,fontSize:12,color:'#64748b'}}>{new Date(a.createdAt).toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'numeric'})} · <a href={'mailto:'+a.email}>{a.email}</a></div></div>
      <span style={{padding:'6px 12px',borderRadius:999,fontSize:12,background:colors[a.status],color:'#273449',fontWeight:750}}>{badge[a.status]}</span>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',gap:10}}>
     {[['Abonnés',num(a.followers)],['Vues moyennes',num(a.averageViews)],['France',a.franceAudiencePercent===null?'Non indiqué':String(a.franceAudiencePercent)+' %'],['Tarif demandé',euro(a.requestedFeeMinor)]].map(([k,v])=><div key={k} style={{padding:12,borderRadius:10,background:'#f7f8fc'}}><small style={{display:'block',color:'#64748b'}}>{k}</small><strong>{v}</strong></div>)}
    </div>
    {a.message&&<p style={{fontSize:13,whiteSpace:'pre-wrap',margin:0}}>{a.message}</p>}
    {safeLink(a.mediaKitUrl)&&<a rel="noopener noreferrer" target="_blank" href={safeLink(a.mediaKitUrl)!} style={{fontSize:13}}>Consulter le media kit (lien fourni par le créateur) ↗</a>}
    {a.status==='PENDING'?<div style={{display:'grid',gap:10}}>
      <label style={{fontSize:13}}>Note interne (optionnelle)<textarea style={{display:'block',width:'100%',minHeight:55,padding:10,borderRadius:8,border:'1px solid #dbe2ed',marginTop:5}} maxLength={1200} value={notes[a.id]??''} onChange={e=>setNotes(v=>({...v,[a.id]:e.target.value}))}/></label>
      <div style={{display:'flex',gap:10,flexWrap:'wrap'}}><button type="button" disabled={busy} onClick={()=>void review(a,'APPROVED')} style={action}>Accepter dans les prospects</button><button type="button" disabled={busy} onClick={()=>void review(a,'REJECTED')} style={base}>Refuser</button></div>
    </div>:a.reviewNote&&<small style={{color:'#64748b'}}>Note interne : {a.reviewNote}</small>}
   </article>)}</div>
  </section>
  <section className="admin-card admin-section" style={box}>
   <div className="admin-section-head"><div><h2>Analyse des coûts par campagne</h2><p>Comparaison du budget convenu avec les résultats observés ou déclarés. Non assimilable à un retour financier réel.</p></div></div>
   <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Campagne</th><th>Coût / 1 000 vues*</th><th>Coût / clic brut</th><th>Coût / inscrit estimé</th><th>Coût / annonce estimée</th><th>Engagement déclaré*</th></tr></thead>
    <tbody>{campaigns.map(c=>{
      const v=c.reportedViews||0,likes=c.reportedLikes||0;
      const cost=(n:number,mult=1)=>n>0?euro(c.feeMinor*mult/n):'—';
      return <tr key={c.id}><td><strong>{c.title}</strong><br/><small>@{c.partnerHandle} · {c.platform}</small></td><td>{cost(v,1000)}</td><td>{cost(c.clickCount)}</td><td>{cost(c.registrationsEstimated)}</td><td>{cost(c.publishedListingsEstimated)}</td><td>{v>0?(likes/v*100).toLocaleString('fr-FR',{maximumFractionDigits:2})+' %':'—'}</td></tr>;
    })}{campaigns.length===0&&<tr><td colSpan={6}>Aucune campagne créée pour le moment.</td></tr>}</tbody>
   </table></div>
   <p style={{fontSize:12,color:'#64748b',lineHeight:1.65,margin:0}}>* Les vues et « j'aime » proviennent des informations déclarées, non vérifiées automatiquement par les plateformes. Les clics sont bruts, les conversions sont estimées sur les sessions ayant consenti aux mesures. Les coûts utilisent le budget convenu, pas forcément les paiements réalisés.</p>
  </section>
 </div>;
}
