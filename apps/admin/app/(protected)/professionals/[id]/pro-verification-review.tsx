"use client";
import { useEffect, useState } from "react";

type Doc={id:string;kind:string;fileName:string;applicantRole:string;applicantName:string;createdAt:string};
type Review={business:{verificationStatus:string;legalName:string;siret:string|null};documents:Doc[];reverification?:{status:string;dueAt:string;graceActive:boolean}|null};
export default function ProVerificationReview({userId}:{userId:string}){
 const [data,setData]=useState<Review|null>(null);
 const [reason,setReason]=useState("");
 const [approvedCheck,setApprovedCheck]=useState(false);
 const [working,setWorking]=useState(false);
 const [message,setMessage]=useState("");
 async function refresh(){
  const r=await fetch("/api/admin/professionals/"+encodeURIComponent(userId)+"/verification",{credentials:"include",cache:"no-store"});
  if(r.ok)setData(await r.json());
 }
 useEffect(()=>{void refresh()},[userId]);
 async function decision(value:"APPROVE"|"REJECT"){
  if(reason.trim().length<10){setMessage("Indiquez un motif d’au moins 10 caractères.");return}
  if(value==="APPROVE"&&!approvedCheck){setMessage("Confirmez le contrôle de l’identité et de l’autorisation.");return}
  setWorking(true);setMessage("");
  try{
   const r=await fetch("/api/admin/professionals/"+encodeURIComponent(userId)+"/verification/decision",{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({decision:value,reason})});
   const body=await r.json().catch(()=>({}));
   setMessage(r.ok?"Décision enregistrée.":body.error??"Erreur");
   if(r.ok){setApprovedCheck(false);setReason("");await refresh()}
  }catch{setMessage("Erreur réseau")}
  finally{setWorking(false)}
 }
 if(!data)return null;
 const complete=["REGISTRY","AUTHORITY"].every(kind=>data.documents.some(d=>d.kind===kind));
 return <section className="admin-card" style={{marginBottom:16,padding:18}}>
 <h2 style={{fontSize:18,marginBottom:5}}>Contrôle de l’entreprise et du représentant</h2>
 <p style={{fontSize:13}}>Statut : <b>{data.business.verificationStatus}</b> · {data.business.legalName} · {data.business.siret||"—"}</p>
 <div>{data.reverification?.status==="PENDING"&&<p>Réexamen avant le {new Date(data.reverification.dueAt).toLocaleDateString("fr-FR")} — {data.reverification.graceActive?"Période de transition":"Date limite dépassée"}</p>}</div><div style={{display:"grid",gap:6}}>
 {(["REGISTRY","AUTHORITY"] as const).map(kind=><div key={kind} style={{border:"1px solid #ddd",borderRadius:10,padding:12}}>
 <strong>{kind==="REGISTRY"?"Extrait Kbis / RNE":"Identité ou mandat"}</strong>
 {data.documents.filter(d=>d.kind===kind).map(d=><div key={d.id} style={{fontSize:13}}>
 <a target="_blank" rel="noreferrer" href={"/api/admin/professionals/"+userId+"/verification/documents/"+d.id}>{d.fileName} ↗</a> · {d.applicantName} · {d.applicantRole==="LEGAL_REPRESENTATIVE"?"Dirigeant":"Mandataire"}
 </div>)}
 {!data.documents.some(d=>d.kind===kind)&&<p>Document manquant</p>}
 </div>)}
 </div>
 {data.business.verificationStatus!=="VERIFIED"&&<div style={{display:"grid",gap:8,marginTop:14}}>
 <label>Motif du contrôle<textarea value={reason} onChange={e=>setReason(e.target.value)} rows={2} style={{width:"100%"}} /></label>
 <label><input type="checkbox" checked={approvedCheck} onChange={e=>setApprovedCheck(e.target.checked)}/> J’ai contrôlé l’identité et le mandat avec une source indépendante.</label>
 <div style={{display:"flex",gap:8}}>
 <button className="admin-btn primary" disabled={working||!complete} onClick={()=>void decision("APPROVE")}>Approuver</button>
 <button className="admin-btn" disabled={working} onClick={()=>void decision("REJECT")}>Refuser</button>
 </div>
 </div>}
 {message&&<p>{message}</p>}
 </section>;
}
