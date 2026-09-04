"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ListingCommerceForm } from "./listing-commerce-form";
import { ListingPhotoUploader } from "./listing-photo-uploader";
import { ListingPublicationReview } from "./listing-publication-review";
import styles from "./listing-wizard.module.css";

type Category = { id:string; name:string; slug:string; domain:string; children?:Category[] };
type CategoryTreeResponse = { categories: Category[] };
type DraftResponse = { listing: { id:string; category:{ id:string; name:string; slug:string; domain:string } } };

const STEPS = ["Catégorie", "Détails", "Photos", "Prix & livraison", "Vérification"];
const api = () => (process.env.NEXT_PUBLIC_API_URL ?? "/api").replace(/\/$/, "");

export function ListingWizard({ initialListingId }: { initialListingId?: string }) {
  const [step,setStep]=useState(initialListingId?2:0);
  const [categories,setCategories]=useState<Category[]>([]);
  const [selected,setSelected]=useState<Category|null>(null);
  const [listingId,setListingId]=useState(initialListingId??"");
  const [title,setTitle]=useState("");
  const [description,setDescription]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [plate,setPlate]=useState("");
  const [plateMessage,setPlateMessage]=useState("");
  const [vehicle,setVehicle]=useState<Record<string,unknown>|null>(null);

  useEffect(()=>{
    fetch(`${api()}/categories/tree`,{credentials:"include"})
      .then(async r=>{if(!r.ok) throw new Error("categories_failed"); return r.json() as Promise<CategoryTreeResponse>})
      .then(p=>setCategories(p.categories))
      .catch(()=>setError("Impossible de charger les catégories."));
  },[]);

  const leaves=useMemo(()=>{
    const out:Category[]=[];
    const walk=(items:Category[])=>items.forEach(c=>c.children?.length?walk(c.children):out.push(c));
    walk(categories); return out;
  },[categories]);

  async function createDraft(){
    if(!selected) return;
    setBusy(true);setError("");
    try{
      const r=await fetch(`${api()}/listings/drafts`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({categoryId:selected.id})});
      if(r.status===401){window.location.href=`/connexion?next=${encodeURIComponent("/deposer-une-annonce")}`;return}
      const p=await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(p.error??"draft_failed");
      const data=p as DraftResponse;setListingId(data.listing.id);setStep(1);
      window.history.replaceState(null,"",`/deposer-une-annonce?listingId=${encodeURIComponent(data.listing.id)}`);
    }catch{setError("Impossible de créer le brouillon. Vérifiez votre connexion puis réessayez.")}finally{setBusy(false)}
  }

  async function saveBasics(e:FormEvent){
    e.preventDefault(); if(!listingId)return;
    setBusy(true);setError("");
    try{
      const r=await fetch(`${api()}/listings/${encodeURIComponent(listingId)}/basics`,{method:"PATCH",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({title,description})});
      const p=await r.json().catch(()=>({}));if(!r.ok)throw new Error(p.error??"basics_failed");setStep(2);
    }catch{setError("Impossible d’enregistrer les détails. Le titre doit faire au moins 5 caractères et la description 20 caractères.")}finally{setBusy(false)}
  }

  async function lookupPlate(){
    if(!listingId||!plate.trim())return;setBusy(true);setPlateMessage("");
    try{
      const r=await fetch(`${api()}/listings/${encodeURIComponent(listingId)}/vehicle/from-plate`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({registrationPlate:plate})});
      const p=await r.json().catch(()=>({}));
      if(!r.ok){const code=p.error;throw new Error(code??"vehicle_lookup_failed")}
      setVehicle(p.vehicle??null);setPlateMessage("Véhicule identifié et informations enregistrées.");
    }catch(err){const code=err instanceof Error?err.message:"vehicle_lookup_failed";setPlateMessage(code==="vehicle_data_provider_not_configured"?"Le fournisseur de données véhicule n’est pas encore configuré.":code==="vehicle_not_found"?"Aucun véhicule trouvé pour cette plaque.":code==="invalid_registration_plate"?"Format de plaque invalide.":"Recherche de plaque indisponible.")}finally{setBusy(false)}
  }

  return <div className={styles.wizard}>
    <ol className={styles.steps}>{STEPS.map((label,i)=><li key={label} className={i===step?styles.current:i<step?styles.done:""}><span>{i<step?"✓":i+1}</span><b>{label}</b></li>)}</ol>
    {error&&<div className={styles.error}>{error}</div>}

    {step===0&&<section className={styles.panel}>
      <div className={styles.head}><span>Étape 1 sur 5</span><h2>Choisissez la catégorie la plus précise</h2><p>Une fois la catégorie choisie, un vrai brouillon sera créé et les étapes suivantes pourront enregistrer vos données.</p></div>
      <div className={styles.categoryGrid}>{leaves.map(c=><button type="button" key={c.id} className={selected?.id===c.id?styles.selected:""} onClick={()=>setSelected(c)}><strong>{c.name}</strong><small>{c.domain}</small></button>)}</div>
      <div className={styles.nav}><span/><button type="button" disabled={!selected||busy} onClick={()=>void createDraft()}>{busy?"Création…":"Continuer"}</button></div>
    </section>}

    {step===1&&<section className={styles.panel}>
      <div className={styles.head}><span>Étape 2 sur 5</span><h2>Décrivez votre annonce</h2><p>Un titre clair et une description détaillée améliorent la confiance et la visibilité.</p></div>
      <form className={styles.form} onSubmit={saveBasics}><label>Titre<input value={title} onChange={e=>setTitle(e.target.value)} minLength={5} maxLength={120} required placeholder="Ex. iPhone 15 Pro 256 Go"/></label><label>Description<textarea value={description} onChange={e=>setDescription(e.target.value)} minLength={20} maxLength={12000} required placeholder="Décrivez l’état, les caractéristiques et les informations utiles…"/></label>
      {selected?.domain==="VEHICLE"&&<div className={styles.plateBox}><div><strong>Pré-remplir avec la plaque</strong><p>La plaque n’est pas affichée publiquement.</p></div><div className={styles.plateRow}><input value={plate} onChange={e=>setPlate(e.target.value.toUpperCase())} placeholder="AB-123-CD" aria-label="Plaque d'immatriculation"/><button type="button" onClick={()=>void lookupPlate()} disabled={busy||plate.trim().length<5}>Identifier</button></div>{plateMessage&&<small>{plateMessage}</small>}{vehicle&&<div className={styles.vehicleResult}>{["make","model","version","fuel","modelYear"].map(k=>vehicle[k]?<span key={k}>{String(vehicle[k])}</span>:null)}</div>}</div>}
      <div className={styles.nav}><button type="button" className={styles.back} onClick={()=>setStep(0)}>Retour</button><button disabled={busy}>{busy?"Enregistrement…":"Continuer"}</button></div></form>
    </section>}

    {step===2&&<section className={styles.panel}><div className={styles.head}><span>Étape 3 sur 5</span><h2>Ajoutez vos photos</h2><p>Choisissez plusieurs photos depuis la galerie. La caméra reste disponible via le sélecteur du téléphone, sans ouverture forcée.</p></div><ListingPhotoUploader listingId={listingId}/><div className={styles.nav}><button type="button" className={styles.back} onClick={()=>setStep(1)}>Retour</button><button type="button" onClick={()=>setStep(3)}>Continuer</button></div></section>}

    {step===3&&<section className={styles.panel}><div className={styles.head}><span>Étape 4 sur 5</span><h2>Prix et modes de remise</h2><p>Configurez votre prix, la remise en main propre et les options de livraison.</p></div><ListingCommerceForm listingId={listingId}/><div className={styles.nav}><button type="button" className={styles.back} onClick={()=>setStep(2)}>Retour</button><button type="button" onClick={()=>setStep(4)}>Continuer</button></div></section>}

    {step===4&&<section className={styles.panel} id="verification"><div className={styles.head}><span>Étape 5 sur 5</span><h2>Vérifiez puis envoyez en modération</h2><p>Contrôlez les informations avant publication.</p></div><ListingPublicationReview listingId={listingId}/><div className={styles.nav}><button type="button" className={styles.back} onClick={()=>setStep(3)}>Retour</button><a href="/mon-compte/annonces">Mes annonces</a></div></section>}
  </div>;
}
