"use client";

import {useEffect,useMemo,useState} from "react";
import {AdminIcon} from "../../../components/admin-icon";

type Promotion={id:string;code:string;type:string;name:string;description:string|null;priceMinor:number;currency:string;durationHours:number|null;isActive:boolean};
type Plan={id:string;code:string;name:string;description:string|null;monthlyPriceMinor:number;yearlyPriceMinor:number|null;currency:string;maxActiveListings:number|null;maxStores:number;analyticsEnabled:boolean;autoRenewListings:boolean;prioritySupport:boolean;featuredCreditsMonthly:number;bulkImportEnabled:boolean;apiFeedEnabled:boolean;isActive:boolean};
type Banner={id:string;placement:"HOME_TOP"|"HOME_AFTER_LATEST";title:string;body:string;ctaLabel:string;href:string;imageUrl:string|null;enabled:boolean;startsAt:string|null;endsAt:string|null;sortOrder:number};
type Tab="visibility"|"plans"|"banners";
type PromoDraft={id?:string;code:string;type:string;name:string;description:string;price:string;duration:string;isActive:boolean};
type PlanDraft={id?:string;code:string;name:string;description:string;monthly:string;yearly:string;maxActiveListings:string;maxStores:string;analyticsEnabled:boolean;autoRenewListings:boolean;prioritySupport:boolean;bulkImportEnabled:boolean;apiFeedEnabled:boolean;isActive:boolean};

const euro=(n:number,c="EUR")=>new Intl.NumberFormat("fr-FR",{style:"currency",currency:c}).format(n/100);
const duration=(h:number|null)=>!h?"Sans limite":h%24===0?String(h/24)+" j":String(h)+" h";
const placementLabel=(p:Banner["placement"])=>p==="HOME_TOP"?"Accueil · haut":"Accueil · après dernières annonces";

