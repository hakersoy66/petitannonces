"use client";

import {useEffect,useState} from "react";
import {AdminIcon} from "../../../components/admin-icon";

type U={
  id:string;email:string;kind:string;status:string;emailVerifiedAt:string|null;
  displayName:string|null;firstName?:string|null;lastName?:string|null;phone?:string|null;
  roles:string[];createdAt:string;
  reputation:{reviewCount:number;reviewAverage:number|null;completedSales:number;activeReports:number};
};

const ALL=["SUPER_ADMIN","ADMIN","MODERATOR","SUPPORT","FINANCE","COMPLIANCE","MARKETING"] as const;
const ROLE_META:Record<string,{label:string;description:string}>={
 SUPER_ADMIN:{label:"Super administrateur",description:"Accès complet à tous les réglages et actions sensibles."},
 ADMIN:{label:"Administrateur",description:"Gestion globale des comptes, annonces et opérations."},
 MODERATOR:{label:"Modération",description:"Validation, suspension et contrôle du contenu."},
 SUPPORT:{label:"Support",description:"Tickets, assistance utilisateur et suivi des demandes."},
 FINANCE:{label:"Finance",description:"Paiements, commandes, remboursements et litiges financiers."},
 COMPLIANCE:{label:"Conformité",description:"Signalements, obligations légales et contrôles de conformité."},
 MARKETING:{label:"Marketing",description:"Campagnes, croissance, analytics et communication."},
};
const statusLabel:Record<string,string>={ACTIVE:"Actif",SUSPENDED:"Suspendu",DELETED:"Supprimé",PENDING_VERIFICATION:"E-mail à vérifier"};
const kindLabel:Record<string,string>={PARTICULIER:"Particulier",PROFESSIONNEL:"Professionnel"};
const statusTone=(value:string)=>value==="ACTIVE"?"green":value==="SUSPENDED"?"red":value==="PENDING_VERIFICATION"?"orange":"";

