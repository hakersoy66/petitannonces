"use client";
import { useEffect, useState } from "react";

type Doc={id:string;kind:string;fileName:string;applicantRole:string;applicantName:string;createdAt:string};
type Review={business:{verificationStatus:string;legalName:string;siret:string|null};documents:Doc[];reverification?:{status:string;dueAt:string;graceActive:boolean}|null};
export default function ProVerificationReview({userId}:{userId:string}){
 const [data,setData]=useState<Review|null>(null);
 const [reason,setReason]=useState("");
 const [approvedCheck,setApprovedCheck]=useState(false);
 const [manualMethod,setManualMethod]=useState("REGISTERED_COMPANY_PHONE");
 const [manualReference,setManualReference]=useState("");
 const [registryConfirmed,setRegistryConfirmed]=useState(false);
 const [authorityConfirmed,setAuthorityConfirmed]=useState(false);
 const [working,setWorking]=useState(false);
 const [message,setMessage]=useState("");
 async function refresh(){
  const r=await fetch("/api/admin/professionals/"+encodeURIComponent(userId)+"/verification",{credentials:"include",cache:"no-store"});
  if(r.ok)setData(await r.json());
 }
 useEffect(()=>{void refresh()},[userId]);
 async function decision(value:"APPROVE"|"MANUAL_APPROVE"|"REJECT"){
  if(reason.trim().length<(value==="MANUAL_APPROVE"?20:10)){setMessage("Veuillez motiver la décision de façon précise.");return}
  if(value==="APPROVE"&&!approvedCheck){setMessage("Confirmez le contrôle de l’identité et de l’autorisation.");return}
  if(value==="MANUAL_APPROVE"&&(!registryConfirmed||!authorityConfirmed||manualReference.trim().length<8)){
   setMessage("Pour valider manuellement : contrôlez le registre, confirmez le pouvoir de représentation et renseignez une référence de contrôle.");return;
  }
  setWorking(true);setMessage("");
  try{
   const r=await fetch("/api/admin/professionals/"+encodeURIComponent(userId)+"/verification/decision",{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({decision:value,reason,verificationMethod:value==="MANUAL_APPROVE"?manualMethod:undefined,verificationReference:value==="MANUAL_APPROVE"?manualReference.trim():undefined,registryConfirmed:value==="MANUAL_APPROVE"?registryConfirmed:undefined,authorityConfirmed:value==="MANUAL_APPROVE"?authorityConfirmed:undefined})});
   const body=await r.json().catch(()=>({}));
   setMessage(r.ok?"Décision enregistrée.":body.error??"Erreur");
   if(r.ok){setApprovedCheck(false);setRegistryConfirmed(false);setAuthorityConfirmed(false);setManualReference("");setReason("");await refresh()}
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
 <details style={{border:"1px solid #c8c6d8",borderRadius:12,padding:14,marginTop:8}}>
   <summary style={{cursor:"pointer",fontWeight:700}}>Validation manuelle par un administrateur (sans documents déposés)</summary>
   <p style={{fontSize:13,margin:"10px 0"}}>Réservée aux administrateurs habilités. Vérifiez vous-même l’existence de l’entreprise dans le registre officiel et le pouvoir du demandeur de la représenter. Chaque décision est journalisée.</p>
   <div style={{display:"grid",gap:10}}>
     <label>Méthode de contrôle indépendante
       <select value={manualMethod} onChange={e=>setManualMethod(e.target.value)} style={{width:"100%",padding:10,border:"1px solid #c7c7d2",borderRadius:8}}>
         <option value="REGISTERED_COMPANY_PHONE">Appel au numéro officiel de l’entreprise</option>
         <option value="VIDEO_CALL">Entretien vidéo avec le représentant</option>
         <option value="IN_PERSON">Contrôle en personne</option>
         <option value="SIGNED_AUTHORIZATION">Mandat signé vérifié indépendamment</option>
         <option value="OTHER_INDEPENDENT">Autre vérification indépendante</option>
       </select>
     </label>
     <label>Référence du contrôle (date, interlocuteur, source)
       <input value={manualReference} onChange={e=>setManualReference(e.target.value)} maxLength={250} placeholder="Ex. Appel au standard officiel du 09/10, confirmé par le gérant" style={{width:"100%",padding:10,border:"1px solid #c7c7d2",borderRadius:8}} />
     </label>
     <label style={{display:"flex",gap:8,alignItems:"flex-start"}}>
       <input type="checkbox" checked={registryConfirmed} onChange={e=>setRegistryConfirmed(e.target.checked)} />
       J’ai vérifié que l’entreprise est active et que son SIRET correspond aux données officielles.
     </label>
     <label style={{display:"flex",gap:8,alignItems:"flex-start"}}>
       <input type="checkbox" checked={authorityConfirmed} onChange={e=>setAuthorityConfirmed(e.target.checked)} />
       J’ai personnellement confirmé que ce demandeur est autorisé à représenter l’entreprise par une source indépendante.
     </label>
     <button type="button" className="admin-btn primary" disabled={working||!registryConfirmed||!authorityConfirmed||manualReference.trim().length<8||reason.trim().length<20} onClick={()=>void decision("MANUAL_APPROVE")}>Valider manuellement le compte professionnel</button>
   </div>
 </details>
 </div>}
 {message&&<p>{message}</p>}
 </section>;
}
