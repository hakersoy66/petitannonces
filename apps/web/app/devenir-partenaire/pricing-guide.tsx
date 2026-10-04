'use client';
import { useMemo, useState } from 'react';
import styles from './page.module.css';

/**
 * Budget de négociation de Petit Annonces, NON garanti.
 * Pour 1 Reel/vidéo courte originale + 1 Story d'accompagnement,
 * hors droits de réutilisation et exclusivité.
 */
export type PriceBand={min:number|null;max:number|null;label:string;detail:string};
export function partnerBudgetBand(followers:number):PriceBand {
  if(!Number.isFinite(followers)||followers<1000)return{min:null,max:null,label:'Sur étude',detail:'Moins de 1 000 abonnés : chaque profil est étudié individuellement.'};
  if(followers<10000)return{min:50,max:130,label:'1 000 – 9 999',detail:'Créateurs de proximité'};
  if(followers<50000)return{min:150,max:400,label:'10 000 – 49 999',detail:'Communauté en croissance'};
  if(followers<100000)return{min:400,max:850,label:'50 000 – 99 999',detail:'Audience établie'};
  return {min:null,max:null,label:'100 000 et +',detail:'Offre personnalisée sur devis'};
}
const fmt=(n:number)=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(n);
const row=[
 {label:'Instagram',type:'Partenariats de marque',main:'200–1 000 €',sub:'Repère observé en France pour certains micro-créateurs et formats. La marque paie le créateur, pas Instagram. Pas de tarif officiel.',tone:'market'},
 {label:'Facebook',type:'Meta Content Monetization',main:'Montant variable',sub:'Paiement selon les contenus et vues éligibles, pour les comptes admis au programme. Pas de tarif public fixe par Reel.',tone:'neutral'},
 {label:'Petitannonces.fr',type:'Collaboration directe',main:'Dès 50 €',sub:'Notre grille indicative par taille de communauté, pour 1 Reel + 1 Story. Chaque montant dépend de la validation et d’un accord.',tone:'ours'}
];
export default function PricingGuide(){
 const [followers,setFollowers]=useState('15000'),[views,setViews]=useState('7500'),[france,setFrance]=useState('60');
 const band=useMemo(()=>partnerBudgetBand(Number(followers||0)),[followers]);
 const estimated=band.min!==null&&band.max!==null?`${fmt(band.min)} – ${fmt(band.max)}`:'Sur devis / étude';
 return <section className={styles.pricingSection} id="tarifs" aria-label="Comparaison des rémunérations">
  <div className={styles.pricingHeader}>
   <div><span className={styles.kicker}>RÉMUNÉRATION TRANSPARENTE</span><h2>Combien pouvez-vous gagner ?</h2><p>Comparons les programmes de rémunération des réseaux sociaux, les partenariats Instagram et les propositions de Petit Annonces.</p></div>
   <a href="#candidature" className={styles.pricingLink}>Proposer mon profil <span>↗</span></a>
  </div>
  <div className={styles.comparisonGrid}>
   {row.map(x=><article className={x.tone==='ours'?styles.compareOurs:styles.compareCard} key={x.label}>
      {x.tone==='ours'&&<span className={styles.ownTag}>NOTRE PROGRAMME</span>}
      <div className={styles.compareBrand}><span className={styles.compareSymbol}>{x.label==='Instagram'?'◎':x.label==='Facebook'?'f':'pa'}</span><div><strong>{x.label}</strong><small>{x.type}</small></div></div>
      <strong className={styles.comparePrice}>{x.main}</strong>
      <p>{x.sub}</p>
   </article>)}
  </div>
  <p className={styles.comparisonCaution}><strong>Exemple Facebook (exception et non tarif standard) :</strong> Meta annonce dans son programme Creator Fast Track, sous conditions d’éligibilité et pendant trois mois, 1 000 $/mois pour certains créateurs ayant au moins 100 000 abonnés sur un autre réseau, ou 3 000 $/mois pour certains comptes dépassant un million. Ce programme est distinct des revenus ordinaires de Facebook. Source : <a target="_blank" rel="noopener noreferrer" href="https://about.fb.com/news/2026/03/creator-fast-track-grow-your-audience-earn-money-on-facebook/">Meta, mars 2026</a>.</p>
  <p className={styles.comparisonCaution}><strong>Attention :</strong> ces chiffres ne sont pas des rémunérations équivalentes. Facebook rémunère certains contenus éligibles selon leur performance ; le repère Instagram concerne des contrats privés avec des marques. Petit Annonces présente ici sa propre proposition budgétaire, sans promesse de versement automatique.</p>
  <div className={styles.budgetGuide}>
   <div className={styles.guideHead}><div><span className={styles.kicker}>GRILLE PETIT ANNONCES</span><h3>Nos enveloppes indicatives</h3><p>Pour une proposition de 1 Reel/vidéo verticale + 1 Story, sous réserve d’un accord écrit.</p></div><span className={styles.guideDisclosure}>Tarifs indicatifs, non contractuels</span></div>
   <div className={styles.budgetList}>
    {[{f:3000,name:'Nano-créateur'},{f:15000,name:'Micro-créateur'},{f:75000,name:'Créateur confirmé'},{f:150000,name:'Grand compte'}].map(x=>{
     const p=partnerBudgetBand(x.f);
     return <div className={styles.budgetItem} key={x.f}><div><strong>{x.name}</strong><small>{p.label} abonnés</small></div><b>{p.min===null||p.max===null?'Sur devis':`${fmt(p.min)} – ${fmt(p.max)}`}</b></div>;
    })}
   </div>
  </div>
  <div className={styles.pricingSimulator}>
   <div><span className={styles.kicker}>ESTIMATEUR</span><h3>Estimez une première enveloppe</h3><p>Renseignez votre communauté : la grille est basée sur la taille du compte. Les vues récentes et la part de l'audience située en France seront étudiées lors de la négociation, sans augmenter automatiquement le devis.</p></div>
   <div className={styles.simulatorBody}>
    <div className={styles.simulatorInputs}>
     <label>Vos abonnés<input type="number" min={0} max={1000000000} step={1} value={followers} onChange={e=>setFollowers(e.target.value)}/></label>
     <label>Vues moyennes / Reel<input type="number" min={0} max={1000000000} step={1} value={views} onChange={e=>setViews(e.target.value)}/></label>
     <label>Audience en France (%)<input type="number" min={0} max={100} step="1" value={france} onChange={e=>setFrance(e.target.value)}/></label>
    </div>
    <div className={styles.simulatorResult}><small>Budget envisageable par collaboration</small><strong aria-live="polite">{estimated}</strong><span>Estimation non contractuelle · Aucun revenu ni contrat garanti</span><a href="#candidature">Envoyer ma proposition ↗</a></div>
   </div>
  </div>
  <details className={styles.pricingSources}>
   <summary>Sources des références & conditions</summary>
   <p>Facebook : <a target="_blank" rel="noopener noreferrer" href="https://about.fb.com/news/2026/03/creator-fast-track-grow-your-audience-earn-money-on-facebook/">Meta, Creator Fast Track et Content Monetization (mars 2026)</a>. Certains créateurs admissibles au programme spécial Creator Fast Track peuvent recevoir 1 000 ou 3 000 dollars par mois pendant trois mois selon leurs audiences ; cette offre sur conditions et invitation ne correspond pas au tarif général de Facebook.</p>
   <p>Instagram : <a target="_blank" rel="noopener noreferrer" href="https://blog.hypeauditor.com/fr/tarif-influenceur/">HypeAuditor, tarifs négociés en France (2026)</a> ; <a target="_blank" rel="noopener noreferrer" href="https://about.fb.com/news/2024/02/creator-marketplace-for-brands-and-creators-to-collaborate-on-instagram/">Meta, Creator Marketplace</a>. Les fourchettes des collaborations sont des références de marché et non des sommes versées automatiquement par Instagram.</p>
   <p>Les montants Petit Annonces sont nos budgets de discussion proposés, susceptibles de varier selon la qualité des contenus, les justificatifs d'audience en France, les droits d'utilisation, le format, la durée et le régime fiscal. Ils ne constituent pas une offre ferme.</p>
  </details>
 </section>;
}
