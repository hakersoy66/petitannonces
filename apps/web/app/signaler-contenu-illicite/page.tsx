"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
export default function DsaNoticePage() {
  const [prefill, setPrefill] = useState({targetType:"LISTING",targetId:"",contentUrl:""});
  useEffect(()=>{const q=new URLSearchParams(window.location.search);setPrefill({targetType:q.get("type")||"LISTING",targetId:q.get("id")||"",contentUrl:q.get("url")||""});const ref=q.get("reference")||"";if(ref)setLookupReference(ref)},[]);
  const [identityException,setIdentityException]=useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lookupReference,setLookupReference]=useState("");
  const [lookupResult,setLookupResult]=useState<{status:string;decision?:string|null;decisionReason?:string|null;receivedAt?:string;decidedAt?:string|null}|null>(null);
  const [lookupError,setLookupError]=useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null);
    const form = new FormData(event.currentTarget);
    const payload = {
      reporterName: String(form.get("reporterName") || "") || undefined,
      reporterEmail: String(form.get("reporterEmail") || "") || undefined,
      identityException,
      targetType: String(form.get("targetType")),
      targetId: String(form.get("targetId")),
      contentUrl: String(form.get("contentUrl") || "") || undefined,
      legalBasis: String(form.get("legalBasis") || "") || undefined,
      explanation: String(form.get("explanation")),
      goodFaithDeclaration: form.get("goodFaithDeclaration") === "on",
    };
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "/api"}/dsa/notices`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) { setError("Le signalement n’a pas pu être enregistré. Vérifiez les informations fournies."); return; }
    setReference(data.notice.reference);setLookupReference(data.notice.reference);
    event.currentTarget.reset();
  }

  async function lookupNotice(){
    const ref=lookupReference.trim();if(!ref)return;setLookupError("");setLookupResult(null);
    const response=await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "/api"}/dsa/notices/${encodeURIComponent(ref)}`,{cache:"no-store"});
    const data=await response.json().catch(()=>({}));if(!response.ok){setLookupError(response.status===404?"Référence introuvable.":"Impossible de consulter le suivi pour le moment.");return}setLookupResult(data.notice??null);
  }

  return <><main className="shell" style={{ paddingBlock: 56, maxWidth: 820 }}>
    <p style={{ color: "#5b4cf0", fontWeight: 900, textTransform: "uppercase", fontSize: 12 }}>Digital Services Act</p>
    <h1 style={{ marginTop: 10 }}>Signaler un contenu potentiellement illicite</h1>
    <p style={{ marginTop: 12, color: "#6c6c7d", lineHeight: 1.7 }}>Ce formulaire est distinct d’un simple signalement communautaire. Il peut être utilisé sans compte et donne une référence de suivi.</p>
    {reference && <div style={{ marginTop: 20, padding: 18, borderRadius: 16, background: "#eaf8f1", color: "#12694f" }}><strong>Signalement reçu.</strong><br />Référence : {reference}</div>}
    {error && <div style={{ marginTop: 20, color: "#b42318" }}>{error}</div>}
    <form onSubmit={submit} style={{ display: "grid", gap: 16, marginTop: 28 }}>
      <label>Nom ou raison sociale<input name="reporterName" required={!identityException} disabled={identityException} style={{ display: "block", width: "100%", marginTop: 7, padding: 13, border: "1px solid #ddd", borderRadius: 12 }} /></label>
      <label>Email de contact<input name="reporterEmail" type="email" required={!identityException} disabled={identityException} style={{ display: "block", width: "100%", marginTop: 7, padding: 13, border: "1px solid #ddd", borderRadius: 12 }} /></label>
      <label style={{display:"flex",gap:10,alignItems:"flex-start",fontSize:12,color:"#656475"}}><input type="checkbox" checked={identityException} onChange={e=>setIdentityException(e.target.checked)}/> Exception DSA : ce signalement concerne une infraction visée aux articles 3 à 7 de la directive 2011/93/UE, pour laquelle le nom et l’e-mail ne sont pas exigés par l’article 16 du DSA.</label>
      <label>Type de contenu<select name="targetType" value={prefill.targetType} onChange={e=>setPrefill(v=>({...v,targetType:e.target.value}))} style={{ display: "block", width: "100%", marginTop: 7, padding: 13, border: "1px solid #ddd", borderRadius: 12 }}><option value="LISTING">Annonce</option><option value="USER">Utilisateur</option><option value="MESSAGE">Message</option><option value="STORE">Boutique</option><option value="OTHER">Autre</option></select></label>
      <label>Identifiant du contenu<input name="targetId" value={prefill.targetId} onChange={e=>setPrefill(v=>({...v,targetId:e.target.value}))} required style={{ display: "block", width: "100%", marginTop: 7, padding: 13, border: "1px solid #ddd", borderRadius: 12 }} /></label>
      <label>URL du contenu<input name="contentUrl" value={prefill.contentUrl} onChange={e=>setPrefill(v=>({...v,contentUrl:e.target.value}))} type="url" style={{ display: "block", width: "100%", marginTop: 7, padding: 13, border: "1px solid #ddd", borderRadius: 12 }} /></label>
      <label>Base juridique supposée (facultatif)<textarea name="legalBasis" rows={3} style={{ display: "block", width: "100%", marginTop: 7, padding: 13, border: "1px solid #ddd", borderRadius: 12 }} /></label>
      <label>Pourquoi ce contenu vous paraît-il illicite ?<textarea name="explanation" required minLength={20} rows={7} style={{ display: "block", width: "100%", marginTop: 7, padding: 13, border: "1px solid #ddd", borderRadius: 12 }} /></label>
      <label style={{ display: "flex", gap: 10, alignItems: "flex-start" }}><input name="goodFaithDeclaration" type="checkbox" required /> Je déclare de bonne foi que les informations fournies sont exactes et complètes à ma connaissance.</label>
      <button type="submit" style={{ border: 0, borderRadius: 999, padding: "14px 20px", background: "#5b4cf0", color: "white", fontWeight: 850, cursor: "pointer" }}>Envoyer le signalement</button>
    </form>
    <section style={{marginTop:36,padding:22,border:"1px solid #e5e4ed",borderRadius:18,background:"#fafafe"}}>
      <h2 style={{margin:0,fontSize:21}}>Suivre un signalement</h2>
      <p style={{color:"#6c6c7d",lineHeight:1.6}}>Saisissez la référence DSA reçue après votre signalement pour consulter son statut.</p>
      <div style={{display:"flex",gap:10,flexWrap:"wrap"}}><input aria-label="Référence DSA" value={lookupReference} onChange={e=>setLookupReference(e.target.value)} placeholder="DSA-…" style={{flex:"1 1 260px",padding:13,border:"1px solid #ddd",borderRadius:12}}/><button type="button" onClick={()=>void lookupNotice()} style={{border:0,borderRadius:999,padding:"12px 18px",background:"#27243b",color:"#fff",fontWeight:800,cursor:"pointer"}}>Consulter</button></div>
      {lookupError&&<p style={{color:"#b42318",fontWeight:700}}>{lookupError}</p>}
      {lookupResult&&<div style={{marginTop:16,padding:16,borderRadius:14,background:"#fff",border:"1px solid #e8e7ef"}}><strong>Statut : {({RECEIVED:"Reçu",UNDER_REVIEW:"En cours d’examen",ACTIONED:"Mesure prise",NO_ACTION:"Aucune mesure",CLOSED:"Traité"} as Record<string,string>)[lookupResult.status]??lookupResult.status}</strong>{lookupResult.decisionReason&&<p style={{marginBottom:0,color:"#59586a"}}>{lookupResult.decisionReason}</p>}</div>}
    </section>
  </main></>;
}
