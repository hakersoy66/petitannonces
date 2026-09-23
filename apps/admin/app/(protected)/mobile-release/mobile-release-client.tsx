"use client";
import { useEffect, useState } from "react";

type Status = {
  expectedPackage: string;
  googleServices: { uploaded: boolean; valid: boolean; projectId: string | null; packageMatched: boolean };
  serviceAccount: { uploaded: boolean; valid: boolean; projectId: string | null; clientEmail: string | null };
  sameProject: boolean;
  readyForEas: boolean;
  fcmV1Configured: boolean;
};

type Kind = "google-services" | "service-account";

const errorText: Record<string,string> = {
  invalid_json_file: "Le fichier JSON est invalide.",
  firebase_project_id_missing: "Le project_id Firebase est introuvable dans google-services.json.",
  android_package_mismatch: "Ce google-services.json n’appartient pas à l’application Android Petit Annonces.",
  invalid_firebase_service_account: "Le fichier Service Account Firebase est invalide ou incomplet.",
  google_services_required_first: "Chargez d’abord google-services.json.",
  firebase_project_mismatch: "Les deux fichiers n’appartiennent pas au même projet Firebase.",
  firebase_file_save_failed: "Le fichier n’a pas pu être enregistré sur le serveur.",
};

export default function MobileReleaseClient(){
  const [status,setStatus]=useState<Status|null>(null);
  const [busy,setBusy]=useState<Kind|"">("");
  const [msg,setMsg]=useState<{ok:boolean;text:string}|null>(null);
  async function load(){const r=await fetch("/api/admin/mobile-release/firebase",{credentials:"include",cache:"no-store"});if(r.ok)setStatus(await r.json() as Status)}
  useEffect(()=>{void load()},[]);
  async function upload(kind:Kind,file:File|null){
    if(!file)return;
    setBusy(kind);setMsg(null);
    try{
      if(file.size>512*1024)throw new Error("Fichier trop volumineux (512 Ko max).");
      const text=await file.text();let parsed:unknown;
      try{parsed=JSON.parse(text)}catch{throw new Error("Le fichier sélectionné n’est pas un JSON valide.")}
      const endpoint=kind==="google-services"?"google-services":"service-account";
      const r=await fetch(`/api/admin/mobile-release/firebase/${endpoint}`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify(parsed)});
      const p=await r.json().catch(()=>({})) as Status&{error?:string};
      if(!r.ok)throw new Error(errorText[p.error??""]??"Envoi impossible.");
      setStatus(p);setMsg({ok:true,text:kind==="google-services"?"google-services.json validé et stocké en sécurité.":"Service Account Firebase validé et stocké en sécurité."});
    }catch(e){setMsg({ok:false,text:e instanceof Error?e.message:"Envoi impossible."})}finally{setBusy("")}
  }
  async function remove(kind:Kind){
    if(!confirm("Supprimer ce fichier Firebase du serveur ?"))return;
    const r=await fetch(`/api/admin/mobile-release/firebase/${kind}`,{method:"DELETE",credentials:"include"});
    if(r.ok){setStatus(await r.json() as Status);setMsg({ok:true,text:"Fichier supprimé."})}
  }
  const project=status?.googleServices.projectId??status?.serviceAccount.projectId??null;
  return <>
    <div className="admin-page-head"><div><p>Application native</p><h1>Android · Firebase & FCM</h1><span className="subtitle">Déposez ici les deux fichiers Firebase nécessaires aux notifications Android. Accès réservé au Super Admin.</span></div></div>
    {msg&&<div className={`admin-flash ${msg.ok?"ok":"err"}`}>{msg.text}</div>}
    <div className="admin-grid admin-two-col">
      <section className="admin-card admin-section">
        <div className="admin-section-head"><div><h2>1 · google-services.json</h2><p>Configuration Firebase de l’application Android.</p></div><span className={`admin-badge ${status?.googleServices.valid?"green":status?.googleServices.uploaded?"orange":""}`}>{status?.googleServices.valid?"Validé":status?.googleServices.uploaded?"À corriger":"Manquant"}</span></div>
        <div className="admin-secret-note">Package attendu : <strong>{status?.expectedPackage??"fr.petitannonces.petitannoncesapp"}</strong>. Le fichier est conservé hors du dépôt Git et n’est jamais renvoyé en clair.</div>
        {status?.googleServices.valid&&<div style={{marginTop:14}}><strong>Projet Firebase</strong><div style={{marginTop:4,fontSize:13,color:"#717487"}}>{status.googleServices.projectId}</div></div>}
        <div className="admin-upload" style={{marginTop:18}}><input type="file" accept="application/json,.json" disabled={busy!==""} onChange={e=>void upload("google-services",e.target.files?.[0]??null)}/>{status?.googleServices.uploaded&&<button type="button" className="admin-btn danger" onClick={()=>void remove("google-services")}>Supprimer</button>}</div>
      </section>
      <section className="admin-card admin-section">
        <div className="admin-section-head"><div><h2>2 · Service Account FCM V1</h2><p>Clé privée Google/Firebase utilisée par EAS pour les notifications.</p></div><span className={`admin-badge ${status?.serviceAccount.valid?"green":status?.serviceAccount.uploaded?"orange":""}`}>{status?.serviceAccount.valid?"Validé":status?.serviceAccount.uploaded?"À corriger":"Manquant"}</span></div>
        <div className="admin-secret-note">🔒 La clé privée n’est jamais affichée dans le panneau. Chargez uniquement le JSON généré depuis Firebase / Google Cloud Service Accounts.</div>
        {status?.serviceAccount.valid&&<div style={{marginTop:14}}><strong>Compte de service</strong><div style={{marginTop:4,fontSize:13,color:"#717487",overflowWrap:"anywhere"}}>{status.serviceAccount.clientEmail}</div></div>}
        <div className="admin-upload" style={{marginTop:18}}><input type="file" accept="application/json,.json" disabled={busy!==""||!status?.googleServices.valid} onChange={e=>void upload("service-account",e.target.files?.[0]??null)}/>{status?.serviceAccount.uploaded&&<button type="button" className="admin-btn danger" onClick={()=>void remove("service-account")}>Supprimer</button>}</div>
        {!status?.googleServices.valid&&<small style={{display:"block",marginTop:10,color:"#9d6117"}}>Chargez d’abord un google-services.json valide.</small>}
      </section>
    </div>
    <section className="admin-card admin-section" style={{marginTop:18}}>
      <div className="admin-section-head"><div><h2>État de préparation Android</h2><p>Le système vérifie automatiquement que les deux fichiers utilisent le même projet Firebase.</p></div><span className={`admin-badge ${status?.readyForEas?"green":"orange"}`}>{status?.readyForEas?"Prêt pour EAS":"Configuration incomplète"}</span></div>
      <div className="admin-form-grid">
        <div className="admin-toggle"><div><strong>Package Android</strong><small>{status?.expectedPackage??"fr.petitannonces.petitannoncesapp"}</small></div><span className={`admin-badge ${status?.googleServices.packageMatched?"green":"red"}`}>{status?.googleServices.packageMatched?"OK":"En attente"}</span></div>
        <div className="admin-toggle"><div><strong>Même projet Firebase</strong><small>{project??"Aucun projet validé"}</small></div><span className={`admin-badge ${status?.sameProject?"green":""}`}>{status?.sameProject?"OK":"En attente"}</span></div>
        <div className="admin-toggle"><div><strong>FCM V1 dans EAS</strong><small>Configuration finale effectuée après validation des deux fichiers.</small></div><span className={`admin-badge ${status?.fcmV1Configured?"green":"orange"}`}>{status?.fcmV1Configured?"Configuré":"À configurer"}</span></div>
        <div className="admin-toggle"><div><strong>Final AAB</strong><small>Un nouveau bundle sera généré après FCM V1.</small></div><span className="admin-badge orange">En attente</span></div>
      </div>
    </section>
  </>
}
