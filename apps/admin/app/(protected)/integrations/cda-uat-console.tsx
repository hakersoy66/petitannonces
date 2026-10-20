"use client";
import { useEffect, useState } from "react";
type Status={available:boolean;environment:string;productionPublicationEnabled:boolean};
type Result={success?:boolean;data?:{id?:string;mail?:string;tel?:string};error?:string|number;message?:string};
const BASE="/api/admin/integrations/cda-uat";
export default function CdaUatConsole(){
 const [status,setStatus]=useState<Status|null>(null);
 const [scope,setScope]=useState<"professional"|"listing">("professional");
 const [proType,setProType]=useState("1"),[proNumber,setProNumber]=useState("");
 const [json,setJson]=useState(""),[id,setId]=useState(""),[masked,setMasked]=useState("");
 const [channel,setChannel]=useState("1"),[code,setCode]=useState("");
 const [step,setStep]=useState(1),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 async function refresh(){try{const r=await fetch(BASE,{credentials:"include",cache:"no-store"});if(r.ok)setStatus(await r.json())}catch{setMessage("Connexion administrateur indisponible.")}}
 useEffect(()=>{void refresh()},[]);
 function change(next:"professional"|"listing"){setScope(next);setId("");setMasked("");setCode("");setMessage("");setStep(1)}
 async function call(path:string,body:Record<string,unknown>):Promise<Result|null>{
  setBusy(true);setMessage("");
  try{const r=await fetch(BASE+"/"+path,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
   const data=await r.json().catch(()=>({})) as Result;
   if(!r.ok||!data.success){setMessage(data.message||("Erreur CDA : "+String(data.error||r.status)));return null}
   return data;
  }catch{setMessage("Serveur CDA indisponible.");return null}
  finally{setBusy(false)}
 }
 async function check(){
  let body:Record<string,unknown>={};
  if(scope==="professional"){body={proNumberType:Number(proType),proNumber:proNumber.trim().toUpperCase()}}
  else{try{const value:unknown=JSON.parse(json);if(!value||typeof value!=="object"||Array.isArray(value))throw Error();body=value as Record<string,unknown>;delete body.consumerId}catch{setMessage("Le JSON du dossier est invalide.");return}}
  const result=await call(scope==="professional"?"check-pro":"check-data",body);
  if(result?.data?.id){setId(result.data.id);setMasked([result.data.mail,result.data.tel].filter(Boolean).join(" / "));setStep(2);setMessage("Contrôle accepté. Validez la coordonnée masquée avant l’envoi du code.")}
 }
 async function send(){const result=await call("contact",{id,contactType:Number(channel),scope});if(result){setStep(3);setMessage("Code envoyé. Il expire dans 15 minutes.")}}
 async function validate(){const result=await call("validate",{id,code:code.trim(),scope});if(result){setStep(4);setCode("");setMessage("Validation CDA confirmée en préproduction uniquement.")}}
 return <div style={{border:"1px solid #d1d5db",borderRadius:14,padding:18,display:"grid",gap:12,marginTop:18}}>
  <strong>Console CDA — tests de préproduction</strong>
  <p style={{margin:0}}>Contrôle I-CAD / BNO. Les annonces d’animaux vivants restent bloquées sur le site public.</p>
  <p style={{margin:0}}>Configuration : <b>{status===null?"Chargement…":status.available?"Clé UAT configurée":"Clé UAT non configurée"}</b> <button type="button" className="admin-btn" onClick={()=>void refresh()}>Actualiser</button></p>
  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button className="admin-btn" type="button" onClick={()=>change("professional")}>Professionnel BNO</button><button className="admin-btn" type="button" onClick={()=>change("listing")}>Chien ou chat</button></div>
  {step===1&&<div style={{display:"grid",gap:10}}>
   {scope==="professional"?<>
    <label>Identifiant BNO <select value={proType} onChange={e=>setProType(e.target.value)}><option value="1">SIRET</option><option value="2">Éleveur LOF</option><option value="3">Éleveur LOOF</option><option value="4">RNA</option></select></label>
    <label>Numéro <input value={proNumber} onChange={e=>setProNumber(e.target.value)} placeholder="Numéro déclaré dans la BNO" /></label>
   </>:<label>JSON du dossier CDA (operationType et data) <textarea style={{width:"100%",fontFamily:"monospace"}} rows={8} spellCheck={false} value={json} onChange={e=>setJson(e.target.value)} placeholder='{"operationType":1,"data":{"animal":{},"owner":{}}}'/></label>}
   <button className="admin-btn" type="button" disabled={!status?.available||busy} onClick={()=>void check()}>1. Contrôler les données</button>
  </div>}
  {step===2&&<div><p>Dossier {id}. Coordonnées masquées : {masked||"non reçues"}</p>
   {scope==="listing"&&<label>Canal <select value={channel} onChange={e=>setChannel(e.target.value)}><option value="1">E-mail</option><option value="2">SMS</option></select></label>}
   <button className="admin-btn" type="button" disabled={busy} onClick={()=>void send()}>2. Envoyer le code</button></div>}
  {step===3&&<div><label>Code de validation <input value={code} onChange={e=>setCode(e.target.value)} autoComplete="one-time-code"/></label>
   <button className="admin-btn" type="button" disabled={busy||code.trim().length<4} onClick={()=>void validate()}>3. Vérifier le code</button></div>}
  {step===4&&<p>Test validé. <button className="admin-btn" type="button" onClick={()=>change(scope)}>Nouveau test</button></p>}
  {message&&<p role="status" style={{margin:0}}>{message}</p>}
  <small>Accès réservé aux administrateurs. Jamais de publication automatique, ni accès aux informations privées de tiers hors tests autorisés.</small>
 </div>
}
