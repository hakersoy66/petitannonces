"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ListingCommerceForm } from "./listing-commerce-form";
import { ListingPhotoUploader } from "./listing-photo-uploader";
import { ListingPublicationReview } from "./listing-publication-review";
import styles from "./listing-wizard.module.css";

type Category = { id:string; name:string; slug:string; domain:string; children?:Category[] };
type CategoryTreeResponse = { categories: Category[] };
type DraftResponse = { listing: { id:string; category:{ id:string; name:string; slug:string; domain:string } } };
type VehicleFields = { make:string; model:string; version:string; modelYear:string; fuel:string; mileageKm:string };

const STEPS = ["Catégorie", "Détails", "Photos", "Prix & livraison", "Vérification"];
const api = () => (process.env.NEXT_PUBLIC_API_URL ?? "/api").replace(/\/$/, "");
const emptyVehicle:VehicleFields={make:"",model:"",version:"",modelYear:"",fuel:"",mileageKm:""};

function descendants(category: Category) {
  const out: Category[] = [];
  const walk = (items: Category[] = []) => items.forEach((item) => {
    out.push(item);
    if (item.children?.length) walk(item.children);
  });
  walk(category.children);
  return out;
}

export function ListingWizard({ initialListingId }: { initialListingId?: string }) {
  const [step,setStep]=useState(initialListingId?2:0);
  const [categories,setCategories]=useState<Category[]>([]);
  const [root,setRoot]=useState<Category|null>(null);
  const [selected,setSelected]=useState<Category|null>(null);
  const [listingId,setListingId]=useState(initialListingId??"");
  const [title,setTitle]=useState("");
  const [description,setDescription]=useState("");
  const [busy,setBusy]=useState(false);
  const [loadingCategories,setLoadingCategories]=useState(true);
  const [error,setError]=useState("");
  const [plate,setPlate]=useState("");
  const [plateMessage,setPlateMessage]=useState("");
  const [vehicle,setVehicle]=useState<VehicleFields>(emptyVehicle);

  useEffect(()=>{
    setLoadingCategories(true);
    fetch(`${api()}/categories/tree`,{credentials:"include"})
      .then(async r=>{if(!r.ok) throw new Error("categories_failed"); return r.json() as Promise<CategoryTreeResponse>})
      .then(p=>{setCategories(p.categories);setError("")})
      .catch(()=>setError("Impossible de charger les catégories. Réessayez dans quelques instants."))
      .finally(()=>setLoadingCategories(false));
  },[]);

  const subcategories=useMemo(()=>root?descendants(root):[],[root]);

  function chooseRoot(category:Category){
    setRoot(category);
    setSelected(category.children?.length ? null : category);
    setError("");
  }

  function chooseCategory(category:Category){
    setSelected(category);
    setError("");
  }

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
      const p=await r.json().catch(()=>({}));if(!r.ok)throw new Error(p.error??"basics_failed");
      if(selected?.domain==="VEHICLE"){
        const payload={make:vehicle.make.trim()||null,model:vehicle.model.trim()||null,version:vehicle.version.trim()||null,modelYear:vehicle.modelYear?Number(vehicle.modelYear):null,fuel:vehicle.fuel.trim()||null,mileageKm:vehicle.mileageKm?Number(vehicle.mileageKm):null};
        const vr=await fetch(`${api()}/listings/${encodeURIComponent(listingId)}/vehicle`,{method:"PUT",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
        if(!vr.ok) throw new Error("vehicle_save_failed");
      }
      setStep(2);
    }catch{setError("Impossible d’enregistrer les détails. Vérifiez le titre, la description et les informations du véhicule.")}finally{setBusy(false)}
  }

  async function lookupPlate(){
    if(!listingId||!plate.trim())return;setBusy(true);setPlateMessage("");
    try{
      const r=await fetch(`${api()}/listings/${encodeURIComponent(listingId)}/vehicle/from-plate`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({registrationPlate:plate})});
      const p=await r.json().catch(()=>({}));
      if(!r.ok){const code=p.error;throw new Error(code??"vehicle_lookup_failed")}
      const v=(p.vehicle??{}) as Record<string,unknown>;
      setVehicle(current=>({...current,make:typeof v.make==="string"?v.make:current.make,model:typeof v.model==="string"?v.model:current.model,version:typeof v.version==="string"?v.version:current.version,modelYear:typeof v.modelYear==="number"?String(v.modelYear):current.modelYear,fuel:typeof v.fuel==="string"?v.fuel:current.fuel}));
      setPlateMessage("Véhicule identifié. Vérifiez les informations pré-remplies ci-dessous.");
    }catch(err){const code=err instanceof Error?err.message:"vehicle_lookup_failed";setPlateMessage(code==="vehicle_data_provider_not_configured"?"Identification automatique indisponible pour le moment. Renseignez le véhicule manuellement ci-dessous.":code==="vehicle_not_found"?"Aucun véhicule trouvé. Vous pouvez saisir les informations manuellement.":code==="invalid_registration_plate"?"Format de plaque invalide.":"Recherche de plaque indisponible. Vous pouvez continuer manuellement.")}finally{setBusy(false)}
  }

  const setVehicleField=(key:keyof VehicleFields)=>(value:string)=>setVehicle(current=>({...current,[key]:value}));

  return <div className={styles.wizard}>
    <ol className={styles.steps}>{STEPS.map((label,i)=><li key={label} className={i===step?styles.current:i<step?styles.done:""}><span>{i<step?"✓":i+1}</span><b>{label}</b></li>)}</ol>
    {error&&<div className={styles.error}>{error}</div>}

    {step===0&&<section className={styles.panel}>
      <div className={styles.head}><span>Étape 1 sur 5</span><h2>Choisissez une catégorie</h2><p>Sélectionnez d’abord une grande catégorie, puis la catégorie la plus précise.</p></div>
      {loadingCategories?<div className={styles.loading}>Chargement des catégories…</div>:<>
        <div className={styles.rootGrid}>{categories.map(c=><button type="button" key={c.id} className={root?.id===c.id?styles.selectedRoot:""} onClick={()=>chooseRoot(c)}><strong>{c.name}</strong><small>{c.children?.length??0} sous-catégorie{(c.children?.length??0)>1?"s":""}</small></button>)}</div>
        {root&&root.children?.length?<div className={styles.subcategoryBlock}><div className={styles.subcategoryTitle}><strong>{root.name}</strong><span>Choisissez la catégorie précise</span></div><div className={styles.categoryGrid}>{subcategories.map(c=><button type="button" key={c.id} className={selected?.id===c.id?styles.selected:""} onClick={()=>chooseCategory(c)}><strong>{c.name}</strong><small>{c.domain}</small>{selected?.id===c.id&&<i>✓</i>}</button>)}</div></div>:null}
      </>}
      <div className={styles.nav}><span>{selected?`Sélection : ${selected.name}`:"Choisissez une catégorie pour continuer"}</span><button type="button" disabled={!selected||busy} onClick={()=>void createDraft()}>{busy?"Création…":"Continuer"}</button></div>
    </section>}

    {step===1&&<section className={styles.panel}>
      <div className={styles.head}><span>Étape 2 sur 5</span><h2>Décrivez votre annonce</h2><p>Un titre clair et une description détaillée améliorent la confiance et la visibilité.</p></div>
      <form className={styles.form} onSubmit={saveBasics}><label>Titre<input value={title} onChange={e=>setTitle(e.target.value)} minLength={5} maxLength={120} required placeholder="Ex. iPhone 15 Pro 256 Go"/></label><label>Description<textarea value={description} onChange={e=>setDescription(e.target.value)} minLength={20} maxLength={12000} required placeholder="Décrivez l’état, les caractéristiques et les informations utiles…"/></label>
      {selected?.domain==="VEHICLE"&&<div className={styles.plateBox}><div><strong>Identifier avec la plaque</strong><p>La plaque n’est jamais affichée publiquement. Si le service automatique n’est pas disponible, vous pouvez continuer manuellement.</p></div><div className={styles.plateRow}><input value={plate} onChange={e=>setPlate(e.target.value.toUpperCase())} placeholder="AB-123-CD" aria-label="Plaque d'immatriculation"/><button type="button" onClick={()=>void lookupPlate()} disabled={busy||plate.trim().length<5}>Identifier</button></div>{plateMessage&&<small>{plateMessage}</small>}
      <div className={styles.vehicleFields}><label>Marque<input value={vehicle.make} onChange={e=>setVehicleField("make")(e.target.value)} placeholder="Peugeot"/></label><label>Modèle<input value={vehicle.model} onChange={e=>setVehicleField("model")(e.target.value)} placeholder="3008"/></label><label>Version<input value={vehicle.version} onChange={e=>setVehicleField("version")(e.target.value)} placeholder="GT Hybrid"/></label><label>Année<input type="number" min="1900" max="2100" inputMode="numeric" value={vehicle.modelYear} onChange={e=>setVehicleField("modelYear")(e.target.value)} placeholder="2024"/></label><label>Énergie<input value={vehicle.fuel} onChange={e=>setVehicleField("fuel")(e.target.value)} placeholder="Essence, Diesel, Électrique…"/></label><label>Kilométrage<input type="number" min="0" max="5000000" inputMode="numeric" value={vehicle.mileageKm} onChange={e=>setVehicleField("mileageKm")(e.target.value)} placeholder="18400"/></label></div></div>}
      <div className={styles.nav}><button type="button" className={styles.back} onClick={()=>setStep(0)}>Retour</button><button disabled={busy}>{busy?"Enregistrement…":"Continuer"}</button></div></form>
    </section>}

    {step===2&&<section className={styles.panel}><div className={styles.head}><span>Étape 3 sur 5</span><h2>Ajoutez vos photos</h2><p>Choisissez plusieurs photos depuis la galerie. La caméra reste disponible via le sélecteur du téléphone, sans ouverture forcée.</p></div><ListingPhotoUploader listingId={listingId}/><div className={styles.nav}><button type="button" className={styles.back} onClick={()=>setStep(1)}>Retour</button><button type="button" onClick={()=>setStep(3)}>Continuer</button></div></section>}

    {step===3&&<section className={styles.panel}><div className={styles.head}><span>Étape 4 sur 5</span><h2>Prix et modes de remise</h2><p>Configurez votre prix, la remise en main propre et les options de livraison.</p></div><ListingCommerceForm listingId={listingId}/><div className={styles.nav}><button type="button" className={styles.back} onClick={()=>setStep(2)}>Retour</button><button type="button" onClick={()=>setStep(4)}>Continuer</button></div></section>}

    {step===4&&<section className={styles.panel} id="verification"><div className={styles.head}><span>Étape 5 sur 5</span><h2>Vérifiez puis envoyez en modération</h2><p>Contrôlez les informations avant publication.</p></div><ListingPublicationReview listingId={listingId}/><div className={styles.nav}><button type="button" className={styles.back} onClick={()=>setStep(3)}>Retour</button><a href="/mon-compte/annonces">Mes annonces</a></div></section>}
  </div>;
}
