"use client";

import {useCallback,useEffect,useMemo,useState} from "react";

type Campaign={
 enabled:boolean;edition:number;startsAt:string;endsAt:string;
 discountPercent:number;giftMonthsMultiplier:number;maxPrepaidMonths:number;
 promotionCodes:string[];
};
type Summary={settings:Campaign;public:{phase:string;visible:boolean;active:boolean};stats:{
 enrollments:number;paidProPurchases:number;pendingProPurchases:number;
 giftMonthsGranted:number;discountedPromotions:number;
}};
type Product={code:string;name:string;priceMinor:number;isActive:boolean};
const api="/api";
const dateInput=(s:string)=>{const d=new Date(s);const local=new Date(d.getTime()-d.getTimezoneOffset()*60000);return local.toISOString().slice(0,16)};
const fromInput=(s:string)=>new Date(s).toISOString();
const dateFr=(s:string)=>new Date(s).toLocaleString("fr-FR",{timeZone:"Europe/Paris",dateStyle:"medium",timeStyle:"short"});
const euro=(n:number)=>new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR"}).format(n/100);
export default function BlackFridayClient(){
 const[data,setData]=useState<Summary|null>(null);
 const[draft,setDraft]=useState<Campaign|null>(null);
 const[products,setProducts]=useState<Product[]>([]);
 const[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const[msg,setMsg]=useState<{ok:boolean;text:string}|null>(null);
 const load=useCallback(async()=>{
  setLoading(true);
  try{
   const [a,b]=await Promise.all([
    fetch(api+"/admin/commercial/black-friday",{credentials:"include",cache:"no-store"}),
    fetch(api+"/admin/commercial",{credentials:"include",cache:"no-store"}),
   ]);
   if(!a.ok)throw Error("Accès aux réglages impossible ("+a.status+")");
   const result=await a.json() as Summary;
   setData(result);setDraft(result.settings);
   if(b.ok){const v=await b.json() as {promotions?:Product[]};setProducts(v.promotions??[])}
  }catch(e){setMsg({ok:false,text:String(e instanceof Error?e.message:"Chargement impossible")})}
  finally{setLoading(false)}
 },[]);
 useEffect(()=>{void load()},[load]);
 const set=<K extends keyof Campaign>(k:K,v:Campaign[K])=>setDraft(p=>p?{...p,[k]:v}:p);
 const phase=useMemo(()=>{
  if(!draft?.enabled)return "Désactivée";
  const t=Date.now();if(t<Date.parse(draft.startsAt))return "Programmée";
  if(t>=Date.parse(draft.endsAt))return "Terminée";return "En cours";
 },[draft]);
 const changed=Boolean(data&&draft&&JSON.stringify(data.settings)!==JSON.stringify(draft));
 const valid=Boolean(draft&&Number.isInteger(draft.edition)&&
  Date.parse(draft.endsAt)>Date.parse(draft.startsAt)&&
  Date.parse(draft.endsAt)-Date.parse(draft.startsAt)<=45*86400000&&
  draft.promotionCodes.length>0&&
  draft.giftMonthsMultiplier>=0&&draft.giftMonthsMultiplier<=3&&
  draft.maxPrepaidMonths>=1&&draft.maxPrepaidMonths<=24);
 async function save(){
  if(!draft||!valid||busy)return;
  if(draft.enabled&&Date.now()>=Date.parse(draft.startsAt)&&Date.now()<Date.parse(draft.endsAt)){
    if(!window.confirm("Activer ou modifier immédiatement les offres Black Friday pour les prochains paiements ?"))return;
  }
  setBusy(true);setMsg(null);
  try{
   const r=await fetch(api+"/admin/commercial/black-friday",{
    method:"PUT",credentials:"include",headers:{"content-type":"application/json"},
    body:JSON.stringify(draft),
   });
   const payload=await r.json().catch(()=>({})) as {error?:string};
   if(!r.ok)throw Error(payload.error==="paid_purchases_settings_locked_for_this_edition"
    ?"Des achats Pro payés existent déjà : utilisez une nouvelle édition pour modifier ses modalités."
    :payload.error==="edition_must_increase"
    ?"L'année ne peut pas revenir en arrière."
    :"Échec de l’enregistrement : "+(payload.error??r.status));
   await load();setMsg({ok:true,text:"Campagne enregistrée. Les nouvelles offres et les prochaines visites utilisent ces réglages."});
  }catch(e){setMsg({ok:false,text:String(e instanceof Error?e.message:"Erreur")})}
  finally{setBusy(false)}
 }
 function nextEdition(){
  if(!draft)return;
  const old=new Date(draft.startsAt).getUTCFullYear();
  const next=Math.max(draft.edition+1,old+1);
  const update=(iso:string)=>{const d=new Date(iso);d.setUTCFullYear(d.getUTCFullYear()+(next-old));return d.toISOString()};
  setDraft({...draft,enabled:false,edition:next,startsAt:update(draft.startsAt),endsAt:update(draft.endsAt)});
  setMsg({ok:true,text:"Nouvelle édition préparée. Ajustez les dates et activez-la lorsque vous le souhaitez, puis cliquez sur Enregistrer."});
 }
 if(loading&&!draft)return <div className="admin-card admin-section">Chargement de la campagne Black Friday…</div>;
 if(!draft)return <div className="admin-flash err">{msg?.text??"Configuration indisponible."}</div>;
 const card:React.CSSProperties={border:"1px solid var(--border,#e4e5eb)",borderRadius:15,padding:18,background:"var(--card,#fff)"};
 const field:React.CSSProperties={display:"grid",gap:7,fontSize:13,fontWeight:750,minWidth:0};
 const input:React.CSSProperties={width:"100%",maxWidth:"100%",border:"1px solid #d7d7e3",borderRadius:10,padding:"10px 12px",background:"var(--card,#fff)",color:"var(--text,#282438)",fontSize:14};
 return <div style={{display:"grid",gap:20}}>
  <header className="admin-page-head">
   <div><p>Configuration · Offres & campagnes</p><h1>Black Friday</h1><span className="subtitle">Programmation et activation des campagnes, sans déploiement ni modification de code.</span></div>
   <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
    <a href="/commercial" className="admin-btn">← Offres & campagnes</a>
    <a className="admin-btn" href="https://petitannonces.fr/black-friday" target="_blank" rel="noreferrer">Voir la page publique</a>
    <button className="admin-btn" disabled={busy} onClick={()=>void load()}>Actualiser</button>
   </div>
  </header>
  {msg&&<div className={"admin-flash "+(msg.ok?"ok":"err")}>{msg.text}</div>}
  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:12}}>
   {[
    ["Statut",phase],["Inscriptions",data?.stats.enrollments??0],
    ["Achats Pro confirmés",data?.stats.paidProPurchases??0],["Mois offerts",data?.stats.giftMonthsGranted??0],
    ["Mises en avant remisées",data?.stats.discountedPromotions??0],
   ].map(([label,val])=><article className="admin-card admin-kpi" key={label}><small>{label}</small><strong>{val}</strong></article>)}
  </div>
  <section style={card}>
   <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12,marginBottom:18}}>
    <div><h2 style={{margin:"0 0 5px",fontSize:20}}>Activation de la campagne</h2><p style={{margin:0,color:"var(--muted,#6b6875)",fontSize:13}}>Arrêt immédiat des nouvelles remises et achats Pro quand désactivée.</p></div>
    <label style={{display:"inline-flex",alignItems:"center",gap:10,fontWeight:850}}>
      <input type="checkbox" checked={draft.enabled} onChange={e=>set("enabled",e.target.checked)} style={{width:21,height:21}}/>
      {draft.enabled?"Activée":"Désactivée"}
    </label>
   </div>
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:16}}>
    <label style={field}>Édition
      <input style={input} type="number" min="2026" max="2100" value={draft.edition}
       onChange={e=>set("edition",Number(e.target.value))}/>
    </label>
    <label style={field}>Début (heure locale du navigateur)
      <input style={input} type="datetime-local" value={dateInput(draft.startsAt)}
       onChange={e=>{if(e.target.value)set("startsAt",fromInput(e.target.value))}}/>
    </label>
    <label style={field}>Fin (heure locale du navigateur)
      <input style={input} type="datetime-local" value={dateInput(draft.endsAt)}
       onChange={e=>{if(e.target.value)set("endsAt",fromInput(e.target.value))}}/>
    </label>
   </div>
   <p style={{fontSize:12,color:"var(--muted,#6b6875)",margin:"12px 0 0"}}>Heure de Paris : {dateFr(draft.startsAt)} → {dateFr(draft.endsAt)}. Hors de cette période, les réductions et les paiements promotionnels ne s’appliquent pas.</p>
  </section>
  <section style={card}>
   <h2 style={{fontSize:20,margin:"0 0 5px"}}>Mises en avant · Réduction</h2>
   <p style={{color:"var(--muted,#6b6875)",fontSize:13}}>La réduction s’applique au prix réellement envoyé à Stripe. Non cumulable avec un code plus avantageux.</p>
   <div style={{display:"grid",gridTemplateColumns:"160px minmax(0,1fr)",gap:16,alignItems:"start"}}>
    <label style={field}>Réduction (%)
      <input type="number" min="0" max="90" style={input} value={draft.discountPercent}
       onChange={e=>set("discountPercent",Number(e.target.value))}/>
    </label>
    <div style={{display:"grid",gap:9}}>
      {products.length?products.map(p=><label key={p.code} style={{display:"flex",gap:9,alignItems:"center",fontSize:13}}>
        <input type="checkbox" checked={draft.promotionCodes.includes(p.code)}
         onChange={e=>set("promotionCodes",e.target.checked?[...draft.promotionCodes,p.code]:draft.promotionCodes.filter(x=>x!==p.code))}/>
        <span style={{flex:1}}>{p.name} <small style={{color:"var(--muted,#777)"}}>({p.code})</small></span>
        <b>{euro(Math.floor(p.priceMinor*(100-draft.discountPercent)/100))}</b>
      </label>):draft.promotionCodes.map(code=><span key={code}>{code}</span>)}
    </div>
   </div>
  </section>
  <section style={card}>
   <h2 style={{fontSize:20,margin:"0 0 5px"}}>Abonnements Pro · Mois offerts</h2>
   <p style={{color:"var(--muted,#6b6875)",fontSize:13}}>Paiement unique, sans renouvellement automatique. Les durées déjà payées sont conservées.</p>
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:15}}>
    <label style={field}>Mois offerts par mois acheté
      <select style={input} value={draft.giftMonthsMultiplier}
       onChange={e=>set("giftMonthsMultiplier",Number(e.target.value))}>
        {[0,1,2,3].map(m=><option key={m} value={m}>{m===0?"Désactiver les mois offerts":m+" mois offert"+(m>1?"s":"")+" / mois acheté"}</option>)}
      </select>
    </label>
    <label style={field}>Durée maximale achetable (mois)
      <input style={input} type="number" min="1" max="24" value={draft.maxPrepaidMonths}
        onChange={e=>set("maxPrepaidMonths",Number(e.target.value))}/>
    </label>
   </div>
   <p style={{margin:"12px 0 0",fontWeight:750,fontSize:13}}>Exemple : 6 mois achetés + {6*draft.giftMonthsMultiplier} mois offerts = {6+6*draft.giftMonthsMultiplier} mois d’accès.</p>
  </section>
  <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
   <button type="button" className="admin-btn primary" disabled={busy||!valid||!changed} onClick={()=>void save()}>{busy?"Enregistrement…":"Enregistrer les paramètres"}</button>
   <button type="button" className="admin-btn" disabled={busy} onClick={nextEdition}>Préparer l’édition suivante</button>
   <small style={{color:"var(--muted,#777)"}}>{changed?"Modifications non enregistrées":"Paramètres enregistrés"}</small>
  </div>
 </div>
}
