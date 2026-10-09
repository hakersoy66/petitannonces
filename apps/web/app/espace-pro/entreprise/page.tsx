"use client";
import {FormEvent,useEffect,useState} from "react";
import {ProfessionalWorkspace} from "../../../components/professional-workspace";
import styles from "./page.module.css";
import {fetchWithRetry} from "../../../lib/fetch-resilient";
import {VerificationStatus} from "./verification-status";
type B={legalName:string;tradeName:string|null;siren:string|null;siret:string|null;vatNumber:string|null;legalForm:string|null;nafCode:string|null;headquartersAddress:string|null;headquartersPostalCode:string|null;headquartersCity:string|null;verificationStatus:string;verifiedAt?:string|null;lastRegistryCheckAt?:string|null};
function api(){return (process.env.NEXT_PUBLIC_API_URL??"/api").replace(/\/$/,"")}
export default function Entreprise(){
 const[b,setB]=useState<B|null>(null),[profileLoaded,setProfileLoaded]=useState(false),[busy,setBusy]=useState(false),[lookupBusy,setLookupBusy]=useState(false),[msg,setMsg]=useState(""),[quickId,setQuickId]=useState("");
 const[form,setForm]=useState({legalName:"",tradeName:"",siren:"",siret:"",vatNumber:"",legalForm:"",nafCode:"",headquartersAddress:"",headquartersPostalCode:"",headquartersCity:""});
 async function load(){let r:Response;try{r=await fetchWithRetry(`${api()}/pro/me`,{credentials:"include",cache:"no-store"},{timeoutMs:7000,retries:1})}catch{setMsg("Impossible de charger vos informations d’entreprise pour le moment.");setProfileLoaded(true);return}if(r.status===401){location.href="/connexion?next=%2Fespace-pro%2Fentreprise";return}if(!r.ok){setMsg("Impossible de charger vos informations d’entreprise pour le moment.");setProfileLoaded(true);return}const p=await r.json();if(p.professional?.kind!=="PROFESSIONNEL"){location.href="/professionnels";return}const x=p.professional.business as B|null;setB(x);setProfileLoaded(true);if(x)setForm({legalName:x.legalName??"",tradeName:x.tradeName??"",siren:x.siren??"",siret:x.siret??"",vatNumber:x.vatNumber??"",legalForm:x.legalForm??"",nafCode:x.nafCode??"",headquartersAddress:x.headquartersAddress??"",headquartersPostalCode:x.headquartersPostalCode??"",headquartersCity:x.headquartersCity??""})}
 useEffect(()=>{void load()},[]);function ch(k:keyof typeof form,v:string){setForm(x=>({...x,[k]:v}))}
 async function quickVerify(){const id=quickId.replace(/\D/g,"");if(![9,14].includes(id.length)){setMsg("Saisissez un SIRET à 14 chiffres (ou un SIREN à 9 chiffres).");return}setLookupBusy(true);setMsg("");try{const r=await fetch(`${api()}/pro/business/quick-verify`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({identifier:id})});const p=await r.json().catch(()=>({}));if(!r.ok){const labels:Record<string,string>={company_not_found:"Entreprise introuvable dans le registre public.",company_inactive:"Cette entreprise est indiquée comme inactive.",registry_unavailable:"Le registre public est momentanément indisponible.",invalid_identifier:"SIRET ou SIREN invalide."};setMsg(labels[p.error]??"La vérification n’a pas pu être effectuée.");return}setMsg("SIRET trouvé et actif. Pour obtenir le badge Pro, envoyez les justificatifs ci-dessous.");setQuickId("");await load()}finally{setLookupBusy(false)}}
 async function lookupCompany(){const id=(form.siret||form.siren).replace(/\D/g,"");if(![9,14].includes(id.length)){setMsg("Saisissez un SIREN à 9 chiffres ou un SIRET à 14 chiffres.");return}setLookupBusy(true);setMsg("");try{const r=await fetch(`${api()}/pro/business/lookup?identifier=${encodeURIComponent(id)}`,{credentials:"include",cache:"no-store"});const p=await r.json().catch(()=>({}));if(!r.ok){setMsg(p.error==="company_not_found"?"Entreprise introuvable dans les données publiques.":"Le registre des entreprises est momentanément indisponible.");return}const c=p.company??{};setForm(x=>({...x,legalName:c.legalName||x.legalName,tradeName:c.tradeName||x.tradeName,siren:c.siren||x.siren,siret:c.siret||x.siret,nafCode:c.nafCode||x.nafCode,legalForm:c.legalFormCode||x.legalForm,headquartersAddress:c.headquartersAddress||x.headquartersAddress,headquartersPostalCode:c.headquartersPostalCode||x.headquartersPostalCode,headquartersCity:c.headquartersCity||x.headquartersCity}));setMsg(c.active===false?"Entreprise trouvée mais indiquée comme inactive.":"Entreprise trouvée. Vérifiez les informations préremplies puis enregistrez-les.")}finally{setLookupBusy(false)}}
 async function save(e:FormEvent){e.preventDefault();setBusy(true);setMsg("");const payload=Object.fromEntries(Object.entries(form).map(([k,v])=>[k,v||undefined]));const r=await fetch(`${api()}/pro/business`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});const p=await r.json().catch(()=>({}));setBusy(false);if(!r.ok){const labels:Record<string,string>={invalid_siren:"SIREN invalide. Vérifiez les 9 chiffres.",invalid_siret:"SIRET invalide. Vérifiez les 14 chiffres.",siret_siren_mismatch:"Le SIRET ne correspond pas au SIREN saisi.",invalid_business:"Renseignez au minimum la raison sociale et un SIREN ou SIRET valide."};setMsg(labels[p.error]??"Impossible d’enregistrer les informations.");return}setMsg("Informations enregistrées.");await load()}
 async function verify(){setBusy(true);setMsg("");const r=await fetch(`${api()}/pro/business/verify`,{method:"POST",credentials:"include"});const p=await r.json().catch(()=>({}));setBusy(false);if(!r.ok){setMsg(p.error==="registry_unavailable"?"Le registre professionnel n’est pas disponible pour le moment.":"La vérification n’a pas pu être effectuée.");return}setMsg(p.registryValid?"SIRET actif. La vérification de votre identité et de votre autorisation reste nécessaire.":p.registryConfigured?"La vérification reste en attente.":"Le connecteur de registre n’est pas encore configuré.");await load()}
 const [docs,setDocs]=useState<Array<{id:string;kind:string;fileName:string;createdAt:string;applicantRole:string;applicantName:string}>>([]);
 const [docsLoaded,setDocsLoaded]=useState(false);
 const [docsError,setDocsError]=useState(false);
 const [rejection,setRejection]=useState<{reason:string;date:string;correctionKinds:string[]}|null>(null);
 const [reverify,setReverify]=useState<{status:string;dueAt:string;daysRemaining:number;graceActive:boolean}|null>(null);
 const [role,setRole]=useState<"LEGAL_REPRESENTATIVE"|"AUTHORIZED_EMPLOYEE">("LEGAL_REPRESENTATIVE");
 const [applicantName,setApplicantName]=useState("");
 const [uploading,setUploading]=useState(false);
 async function loadDocs(){
  try{
   const r=await fetch(api()+"/pro/business/verification",{credentials:"include",cache:"no-store"});
   if(r.status===401){location.href="/connexion?next=%2Fespace-pro%2Fentreprise";return}
   if(!r.ok)throw new Error("verification_status_unavailable");
   const x=await r.json();
   const items=Array.isArray(x.documents)?x.documents:[];
   setDocs(items);setReverify(x.reverification??null);setRejection(x.rejection??null);setDocsError(false);
   if(items[0]?.applicantName)setApplicantName(items[0].applicantName);
   if(["LEGAL_REPRESENTATIVE","AUTHORIZED_EMPLOYEE"].includes(items[0]?.applicantRole))setRole(items[0].applicantRole);
  }catch{setDocsError(true)}
  finally{setDocsLoaded(true)}
 }
 useEffect(()=>{void loadDocs()},[]);
 async function uploadDoc(kind:"REGISTRY"|"AUTHORITY",file?:File){
   if(!file)return;
   const name=applicantName.trim();
   if(name.length<4){setMsg("Indiquez le nom complet de la personne autorisée avant d’envoyer le document.");return}
   if(file.size>8*1024*1024||!["application/pdf","image/jpeg","image/png"].includes(file.type)){setMsg("Document PDF, JPG ou PNG de 8 Mo maximum requis.");return}
   setUploading(true);setMsg("");
   try{
     const r=await fetch(api()+"/pro/business/verification/documents",{method:"POST",credentials:"include",headers:{"content-type":"application/vnd.petitannonces.pro-document","x-document-kind":kind,"x-document-mime":file.type,"x-applicant-role":role,"x-applicant-name":encodeURIComponent(name)},body:file});
     const x=await r.json().catch(()=>({}));
     setMsg(r.ok?"Document reçu. Votre dossier est en attente de vérification humaine.":x.error==="document_limit_reached"?"Limite de documents atteinte. Contactez notre support.":"Envoi impossible, vérifiez le fichier ou vos informations.");
     if(r.ok){await loadDocs();await load();}
   }catch{setMsg("Connexion impossible pendant l’envoi. Réessayez.");}
   finally{setUploading(false)}
 }
 const verified=b?.verificationStatus==="VERIFIED";
 const dossierComplete=docs.some(d=>d.kind==="REGISTRY")&&docs.some(d=>d.kind==="AUTHORITY");
 if(!profileLoaded||!docsLoaded)return <ProfessionalWorkspace><div className={styles.shell}><section className={styles.verifyBox} role="status">Chargement du statut de vérification de votre entreprise…</section></div></ProfessionalWorkspace>;
 if(verified||(!docsError&&dossierComplete&&b?.verificationStatus==="PENDING"))
  return <ProfessionalWorkspace><div className={styles.shell}>
   <header className={styles.hero}><div><span>Compte professionnel</span><h1>Entreprise & vérification</h1><p>Suivez le statut de votre compte et de votre entreprise.</p></div><b className={styles.badge}>{verified?"✓ Compte vérifié":"En cours d’examen"}</b></header>
   <VerificationStatus verified={verified} business={b} documents={docs} dueAt={reverify?.dueAt} graceActive={reverify?.graceActive}/>
  </div></ProfessionalWorkspace>;
 if(docsError||(!b&&msg))return <ProfessionalWorkspace><div className={styles.shell}>
   <section className={styles.verifyBox} role="alert"><h2>Impossible de charger votre dossier</h2><p>Veuillez réessayer. Aucune nouvelle demande de vérification ne sera lancée.</p><button className={styles.button} type="button" onClick={()=>{void load();void loadDocs()}}>Réessayer</button></section>
  </div></ProfessionalWorkspace>;
 return <ProfessionalWorkspace><div className={styles.shell}><header className={styles.hero}><div><span>Compte professionnel</span><h1>Entreprise & vérification</h1><p>Une vérification simple d’abord. Les informations juridiques détaillées restent accessibles si nécessaire.</p></div><b className={styles.badge}>{verified?"✓ Vérifiée":b?.verificationStatus==="PENDING"?"En attente":"À compléter"}</b></header>{reverify?.status==="PENDING"&&<section className={styles.notice}><strong>Vérification professionnelle obligatoire</strong><p>Date limite : {new Date(reverify.dueAt).toLocaleDateString("fr-FR")}.</p><p>{reverify.graceActive?"Vos annonces restent publiables pendant les "+reverify.daysRemaining+" jour(s) restants.":"Délai dépassé : nouvelles annonces bloquées jusqu’à validation."}</p></section>}{msg&&<div className={styles.notice}>{msg}</div>}
 {b?.verificationStatus==="REJECTED"&&<section role="alert" className={styles.verifyBox} style={{borderColor:"#e7b6af",background:"#fff8f5"}}>
  <span style={{display:"inline-block",color:"#a43e36",fontSize:12,fontWeight:850,marginBottom:6}}>DOSSIER À CORRIGER</span>
  <h2 style={{margin:"0 0 10px",color:"#9d332c",fontSize:22}}>Votre vérification nécessite des corrections</h2>
  <p style={{margin:"0 0 12px",fontSize:14,lineHeight:1.7}}>Nous avons examiné votre demande, mais votre compte professionnel n’a pas pu être validé. Vous pouvez corriger les éléments ci-dessous et renvoyer votre dossier sans créer un nouveau compte.</p>
  {rejection?.reason&&<div style={{padding:13,background:"#fff",border:"1px solid #f1d8d1",borderRadius:12,marginBottom:12}}>
   <strong style={{display:"block",fontSize:13,marginBottom:5}}>Motif communiqué par notre équipe :</strong>
   <p style={{margin:0,fontSize:14,lineHeight:1.65,whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{rejection.reason}</p>
  </div>}
  <p style={{fontSize:13,margin:0}}>Justificatifs à transmettre : <strong>{!docs.some(d=>d.kind==="REGISTRY")?"Kbis / RNE":""}{!docs.some(d=>d.kind==="REGISTRY")&&!docs.some(d=>d.kind==="AUTHORITY")?" et ":""}{!docs.some(d=>d.kind==="AUTHORITY")?"Identité / mandat":""}</strong>. Les documents déjà acceptés sont conservés pour ce contrôle.</p>
 </section>}{verified&&<div className={styles.verified}><span>✓</span><div><strong>Votre entreprise est vérifiée</strong><small>Votre badge professionnel est actif et vos informations légales sont enregistrées.</small></div></div>}<section className={styles.summary}><article><small>Statut</small><strong>{verified?"Vérifiée":b?.verificationStatus==="REJECTED"?"Refusée · à corriger":b?.verificationStatus==="PENDING"?"En attente":"À compléter"}</strong></article><article><small>Identifiant</small><strong>{b?.siret||b?.siren||"Non renseigné"}</strong></article><article><small>Dernière vérification</small><strong>{b?.lastRegistryCheckAt?new Date(b.lastRegistryCheckAt).toLocaleDateString("fr-FR",{timeZone:"Europe/Paris"}):"Jamais"}</strong></article></section>{docs.length===0&&<section className={styles.verifyBox}><div className={styles.verifyBoxHead}><div><h2>Étape 1 · Vérifier le SIRET</h2><p>Nous contrôlons l’existence de l’entreprise dans le registre public. Cela ne suffit pas à activer le badge Pro.</p></div></div><div className={styles.verifyGrid}><label className={styles.label}>SIRET / SIREN<input className={styles.input} value={quickId} onChange={e=>setQuickId(e.target.value.replace(/\D/g,"").slice(0,14))} inputMode="numeric" placeholder="12345678901234"/></label><button type="button" className={styles.button} disabled={lookupBusy||busy||![9,14].includes(quickId.length)} onClick={()=>void quickVerify()}>{lookupBusy?"Vérification…":"Vérifier"}</button></div></section>}<section className={styles.verifyBox} style={{marginTop:16}}>
  <div className={styles.verifyBoxHead}><div><h2>Étape 2 · Documents et autorisation</h2>
    <p>Un numéro SIRET public ne prouve pas que vous représentez cette entreprise. Nos équipes vérifient les justificatifs avant toute activation.</p></div></div>
  {!verified ? <div style={{display:"grid",gap:14}}>
    <div className={styles.two}>
      <label className={styles.label}>Nom et prénom du demandeur
        <input className={styles.input} value={applicantName} onChange={e=>setApplicantName(e.target.value)} disabled={docs.length>0} maxLength={120} placeholder="Prénom et nom" /></label>
      <label className={styles.label}>Votre rôle
        <select className={styles.input} disabled={docs.length>0} value={role} onChange={e=>setRole(e.target.value as typeof role)}>
          <option value="LEGAL_REPRESENTATIVE">Dirigeant ou représentant légal</option>
          <option value="AUTHORIZED_EMPLOYEE">Salarié mandaté</option>
        </select></label>
    </div>
    <div className={styles.two}>
      {!docs.some(d=>d.kind==="REGISTRY")&&<label className={styles.label}>1. Extrait Kbis ou justificatif RNE
        <input className={styles.input} type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/jpeg,image/png" disabled={uploading} onChange={e=>void uploadDoc("REGISTRY",e.target.files?.[0])}/></label>}
      {!docs.some(d=>d.kind==="AUTHORITY")&&<label className={styles.label}>2. {role==="LEGAL_REPRESENTATIVE"?"Justificatif d’identité du dirigeant":"Mandat signé et justificatif d’identité du mandataire"}
        <input className={styles.input} type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/jpeg,image/png" disabled={uploading} onChange={e=>void uploadDoc("AUTHORITY",e.target.files?.[0])}/></label>}
    </div>
    <p style={{fontSize:13,opacity:.8}}>PDF, JPG ou PNG · 8 Mo maximum par document. Documents consultables uniquement par le personnel habilité. Les pièces refusées sont supprimées, les pièces conservées restent disponibles pendant le réexamen et sont supprimées à la validation. N’envoyez pas de documents par e-mail.</p>
    {docs.map(d=><div key={d.id} style={{padding:"10px 14px",border:"1px solid #ddd",borderRadius:12,fontSize:14}}>✓ {d.kind==="REGISTRY"?"Registre (Kbis/RNE)":"Autorisation / identité"} · reçu le {new Date(d.createdAt).toLocaleDateString("fr-FR")}</div>)}
    {docs.some(d=>d.kind==="REGISTRY")&&docs.some(d=>d.kind==="AUTHORITY")&&<p style={{fontWeight:700}}>Dossier complet, en attente de validation par notre équipe. Les nouvelles annonces sont bloquées après le délai de transition, jusqu’à approbation.</p>}
  </div>:<p>Votre entreprise et votre habilitation ont été validées par notre équipe.</p>}
</section>{docs.length===0&&<details className={styles.details}><summary>Informations légales détaillées</summary><form className={styles.form} onSubmit={save}><div className={styles.two}><label className={styles.label}>Raison sociale<input className={styles.input} value={form.legalName} onChange={e=>ch("legalName",e.target.value)} required/></label><label className={styles.label}>Nom commercial<input className={styles.input} value={form.tradeName} onChange={e=>ch("tradeName",e.target.value)}/></label></div><div className={styles.two}><label className={styles.label}>SIREN<input className={styles.input} value={form.siren} onChange={e=>ch("siren",e.target.value.replace(/\D/g,"").slice(0,9))} inputMode="numeric"/></label><label className={styles.label}>SIRET<input className={styles.input} value={form.siret} onChange={e=>ch("siret",e.target.value.replace(/\D/g,"").slice(0,14))} inputMode="numeric"/></label></div><div className={styles.two}><label className={styles.label}>N° TVA<input className={styles.input} value={form.vatNumber} onChange={e=>ch("vatNumber",e.target.value)}/></label><label className={styles.label}>Forme juridique<input className={styles.input} value={form.legalForm} onChange={e=>ch("legalForm",e.target.value)}/></label></div><div className={styles.two}><label className={styles.label}>Code NAF<input className={styles.input} value={form.nafCode} onChange={e=>ch("nafCode",e.target.value)}/></label><label className={styles.label}>Adresse du siège<input className={styles.input} value={form.headquartersAddress} onChange={e=>ch("headquartersAddress",e.target.value)}/></label></div><div className={styles.two}><label className={styles.label}>Code postal<input className={styles.input} value={form.headquartersPostalCode} onChange={e=>ch("headquartersPostalCode",e.target.value)}/></label><label className={styles.label}>Ville<input className={styles.input} value={form.headquartersCity} onChange={e=>ch("headquartersCity",e.target.value)}/></label></div><div className={styles.actions}><button type="button" className={`${styles.button} ${styles.secondary}`} disabled={lookupBusy||busy||(!form.siren&&!form.siret)} onClick={()=>void lookupCompany()}>Préremplir depuis le registre</button><button className={styles.button} disabled={busy}>{busy?"Enregistrement…":"Enregistrer"}</button><button type="button" className={`${styles.button} ${styles.secondary}`} disabled={busy||!b} onClick={()=>void verify()}>Relancer la vérification</button></div></form></details>}</div></ProfessionalWorkspace>
}