export default function UsersClient(){
 const[rows,setRows]=useState<U[]>([]);
 const[q,setQ]=useState("");
 const[busy,setBusy]=useState(false);
 const[msg,setMsg]=useState("");
 const[edit,setEdit]=useState<U|null>(null);
 const[form,setForm]=useState<any>(null);
 const[statusAction,setStatusAction]=useState<{user:U;next:string;reason:string}|null>(null);

 async function load(){
  setBusy(true);
  try{
   const r=await fetch(`/api/admin/users${q?`?q=${encodeURIComponent(q)}`:""}`,{credentials:"include",cache:"no-store"});
   const p=await r.json().catch(()=>({users:[]}));
   setRows(p.users??[]);
  }finally{setBusy(false)}
 }
 useEffect(()=>{void load()},[]);
 useEffect(()=>{const onPointerDown=(event:PointerEvent)=>{const target=event.target as Node|null;document.querySelectorAll<HTMLDetailsElement>(".admin-popover[open]").forEach(menu=>{if(target&&!menu.contains(target))menu.removeAttribute("open")})};document.addEventListener("pointerdown",onPointerDown);return()=>document.removeEventListener("pointerdown",onPointerDown)},[]);
 function closeMenus(){document.querySelectorAll<HTMLDetailsElement>(".admin-popover[open]").forEach(menu=>menu.removeAttribute("open"))}

 function openEdit(u:U){
  closeMenus();
  setEdit(u);
  setForm({email:u.email,kind:u.kind,displayName:u.displayName??"",firstName:u.firstName??"",lastName:u.lastName??"",phone:u.phone??"",emailVerified:Boolean(u.emailVerifiedAt)});
 }
 async function save(){
  if(!edit||!form)return;
  const r=await fetch(`/api/admin/users/${edit.id}`,{method:"PATCH",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({...form,displayName:form.displayName||null,firstName:form.firstName||null,lastName:form.lastName||null,phone:form.phone||null})});
  const p=await r.json().catch(()=>({}));
  setMsg(r.ok?"Utilisateur mis à jour.":p.error==="email_already_used"?"Cette adresse e-mail est déjà utilisée.":"Impossible de modifier l’utilisateur.");
  if(r.ok){setEdit(null);await load()}
 }
 function openStatus(u:U,next:string){closeMenus();setStatusAction({user:u,next,reason:next==="ACTIVE"?"Réactivation administrative":"Décision administrative"})}
 async function status(){
  if(!statusAction||statusAction.reason.trim().length<5){setMsg("Saisissez un motif d’au moins 5 caractères.");return}
  const {user:u,next,reason}=statusAction;
  const r=await fetch(`/api/admin/users/${u.id}/status`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({status:next,reason})});
  setMsg(r.ok?"Statut utilisateur mis à jour.":"Impossible de modifier le statut.");
  if(r.ok){setStatusAction(null);await load()}
 }
 async function roles(u:U,role:string,checked:boolean){
  closeMenus();
  const next=checked?[...new Set([...u.roles,role])]:u.roles.filter(x=>x!==role);
  const r=await fetch(`/api/admin/users/${u.id}/roles`,{method:"PUT",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({roles:next})});
  setMsg(r.ok?"Rôles mis à jour.":"Modification des rôles refusée.");
  if(r.ok)await load();
 }

 return <>
  <div className="admin-page-head">
   <div><p>Comptes & accès</p><h1>Utilisateurs</h1><span className="subtitle">Pilotez les comptes, statuts, vérifications et accès administratifs depuis une vue plus compacte.</span></div>
   <div className="admin-page-actions"><span className="admin-badge"><AdminIcon name="users"/>{rows.length} compte(s)</span></div>
  </div>

  {msg&&<div className="admin-flash ok">{msg}</div>}

  <section className="admin-card admin-section admin-management-surface">
   <div className="admin-toolbar admin-toolbar-modern">
    <div className="admin-search-shell"><AdminIcon name="search"/><input className="admin-input admin-search" value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")void load()}} placeholder="Rechercher un nom ou un e-mail…"/></div>
    <button type="button" className="admin-btn primary" onClick={()=>void load()} disabled={busy}>{busy?"Recherche…":"Rechercher"}</button>
   </div>

   <div className="admin-table-wrap admin-table-modern-wrap">
    <table className="admin-table admin-table-modern admin-mobile-cards admin-users-table">
     <thead><tr><th>Utilisateur</th><th>Compte</th><th>Statut</th><th>Confiance</th><th>Rôles & accès</th><th></th></tr></thead>
     <tbody>
      {rows.map(u=>{
       const fullName=u.displayName||[u.firstName,u.lastName].filter(Boolean).join(" ")||"Sans nom";
       return <tr key={u.id}>
        <td data-label="Utilisateur" data-mobile-primary>
         <a className="admin-identity-cell" href={`/users/${u.id}`}>
          <span className="admin-identity-avatar">{fullName.slice(0,2).toUpperCase()}</span>
          <span><strong>{fullName}</strong><small>{u.email}</small></span>
         </a>
        </td>
        <td data-label="Compte"><div className="admin-cell-stack"><strong>{kindLabel[u.kind]??u.kind}</strong><small>{u.emailVerifiedAt?"E-mail vérifié":"E-mail à vérifier"}</small></div></td>
        <td data-label="Statut"><span className={`admin-badge ${statusTone(u.status)}`}><span className={`admin-status-dot ${u.status.toLowerCase().replace("_verification","")}`}/>{statusLabel[u.status]??u.status}</span></td>
        <td data-label="Confiance">
         <div className="admin-reputation-cell">
          <strong>{u.reputation.reviewAverage!=null?`★ ${u.reputation.reviewAverage.toFixed(1)}`:"—"}</strong>
          <small>{u.reputation.reviewCount} avis · {u.reputation.completedSales} ventes{u.reputation.activeReports? ` · ${u.reputation.activeReports} signalement(s)`:""}</small>
         </div>
        </td>
        <td data-label="Rôles & accès">
         <details className="admin-popover admin-role-popover">
          <summary><span className="admin-popover-summary-icon"><AdminIcon name="shield"/></span><span>{u.roles.length? `${u.roles.length} rôle(s)`:"Aucun rôle"}</span><span className="admin-popover-chevron">⌄</span></summary>
          <div className="admin-popover-panel admin-role-panel">
           <div className="admin-popover-title"><strong>Rôles administratifs</strong><small>{u.email}</small></div>
           <div className="admin-role-menu-list">
            {ALL.map(role=>{const meta=ROLE_META[role]??{label:role,description:"Accès administratif."};return <label key={role} className="admin-role-menu-item">
             <span><strong>{meta.label}</strong><small>{meta.description}</small></span>
             <input type="checkbox" checked={u.roles.includes(role)} onChange={e=>void roles(u,role,e.target.checked)}/>
            </label>})}
           </div>
          </div>
         </details>
        </td>
        <td data-label="Actions" data-mobile-actions>
         <details className="admin-popover admin-action-popover">
          <summary className="admin-icon-button" aria-label="Actions utilisateur">•••</summary>
          <div className="admin-popover-panel admin-action-panel">
           <a href={`/users/${u.id}`} onClick={closeMenus}><AdminIcon name="users"/><span><strong>Ouvrir le compte</strong><small>Voir l’activité complète</small></span></a>
           <button type="button" onClick={()=>openEdit(u)}><AdminIcon name="edit"/><span><strong>Modifier</strong><small>Profil et type de compte</small></span></button>
           {u.status!=="ACTIVE"
            ?<button type="button" onClick={()=>openStatus(u,"ACTIVE")}><AdminIcon name="check"/><span><strong>Activer</strong><small>Réactiver ce compte</small></span></button>
            :<button type="button" className="danger" onClick={()=>openStatus(u,"SUSPENDED")}><AdminIcon name="warning"/><span><strong>Suspendre</strong><small>Bloquer temporairement l’accès</small></span></button>}
          </div>
         </details>
        </td>
       </tr>
      })}
      {!rows.length&&<tr><td colSpan={6}><div className="admin-empty">Aucun utilisateur trouvé.</div></td></tr>}
     </tbody>
    </table>
   </div>
  </section>

  {edit&&form&&<div className="admin-modal-backdrop" onMouseDown={()=>setEdit(null)}>
   <section className="admin-card admin-modal" onMouseDown={e=>e.stopPropagation()}>
    <div className="admin-modal-head"><div><span className="admin-modal-icon"><AdminIcon name="edit"/></span><div><h2>Modifier l’utilisateur</h2><p>{edit.email}</p></div></div><button type="button" className="admin-icon-button" onClick={()=>setEdit(null)}>×</button></div>
    <div className="admin-form-grid admin-form-modern">
     <label>Nom affiché<input className="admin-input" value={form.displayName} onChange={e=>setForm({...form,displayName:e.target.value})}/></label>
     <label>E-mail<input className="admin-input" type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label>
     <label>Prénom<input className="admin-input" value={form.firstName} onChange={e=>setForm({...form,firstName:e.target.value})}/></label>
     <label>Nom<input className="admin-input" value={form.lastName} onChange={e=>setForm({...form,lastName:e.target.value})}/></label>
     <label>Téléphone<input className="admin-input" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></label>
     <label>Type de compte<select className="admin-select" value={form.kind} onChange={e=>setForm({...form,kind:e.target.value})}><option value="PARTICULIER">Particulier</option><option value="PROFESSIONNEL">Professionnel</option></select></label>
     <label className="admin-switch-row"><span><strong>E-mail vérifié</strong><small>Considérer cette adresse comme confirmée.</small></span><input type="checkbox" checked={form.emailVerified} onChange={e=>setForm({...form,emailVerified:e.target.checked})}/></label>
    </div>
    <div className="admin-modal-actions"><button type="button" className="admin-btn" onClick={()=>setEdit(null)}>Annuler</button><button type="button" className="admin-btn primary" onClick={()=>void save()}>Enregistrer</button></div>
   </section>
  </div>}

  {statusAction&&<div className="admin-modal-backdrop" onMouseDown={()=>setStatusAction(null)}>
   <section className="admin-card admin-modal" onMouseDown={e=>e.stopPropagation()}>
    <div className="admin-modal-head"><div><span className={`admin-modal-icon ${statusAction.next==="ACTIVE"?"success":"danger"}`}><AdminIcon name={statusAction.next==="ACTIVE"?"check":"warning"}/></span><div><h2>{statusAction.next==="ACTIVE"?"Activer l’utilisateur":"Suspendre l’utilisateur"}</h2><p>{statusAction.user.email}</p></div></div><button type="button" className="admin-icon-button" onClick={()=>setStatusAction(null)}>×</button></div>
    <label className="admin-field"><span>Motif</span><textarea className="admin-textarea" rows={4} value={statusAction.reason} onChange={e=>setStatusAction({...statusAction,reason:e.target.value})}/><small>Ce motif sera conservé dans l’historique administratif.</small></label>
    <div className="admin-modal-actions"><button type="button" className="admin-btn" onClick={()=>setStatusAction(null)}>Annuler</button><button type="button" className={`admin-btn ${statusAction.next==="ACTIVE"?"success":"danger"}`} onClick={()=>void status()}>Confirmer</button></div>
   </section>
  </div>}
 </>;
}
