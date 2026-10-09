"use client";
import { useEffect, useState } from "react";

type Doc={id:string;kind:string;fileName:string;mimeType:string;applicantRole:string;applicantName:string;createdAt:string};
type Review={business:{verificationStatus:string;legalName:string;siret:string|null};documents:Doc[];reverification?:{status:string;dueAt:string;graceActive:boolean}|null};
export default function ProVerificationReview({userId}:{userId:string}){
 const [data,setData]=useState<Review|null>(null);
 const [reason,setReason]=useState("");
 const [correctionKinds,setCorrectionKinds]=useState<Array<"REGISTRY"|"AUTHORITY">>(["REGISTRY","AUTHORITY"]);
 const [approvedCheck,setApprovedCheck]=useState(false);
 const [manualMethod,setManualMethod]=useState("REGISTERED_COMPANY_PHONE");
 const [manualReference,setManualReference]=useState("");
 const [manualReason,setManualReason]=useState("");
 const [manualMessage,setManualMessage]=useState("");
 const [registryConfirmed,setRegistryConfirmed]=useState(false);
 const [authorityConfirmed,setAuthorityConfirmed]=useState(false);
 const [working,setWorking]=useState(false);
 const [message,setMessage]=useState("");
 const [selectedDocument,setSelectedDocument]=useState<Doc|null>(null);
 const [previewUrl,setPreviewUrl]=useState<string|null>(null);
 const [previewError,setPreviewError]=useState("");
 useEffect(()=>{
  if(!selectedDocument)return;
  const controller=new AbortController();
  let closed=false;
  setPreviewUrl(null);
  setPreviewError("");
  void (async()=>{
   try{
    const path="/api/admin/professionals/"+encodeURIComponent(userId)+"/verification/documents/"+encodeURIComponent(selectedDocument.id);
    const res=await fetch(path,{credentials:"include",cache:"no-store",signal:controller.signal});
    if(!res.ok)throw new Error(res.status===401?"Votre session a expiré. Reconnectez-vous.":res.status===403?"Accès à ce justificatif refusé.":"Impossible d’ouvrir le document. Réessayez.");
    const bytes=await res.blob();
    if(closed)return;
    const mime=selectedDocument.mimeType;
    if(!["application/pdf","image/jpeg","image/png"].includes(mime))throw new Error("Format non pris en charge.");
    setPreviewUrl(URL.createObjectURL(new Blob([bytes],{type:mime})));
   }catch(error){
    if(!closed)setPreviewError(error instanceof Error?error.message:"Prévisualisation indisponible.");
   }
  })();
  return()=>{closed=true;controller.abort()};
 },[selectedDocument,userId]);
 useEffect(()=>()=>{if(previewUrl)URL.revokeObjectURL(previewUrl)},[previewUrl]);
 useEffect(()=>{
  if(!selectedDocument)return;
  const onKeyDown=(event:KeyboardEvent)=>{if(event.key==="Escape")setSelectedDocument(null)};
  window.addEventListener("keydown",onKeyDown);
  return()=>window.removeEventListener("keydown",onKeyDown);
 },[selectedDocument]);
 async function refresh(){
  const r=await fetch("/api/admin/professionals/"+encodeURIComponent(userId)+"/verification",{credentials:"include",cache:"no-store"});
  if(r.ok)setData(await r.json());
 }
 useEffect(()=>{void refresh()},[userId]);
 async function decision(value:"APPROVE"|"MANUAL_APPROVE"|"REJECT"){
  const explanation=value==="MANUAL_APPROVE"?manualReason.trim():reason.trim();
  if(explanation.length<(value==="MANUAL_APPROVE"?20:10)){
   const feedback=value==="MANUAL_APPROVE"?"Renseignez le motif de validation manuelle (au moins 20 caractères).":"Veuillez motiver la décision (au moins 10 caractères).";
   if(value==="MANUAL_APPROVE")setManualMessage(feedback);else setMessage(feedback);
   return;
  }
  if(value==="REJECT"&&!correctionKinds.length){setMessage("Sélectionnez au moins un justificatif à refaire.");return}
  if(value==="APPROVE"&&!approvedCheck){setMessage("Confirmez le contrôle de l’identité et de l’autorisation.");return}
  if(value==="MANUAL_APPROVE"&&(!registryConfirmed||!authorityConfirmed||manualReference.trim().length<8)){
   setManualMessage("Vérifiez les deux cases et indiquez la référence du contrôle (au moins 8 caractères).");return;
  }
  setWorking(true);setMessage("");setManualMessage("");
  try{
   const r=await fetch("/api/admin/professionals/"+encodeURIComponent(userId)+"/verification/decision",{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({decision:value,reason:explanation,correctionKinds:value==="REJECT"?correctionKinds:undefined,verificationMethod:value==="MANUAL_APPROVE"?manualMethod:undefined,verificationReference:value==="MANUAL_APPROVE"?manualReference.trim():undefined,registryConfirmed:value==="MANUAL_APPROVE"?registryConfirmed:undefined,authorityConfirmed:value==="MANUAL_APPROVE"?authorityConfirmed:undefined})});
   const body=await r.json().catch(()=>({}));
   const errors:Record<string,string>={
    registry_unavailable:"Le registre public est indisponible. Réessayez dans quelques instants.",
    registry_check_failed:"Le SIRET ou le statut de l’entreprise ne correspond pas aux données officielles. Contrôlez la fiche entreprise.",
    manual_verification_details_required:"Les justificatifs du contrôle manuel sont incomplets.",
    unauthorized:"Votre session a expiré. Reconnectez-vous.",
    forbidden:"Vous ne disposez pas de la permission nécessaire.",
    account_suspended:"Ce compte est suspendu. Contactez un administrateur principal."
   };
   const feedback=r.ok?"Compte professionnel vérifié avec succès.":errors[body.error]??"La validation a échoué ("+(body.error??"erreur inconnue")+").";
   if(value==="MANUAL_APPROVE")setManualMessage(feedback);else setMessage(feedback);
   if(r.ok){setApprovedCheck(false);setRegistryConfirmed(false);setAuthorityConfirmed(false);setManualReference("");setManualReason("");setReason("");await refresh()}
  }catch{if(value==="MANUAL_APPROVE")setManualMessage("Connexion impossible. Veuillez réessayer.");else setMessage("Erreur réseau")}
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
 <button type="button" onClick={()=>setSelectedDocument(d)} style={{display:"inline-flex",alignItems:"center",gap:7,background:"#f0edff",color:"#5345bd",border:"1px solid #dbd4ff",borderRadius:9,cursor:"pointer",padding:"8px 11px",fontWeight:750,fontSize:13}}>
  <span aria-hidden="true">👁</span> Voir le document · {d.fileName}
 </button> <span style={{color:"#6b7280",marginLeft:6}}>{d.applicantName} · {d.applicantRole==="LEGAL_REPRESENTATIVE"?"Dirigeant":"Mandataire"}</span>
 </div>)}
 {!data.documents.some(d=>d.kind===kind)&&<p>Document manquant</p>}
 </div>)}
 </div>
 {data.business.verificationStatus!=="VERIFIED"&&<div style={{display:"grid",gap:8,marginTop:14}}>
 <label>Motif de la décision (communiqué au professionnel en cas de refus)<textarea value={reason} onChange={e=>setReason(e.target.value)} rows={2} placeholder="Expliquez clairement au professionnel ce qui doit être corrigé." style={{width:"100%"}} /></label>
 <div style={{border:"1px solid #e4e1ed",padding:12,borderRadius:10,display:"grid",gap:6}}>
  <strong style={{fontSize:13}}>En cas de refus : justificatifs à refaire</strong>
  {([["REGISTRY","Kbis / RNE"],["AUTHORITY","Identité / mandat"]] as const).map(([kind,label])=>
   <label key={kind} style={{display:"flex",gap:8,alignItems:"center",fontSize:13}}>
    <input type="checkbox" checked={correctionKinds.includes(kind)} onChange={e=>setCorrectionKinds(old=>e.target.checked?[...old.filter(k=>k!==kind),kind]:old.filter(k=>k!==kind))}/>{label}
   </label>)}
  <small>Les documents non sélectionnés resteront attachés au dossier. L’utilisateur pourra remplacer uniquement les documents à corriger.</small>
 </div>
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
     <label>Motif détaillé de la validation manuelle
       <textarea value={manualReason} onChange={e=>{setManualReason(e.target.value);setManualMessage("");}} rows={3} maxLength={500} placeholder="Expliquez les éléments vérifiés, la relation entre le demandeur et l’entreprise, et le résultat du contrôle (20 caractères minimum)." style={{width:"100%",padding:10,border:"1px solid #c7c7d2",borderRadius:8}} />
     </label>
     <button type="button" className="admin-btn primary" aria-busy={working} disabled={working} onClick={()=>void decision("MANUAL_APPROVE")}>{working?"Vérification en cours…":"Valider manuellement le compte professionnel"}</button>
     {manualMessage&&<p role="status" aria-live="polite" style={{fontSize:14,fontWeight:700,margin:0,padding:"10px 12px",borderRadius:8,background:"#f3f0ff",overflowWrap:"anywhere"}}>{manualMessage}</p>}
     {(!registryConfirmed||!authorityConfirmed||manualReference.trim().length<8||manualReason.trim().length<20)&&
       <p style={{fontSize:12,margin:0,color:"#695a75"}}>Pour valider : référence du contrôle (8 caractères), justification (20 caractères), vérification SIRET et habilitation confirmées.</p>}
   </div>
 </details>
 </div>}
 {message&&<p>{message}</p>}
 {selectedDocument&&<div role="presentation" onClick={()=>setSelectedDocument(null)} style={{position:"fixed",inset:0,zIndex:10000,background:"rgba(17,19,43,.8)",display:"flex",alignItems:"center",justifyContent:"center",padding:"max(12px, env(safe-area-inset-top)) 12px max(12px, env(safe-area-inset-bottom))"}}>
   <div role="dialog" aria-modal="true" aria-label={"Contrôle du justificatif "+selectedDocument.fileName} onClick={event=>event.stopPropagation()} style={{background:"#fff",borderRadius:18,boxShadow:"0 25px 80px rgba(0,0,0,.35)",width:"min(1050px,100%)",height:"min(90dvh,900px)",display:"flex",flexDirection:"column",minHeight:0,overflow:"hidden"}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"13px 16px",gap:12,borderBottom:"1px solid #e6e4ef",flex:"0 0 auto"}}>
     <div style={{minWidth:0}}>
      <strong style={{fontSize:16,display:"block"}}>Vérification du justificatif</strong>
      <span style={{fontSize:12,color:"#6c687b",display:"block",overflowWrap:"anywhere"}}>{selectedDocument.kind==="REGISTRY"?"Extrait Kbis / RNE":"Identité / mandat"} · {selectedDocument.fileName}</span>
     </div>
     <button type="button" className="admin-btn" onClick={()=>setSelectedDocument(null)} aria-label="Fermer la prévisualisation" style={{flexShrink:0,fontSize:17}}>✕ Fermer</button>
    </div>
    <div style={{flex:1,minHeight:0,background:"#ececf2",display:"flex",alignItems:"center",justifyContent:"center",overflow:"auto",padding:selectedDocument.mimeType==="application/pdf"?0:14}}>
     {previewError?<p role="alert" style={{background:"#fff",borderRadius:12,padding:20,margin:16,color:"#b42318"}}>{previewError}</p>
     :!previewUrl?<p role="status" style={{background:"#fff",borderRadius:12,padding:20}}>Chargement du document sécurisé…</p>
     :selectedDocument.mimeType==="application/pdf"
      ?<object data={previewUrl+"#toolbar=0&navpanes=0"} type="application/pdf" aria-label="Aperçu du document PDF" style={{width:"100%",height:"100%",border:0}}>
        <p>Votre navigateur ne prend pas en charge la prévisualisation des PDF. Ouvrez cette page dans un navigateur avec lecteur PDF intégré.</p>
       </object>
      :<img src={previewUrl} alt={"Justificatif : "+selectedDocument.fileName} style={{display:"block",maxWidth:"100%",maxHeight:"100%",objectFit:"contain"}}/>}
    </div>
    <div style={{flex:"0 0 auto",padding:"9px 16px",borderTop:"1px solid #e6e4ef",fontSize:11,color:"#706d7b",display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:6}}>
     <span>Document privé · Accès contrôlé et journalisé</span>
     <span>Prévisualisation uniquement · Aucun téléchargement automatique</span>
    </div>
   </div>
 </div>}
 </section>;
}
