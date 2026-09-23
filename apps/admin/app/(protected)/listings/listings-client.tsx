"use client";

import{useEffect,useState}from"react";
import{AdminIcon}from"../../../components/admin-icon";

type Store={id:string;name:string;status:string};
type L={
 id:string;slug:string|null;title:string|null;description:string|null;status:string;priceMinor:number|null;currency:string;
 sellerEmail:string;sellerName:string;categoryId:string;category:string;domain:string;city:string|null;postalCode:string|null;
 region:string|null;storeId:string|null;sellerStores:Store[];coverUrl:string|null;createdAt:string;publishedAt:string|null
};
type Cat={id:string;name:string;parentId:string|null};

const money=(n:number|null,c="EUR")=>n==null?"—":new Intl.NumberFormat("fr-FR",{style:"currency",currency:c}).format(n/100);
const labels:Record<string,string>={DRAFT:"Brouillon",PENDING:"En modération",PUBLISHED:"Publiée",SUSPENDED:"Suspendue",SOLD:"Vendue",EXPIRED:"Expirée"};
const tone=(s:string)=>s==="PUBLISHED"?"green":s==="SUSPENDED"?"red":s==="PENDING"?"orange":"";

export default function ListingsClient(){
 const[rows,setRows]=useState<L[]>([]);
 const[cats,setCats]=useState<Cat[]>([]);
 const[q,setQ]=useState("");
 const[status,setStatus]=useState("");
 const[busy,setBusy]=useState(false);
 const[msg,setMsg]=useState("");
 const[edit,setEdit]=useState<L|null>(null);
 const[form,setForm]=useState<any>(null);
 const[selected,setSelected]=useState<string[]>([]);
 const[statusAction,setStatusAction]=useState<{ids:string[];next:"PUBLISHED"|"SUSPENDED"|"EXPIRED";reason:string}|null>(null);
 const[deleteAction,setDeleteAction]=useState<{listing:L;reason:string;confirmation:string;busy:boolean}|null>(null);

 async function load(){
  setBusy(true);
  try{
   const sp=new URLSearchParams();if(q)sp.set("q",q);if(status)sp.set("status",status);
   const[r,c]=await Promise.all([
    fetch(`/api/admin/listings${sp.size?`?${sp}`:""}`,{credentials:"include",cache:"no-store"}),
    fetch("/api/admin/categories",{credentials:"include",cache:"no-store"})
   ]);
   const p=await r.json().catch(()=>({listings:[]}));const cp=await c.json().catch(()=>({categories:[]}));
   setRows(p.listings??[]);setCats(cp.categories??[]);
  }finally{setBusy(false)}
 }
 useEffect(()=>{void load()},[]);
 useEffect(()=>{const onPointerDown=(event:PointerEvent)=>{const target=event.target as Node|null;document.querySelectorAll<HTMLDetailsElement>(".admin-popover[open]").forEach(menu=>{if(target&&!menu.contains(target))menu.removeAttribute("open")})};document.addEventListener("pointerdown",onPointerDown);return()=>document.removeEventListener("pointerdown",onPointerDown)},[]);
 function closeMenus(){document.querySelectorAll<HTMLDetailsElement>(".admin-popover[open]").forEach(menu=>menu.removeAttribute("open"))}

 function openEdit(l:L){closeMenus();setEdit(l);setForm({title:l.title??"",description:l.description??"",price:l.priceMinor==null?"":String(l.priceMinor/100),city:l.city??"",postalCode:l.postalCode??"",region:l.region??"",categoryId:l.categoryId,storeId:l.storeId??""})}
 async function save(){
  if(!edit||!form)return;
  const r=await fetch(`/api/admin/listings/${edit.id}`,{method:"PATCH",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({title:form.title,description:form.description,price:form.price===""?null:Number(form.price),city:form.city||null,postalCode:form.postalCode||null,region:form.region||null,categoryId:form.categoryId,storeId:form.storeId||null})});
  const p=await r.json().catch(()=>({}));
  setMsg(r.ok?"Annonce modifiée.":p.error==="store_not_owned_by_seller"?"La vitrine sélectionnée n’appartient pas au vendeur.":"Impossible de modifier l’annonce.");
  if(r.ok){setEdit(null);await load()}
 }
 function openBulk(next:"PUBLISHED"|"SUSPENDED"|"EXPIRED"){if(!selected.length)return;setStatusAction({ids:selected,next,reason:next==="PUBLISHED"?"Validation administrative groupée":"Décision administrative groupée"})}
 function openSingle(l:L,next:"PUBLISHED"|"SUSPENDED"|"EXPIRED"){closeMenus();setStatusAction({ids:[l.id],next,reason:next==="PUBLISHED"?"Validation administrative":"Décision administrative"})}
 async function applyStatus(){
  if(!statusAction||statusAction.reason.trim().length<5){setMsg("Saisissez un motif d’au moins 5 caractères.");return}
  const a=statusAction;
  if(a.ids.length>1){
   const r=await fetch("/api/admin/listings/bulk-status",{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({ids:a.ids,status:a.next,reason:a.reason})});
   const p=await r.json().catch(()=>({}));
   setMsg(r.ok?`${p.updated} annonce(s) mises à jour.`:"Action groupée impossible.");
   if(r.ok){setSelected([]);setStatusAction(null);await load()}return;
  }
  const r=await fetch(`/api/admin/listings/${a.ids[0]}/status`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({status:a.next,reason:a.reason})});
  setMsg(r.ok?"Annonce mise à jour.":"Action impossible.");
  if(r.ok){setStatusAction(null);await load()}
 }
 async function deleteListing(){
  if(!deleteAction)return;
  const reason=deleteAction.reason.trim();
  if(reason.length<5){setMsg("Saisissez un motif de suppression d’au moins 5 caractères.");return}
  if(deleteAction.confirmation!=="SUPPRIMER"){setMsg("Tapez SUPPRIMER pour confirmer.");return}
  setDeleteAction({...deleteAction,busy:true});
  const r=await fetch(`/api/admin/listings/${deleteAction.listing.id}`,{method:"DELETE",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({reason,confirmation:"SUPPRIMER"})});
  const p=await r.json().catch(()=>({}));
  if(r.ok){setMsg("Annonce supprimée définitivement.");setDeleteAction(null);setSelected(v=>v.filter(id=>id!==deleteAction.listing.id));await load();return}
  setDeleteAction({...deleteAction,busy:false});
  setMsg(p.error==="listing_has_orders"?"Cette annonce possède une commande : elle ne peut pas être supprimée. Suspendez-la si nécessaire.":"Suppression impossible.");
 }

 return <>
  <div className="admin-page-head">
   <div><p>Marketplace</p><h1>Annonces</h1><span className="subtitle">Une gestion plus claire du catalogue : contenu, statut, vendeur, localisation et actions sensibles au même endroit.</span></div>
   <div className="admin-page-actions"><a className="admin-btn primary" href="/moderation"><AdminIcon name="shield"/>File de modération</a></div>
  </div>

  {msg&&<div className="admin-flash ok">{msg}</div>}

  <section className="admin-card admin-section admin-management-surface">
   <div className="admin-toolbar admin-toolbar-modern">
    <div className="admin-search-shell"><AdminIcon name="search"/><input className="admin-input admin-search" value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")void load()}} placeholder="Titre, ville ou vendeur…"/></div>
    <select className="admin-select admin-filter-select" value={status} onChange={e=>setStatus(e.target.value)}><option value="">Tous les statuts</option>{Object.keys(labels).map(x=><option key={x} value={x}>{labels[x]}</option>)}</select>
    <button type="button" className="admin-btn primary" onClick={()=>void load()} disabled={busy}>{busy?"Chargement…":"Filtrer"}</button>
   </div>

   {selected.length>0&&<div className="admin-selection-bar">
    <div><span className="admin-selection-check"><AdminIcon name="check"/></span><div><strong>{selected.length} annonce(s) sélectionnée(s)</strong><small>Appliquez une action groupée sans ouvrir chaque annonce.</small></div></div>
    <div className="admin-selection-actions">
     <button type="button" className="admin-btn success" onClick={()=>openBulk("PUBLISHED")}><AdminIcon name="check"/>Publier</button>
     <button type="button" className="admin-btn danger" onClick={()=>openBulk("SUSPENDED")}><AdminIcon name="warning"/>Suspendre</button>
     <button type="button" className="admin-btn" onClick={()=>openBulk("EXPIRED")}><AdminIcon name="clock"/>Expirer</button>
     <button type="button" className="admin-icon-button" onClick={()=>setSelected([])}>×</button>
    </div>
   </div>}

   <div className="admin-table-wrap admin-table-modern-wrap">
    <table className="admin-table admin-table-modern admin-mobile-cards admin-listings-table">
     <thead><tr><th><input type="checkbox" checked={rows.length>0&&selected.length===rows.length} onChange={e=>setSelected(e.target.checked?rows.map(x=>x.id):[])}/></th><th>Annonce</th><th>Prix</th><th>Statut</th><th>Catégorie</th><th>Vendeur</th><th>Localisation</th><th></th></tr></thead>
     <tbody>
      {rows.map(l=><tr key={l.id}>
       <td data-mobile-select><input type="checkbox" checked={selected.includes(l.id)} onChange={e=>setSelected(v=>e.target.checked?[...new Set([...v,l.id])]:v.filter(x=>x!==l.id))}/></td>
       <td data-label="Annonce" data-mobile-primary>
        <a className="admin-listing-cell" href={`/listings/${l.id}`}>
         {l.coverUrl?<img className="thumb" src={l.coverUrl} alt=""/>:<span className="thumb admin-thumb-empty"><AdminIcon name="list"/></span>}
         <span><strong>{l.title||"Sans titre"}</strong><small>#{l.id.slice(-8).toUpperCase()} · {new Date(l.createdAt).toLocaleDateString("fr-FR")}</small></span>
        </a>
       </td>
       <td data-label="Prix"><strong className="admin-price-cell">{money(l.priceMinor,l.currency)}</strong></td>
       <td data-label="Statut"><span className={`admin-badge ${tone(l.status)}`}>{labels[l.status]??l.status}</span></td>
       <td data-label="Catégorie"><div className="admin-cell-stack"><strong>{l.category}</strong><small>{l.domain}</small></div></td>
       <td data-label="Vendeur"><div className="admin-cell-stack"><strong>{l.sellerName}</strong><small>{l.sellerEmail}</small></div></td>
       <td data-label="Localisation"><div className="admin-location-cell"><strong>{l.city||"—"}</strong><small>{l.postalCode||l.region||""}</small></div></td>
       <td data-label="Actions" data-mobile-actions>
        <details className="admin-popover admin-action-popover">
         <summary className="admin-icon-button" aria-label="Actions annonce">•••</summary>
         <div className="admin-popover-panel admin-action-panel">
          <a href={`/listings/${l.id}`} onClick={closeMenus}><AdminIcon name="list"/><span><strong>Ouvrir le détail</strong><small>Voir tout le dossier de l’annonce</small></span></a>
          <button type="button" onClick={()=>openEdit(l)}><AdminIcon name="edit"/><span><strong>Modifier</strong><small>Contenu, prix et localisation</small></span></button>
          {l.slug&&l.status==="PUBLISHED"&&<a target="_blank" href={`https://petitannonces.fr/annonce/${l.slug}`} onClick={closeMenus}><AdminIcon name="external"/><span><strong>Voir sur le site</strong><small>Ouvrir l’annonce publique</small></span></a>}
          {l.status!=="PUBLISHED"&&l.status!=="PENDING"&&<button type="button" onClick={()=>openSingle(l,"PUBLISHED")}><AdminIcon name="check"/><span><strong>Publier</strong><small>Rendre l’annonce active</small></span></button>}
          {l.status!=="SUSPENDED"&&<button type="button" onClick={()=>openSingle(l,"SUSPENDED")}><AdminIcon name="warning"/><span><strong>Suspendre</strong><small>Retirer temporairement de la diffusion</small></span></button>}
          {l.status!=="EXPIRED"&&<button type="button" onClick={()=>openSingle(l,"EXPIRED")}><AdminIcon name="clock"/><span><strong>Expirer</strong><small>Clôturer la diffusion</small></span></button>}
          <div className="admin-menu-separator"/>
          <button type="button" className="danger" onClick={()=>{closeMenus();setDeleteAction({listing:l,reason:"Suppression administrative",confirmation:"",busy:false})}}><AdminIcon name="warning"/><span><strong>Supprimer définitivement</strong><small>Action irréversible</small></span></button>
         </div>
        </details>
       </td>
      </tr>)}
      {!rows.length&&<tr><td colSpan={8}><div className="admin-empty">Aucune annonce trouvée.</div></td></tr>}
     </tbody>
    </table>
   </div>
  </section>

  {edit&&form&&<div className="admin-modal-backdrop" onMouseDown={()=>setEdit(null)}>
   <section className="admin-card admin-modal admin-modal-wide" onMouseDown={e=>e.stopPropagation()}>
    <div className="admin-modal-head"><div><span className="admin-modal-icon"><AdminIcon name="edit"/></span><div><h2>Modifier l’annonce</h2><p>{edit.sellerName} · {edit.sellerEmail}</p></div></div><button type="button" className="admin-icon-button" onClick={()=>setEdit(null)}>×</button></div>
    <div className="admin-form-grid admin-form-modern">
     <label style={{gridColumn:"1/-1"}}>Titre<input className="admin-input" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></label>
     <label style={{gridColumn:"1/-1"}}>Description<textarea className="admin-textarea" rows={7} value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label>
     <label>Prix (€)<input className="admin-input" type="number" min="0" step="0.01" value={form.price} onChange={e=>setForm({...form,price:e.target.value})}/></label>
     <label>Catégorie<select className="admin-select" value={form.categoryId} onChange={e=>setForm({...form,categoryId:e.target.value})}>{cats.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
     <label>Code postal<input className="admin-input" value={form.postalCode} onChange={e=>setForm({...form,postalCode:e.target.value})}/></label>
     <label>Ville<input className="admin-input" value={form.city} onChange={e=>setForm({...form,city:e.target.value})}/></label>
     <label>Région<input className="admin-input" value={form.region} onChange={e=>setForm({...form,region:e.target.value})}/></label>
     <label>Vitrine<select className="admin-select" value={form.storeId} onChange={e=>setForm({...form,storeId:e.target.value})}><option value="">Aucune vitrine</option>{edit.sellerStores.map(s=><option key={s.id} value={s.id}>{s.name} ({s.status})</option>)}</select></label>
    </div>
    <div className="admin-modal-actions"><button type="button" className="admin-btn" onClick={()=>setEdit(null)}>Annuler</button><button type="button" className="admin-btn primary" onClick={()=>void save()}>Enregistrer</button></div>
   </section>
  </div>}

  {statusAction&&<div className="admin-modal-backdrop" onMouseDown={()=>setStatusAction(null)}>
   <section className="admin-card admin-modal" onMouseDown={e=>e.stopPropagation()}>
    <div className="admin-modal-head"><div><span className={`admin-modal-icon ${statusAction.next==="SUSPENDED"?"danger":statusAction.next==="PUBLISHED"?"success":""}`}><AdminIcon name={statusAction.next==="SUSPENDED"?"warning":statusAction.next==="PUBLISHED"?"check":"clock"}/></span><div><h2>Changer le statut</h2><p>{statusAction.ids.length} annonce(s) · {labels[statusAction.next]}</p></div></div><button type="button" className="admin-icon-button" onClick={()=>setStatusAction(null)}>×</button></div>
    <label className="admin-field"><span>Motif</span><textarea className="admin-textarea" rows={4} value={statusAction.reason} onChange={e=>setStatusAction({...statusAction,reason:e.target.value})}/><small>Le motif sera conservé dans l’historique administratif.</small></label>
    <div className="admin-modal-actions"><button type="button" className="admin-btn" onClick={()=>setStatusAction(null)}>Annuler</button><button type="button" className={`admin-btn ${statusAction.next==="SUSPENDED"?"danger":"primary"}`} onClick={()=>void applyStatus()}>Confirmer</button></div>
   </section>
  </div>}

  {deleteAction&&<div className="admin-modal-backdrop" onMouseDown={()=>!deleteAction.busy&&setDeleteAction(null)}>
   <section className="admin-card admin-modal" onMouseDown={e=>e.stopPropagation()}>
    <div className="admin-modal-head"><div><span className="admin-modal-icon danger"><AdminIcon name="warning"/></span><div><h2>Supprimer définitivement l’annonce</h2><p>{deleteAction.listing.title||"Annonce sans titre"}</p></div></div><button type="button" className="admin-icon-button" disabled={deleteAction.busy} onClick={()=>setDeleteAction(null)}>×</button></div>
    <div className="admin-flash err">Cette action est irréversible. Une annonce liée à une commande restera protégée afin de conserver l’historique financier.</div>
    <label className="admin-field"><span>Motif</span><textarea className="admin-textarea" rows={4} value={deleteAction.reason} onChange={e=>setDeleteAction({...deleteAction,reason:e.target.value})}/></label>
    <label className="admin-field" style={{marginTop:12}}><span>Confirmation</span><small>Tapez <strong>SUPPRIMER</strong></small><input className="admin-input" value={deleteAction.confirmation} onChange={e=>setDeleteAction({...deleteAction,confirmation:e.target.value.toUpperCase()})}/></label>
    <div className="admin-modal-actions"><button type="button" className="admin-btn" disabled={deleteAction.busy} onClick={()=>setDeleteAction(null)}>Annuler</button><button type="button" className="admin-btn danger" disabled={deleteAction.busy||deleteAction.confirmation!=="SUPPRIMER"||deleteAction.reason.trim().length<5} onClick={()=>void deleteListing()}>{deleteAction.busy?"Suppression…":"Supprimer définitivement"}</button></div>
   </section>
  </div>}
 </>;
}
