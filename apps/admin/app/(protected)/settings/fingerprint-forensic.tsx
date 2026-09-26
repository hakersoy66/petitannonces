"use client";
import {useState} from "react";

type Match={mediaId:string;listingId:string;title:string|null;slug:string|null;status:string;version:number;matchRate:number;confidence:number;signal:number};
type Result={matched:boolean;candidateCount:number;image:{width:number;height:number;channels:number};best:Match|null;matches:Match[]};

export function FingerprintForensic(){
 const[busy,setBusy]=useState(false),[result,setResult]=useState<Result|null>(null),[error,setError]=useState("");
 async function verify(file?:File){
  if(!file)return;setBusy(true);setResult(null);setError("");
  try{
   if(file.size>15*1024*1024)throw new Error("Le fichier dépasse 15 Mo.");
   const type=file.type||"image/jpeg";
   const r=await fetch("/api/admin/media/fingerprint/verify",{method:"POST",credentials:"include",headers:{"content-type":type},body:file});
   const p=await r.json().catch(()=>({})) as Result&{error?:string};
   if(!r.ok)throw new Error(p.error||"forensic_verify_failed");
   setResult(p);
  }catch(e){setError(String(e).replace("Error: ",""))}finally{setBusy(false)}
 }
 return <section className="admin-card admin-section" style={{marginTop:16}}>
  <div className="admin-section-head"><div><h2>Vérification forensic des images</h2><p>Analyse le fingerprint invisible Petit Annonces et recherche l’annonce d’origine.</p></div><span className="admin-badge">Fingerprint v2</span></div>
  <div className="admin-field"><label>Image suspecte</label><input type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif" disabled={busy} onChange={e=>void verify(e.target.files?.[0])}/><small>Le fichier est analysé côté serveur, sans modifier l’original.</small></div>
  {busy&&<div className="admin-flash">Analyse de l’empreinte invisible…</div>}
  {error&&<div className="admin-flash err">Analyse impossible : {error}</div>}  {result&&<div style={{display:"grid",gap:12,marginTop:14}}>
   <div className={"admin-flash "+(result.matched?"ok":"err")}><strong>{result.matched?"Empreinte Petit Annonces détectée":"Aucune correspondance fiable"}</strong><span>{result.image.width}×{result.image.height} · {result.candidateCount.toLocaleString("fr-FR")} médias comparés</span></div>
   {result.best&&<div className="admin-card" style={{padding:14}}><small>Meilleure correspondance</small><h3 style={{margin:"6px 0"}}>{result.best.title||"Annonce sans titre"}</h3><p style={{margin:"0 0 10px"}}>Media {result.best.mediaId} · v{result.best.version} · {(result.best.matchRate*100).toFixed(1)}% bits concordants · confiance {(result.best.confidence*100).toFixed(0)}%</p><a className="admin-btn" href={"/listings/"+result.best.listingId}>Ouvrir l’annonce</a></div>}
   {result.matches.length>1&&<div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Annonce</th><th>Version</th><th>Match</th><th>Confiance</th></tr></thead><tbody>{result.matches.map(m=><tr key={m.mediaId+"-"+m.version}><td><a href={"/listings/"+m.listingId}>{m.title||m.listingId}</a></td><td>v{m.version}</td><td>{(m.matchRate*100).toFixed(1)}%</td><td>{(m.confidence*100).toFixed(0)}%</td></tr>)}</tbody></table></div>}
  </div>}
 </section>;
}
