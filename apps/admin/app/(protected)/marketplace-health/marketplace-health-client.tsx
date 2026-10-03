'use client';
import {useEffect, useMemo, useState} from 'react';

type Key = 'visitors'|'sessions'|'registrations'|'listings'|'importedListings'|'publishedListings'|'buyerMessages'|'sellerMessages'|'buyerConversations'|'paidOrders'|'gmvMinor';
type Counts = Record<Key, number>;
type Day = Counts & {day: string};
type Report = {days: number; timezone: string; includesToday: boolean; period:{start:string|null;end:string|null}; current: Counts; previous: Counts; today: Day|null; series: Day[]; definitions: Record<string,string>};
const number = (x:number) => Number(x||0).toLocaleString('fr-FR');
const euros = (x:number) => new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format((x||0)/100);
const dateFr = (date:string) => new Date(date+'T12:00:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'short'});
const cards: Array<{field:Key;label:string;hint:string}> = [
 {field:'visitors',label:'Visiteurs-jours',hint:'Somme des visiteurs uniques quotidiens, avec consentement'},
 {field:'registrations',label:'Inscriptions',hint:'Comptes effectivement créés'},
 {field:'listings',label:'Annonces créées',hint:'Imports inclus'},
 {field:'publishedListings',label:'Annonces publiées',hint:'Passées en ligne sur la période'},
 {field:'buyerConversations',label:'Discussions acheteurs',hint:'Au moins un message acheteur'},
 {field:'paidOrders',label:'Commandes payées',hint:'Paiements confirmés sur Petit Annonces'}
];
function change(now:number, before:number) {
 if(before===0)return now===0?'Stable':'Nouvelle activité';
 const percent = ((now-before)/before*100);
 return (percent>0?'+':'')+percent.toLocaleString('fr-FR',{maximumFractionDigits:1})+' %';
}

export default function MarketplaceHealthClient() {
 const [days,setDays] = useState(7);
 const [report,setReport] = useState<Report|null>(null);
 const [loading,setLoading] = useState(true);
 const [error,setError] = useState<string|null>(null);
 const [version,setVersion] = useState(0);
 const [updatedAt,setUpdatedAt] = useState<string|null>(null);
 useEffect(() => {
  const controller = new AbortController();
  setLoading(true);setError(null);
  fetch('/api/admin/analytics/marketplace-health?days='+days,{credentials:'include',cache:'no-store',signal:controller.signal})
   .then(async res => {if(!res.ok)throw new Error('Erreur HTTP '+res.status);return await res.json() as Report;})
   .then(payload=>{if(!controller.signal.aborted){setReport(payload);setUpdatedAt(new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}));}})
   .catch(err=>{if(!controller.signal.aborted){setError(err instanceof Error?err.message:'Rapport indisponible');setReport(null);}})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return ()=>controller.abort();
 },[days,version]);
 const peak = useMemo(()=>Math.max(1,...(report?.series??[]).map(day=>day.visitors)),[report]);

 return <div className='admin-analytics-page'>
  <div className='admin-page-head'>
   <div><p>Pilotage</p><h1>Santé de la marketplace</h1><span className='subtitle'>Audience, nouveaux membres, annonces, échanges et ventes · données internes Petit Annonces</span></div>
   <div className='admin-analytics-head-actions'>
    <select className='admin-select' aria-label='Période' value={days} onChange={event=>setDays(Number(event.target.value))}>
     <option value={7}>7 jours</option><option value={30}>30 jours</option>
    </select>
    <button type='button' className='admin-btn' disabled={loading} onClick={()=>setVersion(x=>x+1)}>{loading?'Chargement…':'Actualiser'}</button>
   </div>
  </div>
  {error&&<div className='admin-flash err'><strong>Rapport indisponible</strong><span>{error}</span><button className='admin-btn' onClick={()=>setVersion(x=>x+1)}>Réessayer</button></div>}
  <section className='admin-card admin-section'>
   <div className='admin-section-head'><div><h2>Indicateurs clés</h2><p>{report?'Du '+report.period.start+' au '+report.period.end+' · aujourd’hui compris · comparaison avec les '+days+' jours précédents':'Chargement des données…'}</p></div><span className='admin-badge green'>Données internes · France</span></div>
   <div className='admin-grid admin-kpis'>
    {cards.map(card=><article className='admin-card admin-kpi' key={card.field}>
      <small>{card.label}</small><strong>{loading?'…':number(report?.current[card.field]??0)}</strong>
      <p>{card.hint}</p>
      {report&&<span className='admin-badge'>{change(report.current[card.field],report.previous[card.field])} vs période précédente</span>}
     </article>)}
   </div>
   <div className='admin-grid admin-kpis' style={{marginTop:14}}>
    <article className='admin-card admin-kpi'><small>Annonces importées</small><strong>{loading?'…':number(report?.current.importedListings??0)}</strong><p>{report?.current.listings ? Math.round(report.current.importedListings/report.current.listings*100)+' % des nouvelles annonces' : 'Aucune annonce créée'}</p></article>
    <article className='admin-card admin-kpi'><small>Annonces non importées</small><strong>{loading?'…':number(Math.max(0,(report?.current.listings??0)-(report?.current.importedListings??0)))}</strong><p>Créées sans import enregistré</p></article>
    <article className='admin-card admin-kpi'><small>Messages des acheteurs</small><strong>{loading?'…':number(report?.current.buyerMessages??0)}</strong><p>{number(report?.current.sellerMessages??0)} messages des vendeurs</p></article>
    <article className='admin-card admin-kpi'><small>Valeur des commandes payées</small><strong>{loading?'…':euros(report?.current.gmvMinor??0)}</strong><p>Montant brut, non assimilable au chiffre d’affaires de la plateforme</p></article>
   </div>
  </section>

  <section className='admin-card admin-section' style={{marginTop:16}}>
   <div className='admin-section-head'><div><h2>Évolution quotidienne</h2><p>Visiteurs uniques mesurés chaque jour · fuseau Europe/Paris</p></div><span className='admin-badge'>{updatedAt?'Actualisé à '+updatedAt:'Mise à jour'}</span></div>
   <div className='admin-mini-chart admin-analytics-chart' style={{minHeight:150}}>
    {(report?.series??[]).map(row=><div className='admin-chart-day' key={row.day} title={dateFr(row.day)+' : '+number(row.visitors)+' visiteurs'}>
      <div className='admin-chart-bars'><i style={{height:String(Math.max(row.visitors?4:0,row.visitors/peak*100))+'%'}} /></div>
      <small>{dateFr(row.day)}</small>
    </div>)}
   </div>
   <div className='admin-table-wrap' style={{marginTop:18}}><table className='admin-table'>
    <thead><tr><th>Jour</th><th>Visiteurs</th><th>Inscriptions</th><th>Annonces</th><th>Imports</th><th>Publiées</th><th>Discussions</th><th>Msg. acheteurs</th><th>Ventes payées</th></tr></thead>
    <tbody>{(report?.series??[]).slice().reverse().map(row=><tr key={row.day}>
      <td><strong>{dateFr(row.day)}</strong></td><td>{number(row.visitors)}</td><td>{number(row.registrations)}</td><td>{number(row.listings)}</td><td>{number(row.importedListings)}</td><td>{number(row.publishedListings)}</td><td>{number(row.buyerConversations)}</td><td>{number(row.buyerMessages)}</td><td>{number(row.paidOrders)}</td>
    </tr>)}
     {!loading&&!report&&<tr><td colSpan={9}>Aucune donnée disponible.</td></tr>}
    </tbody>
   </table></div>
  </section>
  <section className='admin-card admin-section' style={{marginTop:16}}>
   <div className='admin-section-head'><div><h2>Parcours du marché</h2><p>Activités suivies indépendamment · ce graphique n’est pas un taux de conversion individuel.</p></div></div>
   <div className='admin-grid admin-kpis'>
    {cards.filter(card=>['visitors','registrations','publishedListings','buyerConversations','paidOrders'].includes(card.field)).map(card=><article className='admin-card admin-kpi' key={card.field}><small>{card.label}</small><strong>{number(report?.current[card.field]??0)}</strong><p>{card.hint}</p></article>)}
   </div>
   <div className='admin-card' style={{marginTop:14,padding:16,borderStyle:'dashed'}}>
    <strong>À savoir</strong>
    <p style={{margin:'8px 0'}}>Les visiteurs sont mesurés uniquement lorsque le suivi interne est autorisé. Les comptes créés, annonces et messages proviennent de la base de données. Une personne peut visiter plusieurs jours.</p>
    <p style={{margin:'8px 0'}}>Les discussions comptent les conversations avec au moins un message acheteur durant la période. Une commande payée n’est pas forcément liée à un message durant la même période.</p>
    <p style={{margin:'8px 0'}}>Les ventes conclues directement entre particuliers en dehors du paiement Petit Annonces ne peuvent pas être déduites des messages. Les chiffres affichés ne prétendent pas les mesurer.</p>
    <a className='admin-btn' href='/analytics'>Voir Analytics et les sources de trafic</a>
   </div>
  </section>
 </div>;
}