export default function CommercialClient(){
 const[promotions,setPromotions]=useState<Promotion[]>([]);
 const[plans,setPlans]=useState<Plan[]>([]);
 const[banners,setBanners]=useState<Banner[]>([]);
 const[tab,setTab]=useState<Tab>("visibility");
 const[busy,setBusy]=useState(false);
 const[msg,setMsg]=useState<{ok:boolean;t:string}|null>(null);
 const[promoEditor,setPromoEditor]=useState<PromoDraft|null>(null);
 const[planEditor,setPlanEditor]=useState<PlanDraft|null>(null);

 async function load(){
  setBusy(true);
  try{
   const r=await fetch("/api/admin/commercial",{credentials:"include",cache:"no-store"});
   const p=await r.json().catch(()=>({}));
   if(r.ok){setPromotions(p.promotions??[]);setPlans(p.plans??[]);setBanners(p.banners??[])}
  }finally{setBusy(false)}
 }
 useEffect(()=>{void load()},[]);

 const activePromo=useMemo(()=>promotions.filter(x=>x.isActive).length,[promotions]);
 const activePlans=useMemo(()=>plans.filter(x=>x.isActive).length,[plans]);
 const activeBanners=useMemo(()=>banners.filter(x=>x.enabled).length,[banners]);
 const minActivePrice=useMemo(()=>{const rows=promotions.filter(x=>x.isActive);return rows.length?Math.min(...rows.map(x=>x.priceMinor)):null},[promotions]);

 function newPromotion(){setPromoEditor({code:"",type:"FEATURED",name:"",description:"",price:"4.99",duration:"168",isActive:true})}
 function editPromotion(p:Promotion){setPromoEditor({id:p.id,code:p.code,type:p.type,name:p.name,description:p.description??"",price:(p.priceMinor/100).toFixed(2),duration:p.durationHours==null?"":String(p.durationHours),isActive:p.isActive})}
 async function savePromotion(){
  if(!promoEditor)return;
  const priceMinor=Math.round(Number(promoEditor.price)*100);
  const durationHours=promoEditor.duration?Math.round(Number(promoEditor.duration)):null;
  if(promoEditor.name.trim().length<2||!Number.isFinite(priceMinor)||priceMinor<0){setMsg({ok:false,t:"Vérifiez le nom et le prix."});return}
  if(!promoEditor.id&&!/^[A-Z0-9_-]{2,60}$/.test(promoEditor.code)){setMsg({ok:false,t:"Le code doit contenir uniquement A-Z, 0-9, _ ou -."});return}
  setBusy(true);
  const url=promoEditor.id?"/api/admin/commercial/promotions/"+promoEditor.id:"/api/admin/commercial/promotions";
  const body:any={name:promoEditor.name.trim(),description:promoEditor.description.trim()||null,priceMinor,durationHours,isActive:promoEditor.isActive};
  if(!promoEditor.id){body.code=promoEditor.code;body.type=promoEditor.type}
  const r=await fetch(url,{method:promoEditor.id?"PUT":"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  const payload=await r.json().catch(()=>({}));setBusy(false);
  if(!r.ok){setMsg({ok:false,t:payload.error==="promotion_code_exists"?"Ce code existe déjà.":"Enregistrement impossible."});return}
  const created=!promoEditor.id;setPromoEditor(null);setMsg({ok:true,t:created?"Nouvelle option de visibilité créée.":"Option de visibilité mise à jour."});await load();
 }

 function newPlan(){setPlanEditor({code:"",name:"",description:"",monthly:"9.90",yearly:"",maxActiveListings:"50",maxStores:"1",analyticsEnabled:false,autoRenewListings:false,prioritySupport:false,bulkImportEnabled:false,apiFeedEnabled:false,isActive:true})}
 function editPlan(p:Plan){setPlanEditor({id:p.id,code:p.code,name:p.name,description:p.description??"",monthly:(p.monthlyPriceMinor/100).toFixed(2),yearly:p.yearlyPriceMinor==null?"":(p.yearlyPriceMinor/100).toFixed(2),maxActiveListings:p.maxActiveListings==null?"":String(p.maxActiveListings),maxStores:String(p.maxStores),analyticsEnabled:p.analyticsEnabled,autoRenewListings:p.autoRenewListings,prioritySupport:p.prioritySupport,bulkImportEnabled:p.bulkImportEnabled,apiFeedEnabled:p.apiFeedEnabled,isActive:p.isActive})}
 async function savePlan(){
  if(!planEditor)return;
  const monthlyPriceMinor=Math.round(Number(planEditor.monthly)*100);
  const yearlyPriceMinor=planEditor.yearly?Math.round(Number(planEditor.yearly)*100):null;
  const maxStores=Math.max(1,Math.round(Number(planEditor.maxStores)||1));
  const maxActiveListings=planEditor.maxActiveListings?Math.max(1,Math.round(Number(planEditor.maxActiveListings))):null;
  if(planEditor.name.trim().length<2||!Number.isFinite(monthlyPriceMinor)||monthlyPriceMinor<0){setMsg({ok:false,t:"Vérifiez le nom et le prix de la formule."});return}
  if(!planEditor.id&&!/^[A-Z0-9_-]{2,60}$/.test(planEditor.code)){setMsg({ok:false,t:"Le code doit contenir uniquement A-Z, 0-9, _ ou -."});return}
  setBusy(true);
  const created=!planEditor.id;
  const url=created?"/api/admin/commercial/pro-plans":"/api/admin/commercial/pro-plans/"+planEditor.id;
  const body:any={
   name:planEditor.name.trim(),description:planEditor.description.trim()||null,monthlyPriceMinor,yearlyPriceMinor,maxActiveListings,maxStores,
   analyticsEnabled:planEditor.analyticsEnabled,autoRenewListings:planEditor.autoRenewListings,prioritySupport:planEditor.prioritySupport,
   featuredCreditsMonthly:0,bulkImportEnabled:planEditor.bulkImportEnabled,apiFeedEnabled:planEditor.apiFeedEnabled,isActive:planEditor.isActive
  };
  if(created)body.code=planEditor.code;
  const r=await fetch(url,{method:created?"POST":"PUT",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  const payload=await r.json().catch(()=>({}));setBusy(false);
  if(!r.ok){setMsg({ok:false,t:payload.error==="plan_code_exists"?"Ce code de formule existe déjà.":"Impossible d’enregistrer cette formule."});return}
  setPlanEditor(null);setMsg({ok:true,t:created?"Nouvelle formule professionnelle créée.":"Formule professionnelle mise à jour."});await load();
 }

 function patchBanner(id:string,key:keyof Banner,value:any){setBanners(v=>v.map(x=>x.id===id?{...x,[key]:value}:x))}
 function addBanner(){setBanners(v=>[{id:"banner_"+Date.now(),placement:"HOME_TOP",title:"Nouvelle campagne",body:"",ctaLabel:"Découvrir",href:"/recherche",imageUrl:null,enabled:true,startsAt:null,endsAt:null,sortOrder:(v.length+1)*10},...v])}
 async function uploadBanner(id:string,file?:File){
  if(!file)return;
  if(!["image/jpeg","image/png","image/webp","image/avif"].includes(file.type)){setMsg({ok:false,t:"Format non pris en charge."});return}
  if(file.size>8*1024*1024){setMsg({ok:false,t:"Le visuel dépasse 8 Mo."});return}
  const r=await fetch("/api/admin/commercial/banners/upload-direct",{method:"POST",credentials:"include",headers:{"content-type":file.type},body:file});
  const payload=await r.json().catch(()=>({}));
  if(r.ok&&payload.url)patchBanner(id,"imageUrl",payload.url);
  setMsg({ok:r.ok,t:r.ok?"Image chargée.":payload.error??"Téléversement impossible."});
 }
 async function saveBanners(){
  setBusy(true);
  const r=await fetch("/api/admin/commercial/banners",{method:"PUT",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify(banners)});
  const payload=await r.json().catch(()=>({}));setBusy(false);
  setMsg({ok:r.ok,t:r.ok?"Campagnes enregistrées.":payload.error??"Enregistrement impossible."});
 }

 return <>
  <div className="admin-page-head">
   <div><p>Monétisation</p><h1>Offres & monétisation</h1><span className="subtitle">Gérez les options de visibilité, les formules professionnelles et les campagnes depuis une interface unique.</span></div>
   <div className="admin-page-actions"><button type="button" className="admin-btn" onClick={()=>void load()} disabled={busy}><AdminIcon name="clock"/>{busy?"Actualisation…":"Actualiser"}</button></div>
  </div>
  {msg&&<div className={"admin-flash "+(msg.ok?"ok":"err")}>{msg.t}</div>}

  <div className="admin-grid admin-kpis admin-commercial-kpis">
   <article className="admin-card admin-kpi"><small>Visibilité active</small><strong>{activePromo}</strong><p>{promotions.length} produit(s) configuré(s)</p></article>
   <article className="admin-card admin-kpi"><small>Formules Pro</small><strong>{activePlans}</strong><p>{plans.length} formule(s) disponible(s)</p></article>
   <article className="admin-card admin-kpi"><small>Campagnes actives</small><strong>{activeBanners}</strong><p>{banners.length} banner(s) configuré(s)</p></article>
   <article className="admin-card admin-kpi"><small>Entrée visibilité</small><strong>{minActivePrice==null?"—":euro(minActivePrice)}</strong><p>prix actif le plus bas</p></article>
  </div>

  <section className="admin-card admin-section admin-commercial-workspace">
   <div className="admin-commercial-tabs">
    <button type="button" className={tab==="visibility"?"active":""} onClick={()=>setTab("visibility")}><AdminIcon name="growth"/>Visibilité <span>{promotions.length}</span></button>
    <button type="button" className={tab==="plans"?"active":""} onClick={()=>setTab("plans")}><AdminIcon name="briefcase"/>Formules Pro <span>{plans.length}</span></button>
    <button type="button" className={tab==="banners"?"active":""} onClick={()=>setTab("banners")}><AdminIcon name="campaign"/>Banners <span>{banners.length}</span></button>
   </div>

   {tab==="visibility"&&<>
    <div className="admin-commercial-head"><div><h2>Options de visibilité</h2><p>Les produits actifs sont proposés automatiquement dans l’espace Visibilité.</p></div><button type="button" className="admin-btn primary" onClick={newPromotion}><AdminIcon name="plus"/>Ajouter une option</button></div>
    <div className="admin-package-list">{promotions.map(p=><article className="admin-package-row" key={p.id}>
     <span className={"admin-package-icon "+(p.isActive?"active":"")}><AdminIcon name="growth"/></span>
     <div className="admin-package-main"><div><strong>{p.name}</strong><span className={"admin-badge "+(p.isActive?"green":"red")}>{p.isActive?"Actif":"Inactif"}</span></div><small>{p.code+" · "+p.type}</small><p>{p.description||"Aucune description."}</p></div>
     <div className="admin-package-metric"><small>Prix</small><strong>{euro(p.priceMinor,p.currency)}</strong></div>
     <div className="admin-package-metric"><small>Durée</small><strong>{duration(p.durationHours)}</strong></div>
     <button type="button" className="admin-btn" onClick={()=>editPromotion(p)}><AdminIcon name="edit"/>Modifier</button>
    </article>)}{!promotions.length&&<div className="admin-empty">Aucune option de visibilité.</div>}</div>
   </>}

   {tab==="plans"&&<>
    <div className="admin-commercial-head"><div><h2>Formules professionnelles</h2><p>Tarifs, quotas et fonctionnalités des abonnements Petit Annonces Pro.</p></div><div className="admin-page-actions"><span className="admin-badge"><AdminIcon name="credit-card"/>Stripe dynamique</span><button type="button" className="admin-btn primary" onClick={newPlan}><AdminIcon name="plus"/>Ajouter une formule</button></div></div>
    <div className="admin-package-list">{plans.map(p=><article className="admin-package-row admin-pro-plan-row" key={p.id}>
     <span className={"admin-package-icon "+(p.isActive?"active":"")}><AdminIcon name="briefcase"/></span>
     <div className="admin-package-main"><div><strong>{p.name}</strong><span className={"admin-badge "+(p.isActive?"green":"red")}>{p.isActive?"Disponible":"Masquée"}</span></div><small>{p.code}</small><p>{p.description||"Formule professionnelle"}</p><div className="admin-plan-tags">{p.analyticsEnabled&&<span>Analytics</span>}{p.autoRenewListings&&<span>Renouvellement auto</span>}{p.bulkImportEnabled&&<span>Import en masse</span>}{p.apiFeedEnabled&&<span>API</span>}{p.prioritySupport&&<span>Support prioritaire</span>}</div></div>
     <div className="admin-package-metric"><small>Mensuel</small><strong>{euro(p.monthlyPriceMinor,p.currency)}</strong></div>
     <div className="admin-package-metric"><small>Annonces</small><strong>{p.maxActiveListings??"∞"}</strong></div>
     <button type="button" className="admin-btn" onClick={()=>editPlan(p)}><AdminIcon name="edit"/>Modifier</button>
    </article>)}</div>
    <div className="admin-commercial-note"><AdminIcon name="shield"/><div><strong>Codes de formule stables</strong><p>Chaque formule possède un code unique. Les abonnements existants conservent leur code; les nouvelles formules sont facturées dynamiquement par Stripe à partir du tarif mensuel enregistré ici.</p></div></div>
   </>}

   {tab==="banners"&&<>
    <div className="admin-commercial-head"><div><h2>Banners & campagnes</h2><p>Programmez les campagnes affichées sur la page d’accueil.</p></div><div className="admin-page-actions"><button type="button" className="admin-btn" onClick={addBanner}><AdminIcon name="plus"/>Ajouter</button><button type="button" className="admin-btn primary" onClick={()=>void saveBanners()} disabled={busy}><AdminIcon name="check"/>Enregistrer</button></div></div>
    <div className="admin-banner-list">{banners.map(b=><details className="admin-banner-editor" key={b.id}>
     <summary><span className={"admin-status-dot "+(b.enabled?"active":"suspended")}/><div><strong>{b.title}</strong><small>{placementLabel(b.placement)+" · ordre "+b.sortOrder}</small></div><span className={"admin-badge "+(b.enabled?"green":"red")}>{b.enabled?"Active":"Inactive"}</span><span className="admin-popover-chevron">⌄</span></summary>
     <div className="admin-banner-editor-body"><div className="admin-form-grid admin-form-modern">
      <label>Titre<input className="admin-input" value={b.title} onChange={e=>patchBanner(b.id,"title",e.target.value)}/></label>
      <label>Emplacement<select className="admin-select" value={b.placement} onChange={e=>patchBanner(b.id,"placement",e.target.value)}><option value="HOME_TOP">Accueil · haut</option><option value="HOME_AFTER_LATEST">Accueil · après dernières annonces</option></select></label>
      <label style={{gridColumn:"1/-1"}}>Texte<textarea className="admin-textarea" value={b.body} onChange={e=>patchBanner(b.id,"body",e.target.value)}/></label>
      <label>CTA<input className="admin-input" value={b.ctaLabel} onChange={e=>patchBanner(b.id,"ctaLabel",e.target.value)}/></label>
      <label>Lien<input className="admin-input" value={b.href} onChange={e=>patchBanner(b.id,"href",e.target.value)}/></label>
      <label>Début<input className="admin-input" type="datetime-local" value={b.startsAt?b.startsAt.slice(0,16):""} onChange={e=>patchBanner(b.id,"startsAt",e.target.value?new Date(e.target.value).toISOString():null)}/></label>
      <label>Fin<input className="admin-input" type="datetime-local" value={b.endsAt?b.endsAt.slice(0,16):""} onChange={e=>patchBanner(b.id,"endsAt",e.target.value?new Date(e.target.value).toISOString():null)}/></label>
      <label>Ordre<input className="admin-input" type="number" min="0" value={b.sortOrder} onChange={e=>patchBanner(b.id,"sortOrder",Number(e.target.value))}/></label>
      <label className="admin-switch-row"><span><strong>Campagne active</strong><small>Respecte les dates de programmation.</small></span><input type="checkbox" checked={b.enabled} onChange={e=>patchBanner(b.id,"enabled",e.target.checked)}/></label>
      <label style={{gridColumn:"1/-1"}}>Visuel{b.imageUrl&&<img src={b.imageUrl} alt="" className="admin-banner-preview"/>}<input type="file" accept="image/png,image/jpeg,image/webp,image/avif" onChange={e=>void uploadBanner(b.id,e.target.files?.[0])}/></label>
     </div><div className="admin-modal-actions"><button type="button" className="admin-btn danger" onClick={()=>setBanners(v=>v.filter(x=>x.id!==b.id))}>Supprimer la campagne</button></div></div>
    </details>)}{!banners.length&&<div className="admin-empty">Aucune campagne configurée.</div>}</div>
   </>}
  </section>

  {promoEditor&&<div className="admin-modal-backdrop" onMouseDown={()=>setPromoEditor(null)}><section className="admin-card admin-modal" onMouseDown={e=>e.stopPropagation()}>
   <div className="admin-modal-head"><div><span className="admin-modal-icon"><AdminIcon name="growth"/></span><div><h2>{promoEditor.id?"Modifier l’option":"Nouvelle option de visibilité"}</h2><p>{promoEditor.id?promoEditor.code:"Créez un nouveau produit commercial."}</p></div></div><button className="admin-icon-button" onClick={()=>setPromoEditor(null)}>×</button></div>
   <div className="admin-form-grid admin-form-modern">
    {!promoEditor.id&&<><label>Code<input className="admin-input" value={promoEditor.code} onChange={e=>setPromoEditor({...promoEditor,code:e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g,"")})} placeholder="FEATURED_14D"/></label><label>Type<select className="admin-select" value={promoEditor.type} onChange={e=>setPromoEditor({...promoEditor,type:e.target.value})}><option value="FEATURED">À la une</option><option value="URGENT">Urgent</option><option value="BUMP">Remontée</option><option value="SPONSORED">Sponsorisé</option><option value="GALLERY">Galerie</option></select></label></>}
    <label style={{gridColumn:"1/-1"}}>Nom<input className="admin-input" value={promoEditor.name} onChange={e=>setPromoEditor({...promoEditor,name:e.target.value})}/></label>
    <label>Prix (€)<input className="admin-input" type="number" min="0" step="0.01" value={promoEditor.price} onChange={e=>setPromoEditor({...promoEditor,price:e.target.value})}/></label>
    <label>Durée (heures)<input className="admin-input" type="number" min="1" value={promoEditor.duration} onChange={e=>setPromoEditor({...promoEditor,duration:e.target.value})}/></label>
    <label style={{gridColumn:"1/-1"}}>Description<textarea className="admin-textarea" value={promoEditor.description} onChange={e=>setPromoEditor({...promoEditor,description:e.target.value})}/></label>
    <label className="admin-switch-row"><span><strong>Produit actif</strong><small>Visible dans les options de visibilité.</small></span><input type="checkbox" checked={promoEditor.isActive} onChange={e=>setPromoEditor({...promoEditor,isActive:e.target.checked})}/></label>
   </div>
   <div className="admin-modal-actions"><button className="admin-btn" onClick={()=>setPromoEditor(null)}>Annuler</button><button className="admin-btn primary" onClick={()=>void savePromotion()} disabled={busy}>{busy?"Enregistrement…":promoEditor.id?"Enregistrer":"Créer l’option"}</button></div>
  </section></div>}

  {planEditor&&<div className="admin-modal-backdrop" onMouseDown={()=>setPlanEditor(null)}><section className="admin-card admin-modal admin-modal-wide" onMouseDown={e=>e.stopPropagation()}>
   <div className="admin-modal-head"><div><span className="admin-modal-icon"><AdminIcon name="briefcase"/></span><div><h2>{planEditor.id?"Modifier la formule "+planEditor.name:"Nouvelle formule professionnelle"}</h2><p>{planEditor.id?planEditor.code+" · abonnement professionnel":"Créez une formule facturée dynamiquement par Stripe."}</p></div></div><button className="admin-icon-button" onClick={()=>setPlanEditor(null)}>×</button></div>
   <div className="admin-form-grid admin-form-modern">
    {!planEditor.id&&<label>Code<input className="admin-input" value={planEditor.code} onChange={e=>setPlanEditor({...planEditor,code:e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g,"")})} placeholder="PRO_PLUS"/></label>}
    <label>Nom<input className="admin-input" value={planEditor.name} onChange={e=>setPlanEditor({...planEditor,name:e.target.value})}/></label>
    <label>Prix mensuel (€)<input className="admin-input" type="number" min="0" step="0.01" value={planEditor.monthly} onChange={e=>setPlanEditor({...planEditor,monthly:e.target.value})}/></label>
    <label>Prix annuel (€)<input className="admin-input" type="number" min="0" step="0.01" value={planEditor.yearly} onChange={e=>setPlanEditor({...planEditor,yearly:e.target.value})}/></label>
    <label>Annonces actives max<input className="admin-input" type="number" min="1" value={planEditor.maxActiveListings} onChange={e=>setPlanEditor({...planEditor,maxActiveListings:e.target.value})} placeholder="Vide = illimité"/></label>
    <label>Boutiques max<input className="admin-input" type="number" min="1" value={planEditor.maxStores} onChange={e=>setPlanEditor({...planEditor,maxStores:e.target.value})}/></label>
    <label style={{gridColumn:"1/-1"}}>Description<textarea className="admin-textarea" value={planEditor.description} onChange={e=>setPlanEditor({...planEditor,description:e.target.value})}/></label>
   </div>
   <div className="admin-feature-switches">
    {([["analyticsEnabled","Analytics avancés"],["autoRenewListings","Renouvellement automatique"],["prioritySupport","Support prioritaire"],["bulkImportEnabled","Import en masse"],["apiFeedEnabled","Flux API"],["isActive","Formule disponible"]] as Array<[keyof PlanDraft,string]>).map(([key,label])=><label key={String(key)}><span>{label}</span><input type="checkbox" checked={Boolean(planEditor[key])} onChange={e=>setPlanEditor({...planEditor,[key]:e.target.checked})}/></label>)}
   </div>
   <div className="admin-modal-actions"><button className="admin-btn" onClick={()=>setPlanEditor(null)}>Annuler</button><button className="admin-btn primary" onClick={()=>void savePlan()} disabled={busy}>{busy?"Enregistrement…":planEditor.id?"Enregistrer la formule":"Créer la formule"}</button></div>
  </section></div>}
 </>;
}