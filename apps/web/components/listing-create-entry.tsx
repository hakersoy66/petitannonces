"use client";
import dynamic from "next/dynamic";
import {useEffect,useState} from "react";
import {AppIcon} from "./app-icon";
import styles from "./listing-create-entry.module.css";

function WizardLoading(){return <div className={styles.wizardLoading} role="status"><span/><strong>Préparation de votre annonce…</strong><small>Chargement du formulaire sécurisé.</small></div>}
const ListingWizard=dynamic(()=>import("./listing-wizard").then(module=>module.ListingWizard),{loading:WizardLoading});

type EntryMode="choose"|"import"|"manual";

export function ListingCreateEntry({initialListingId,initialMode,initialResumeStep,initialCategorySlug}:{initialListingId?:string;initialMode?:string;initialResumeStep?:number;initialCategorySlug?:string}){
 const initial:EntryMode=initialListingId||initialMode==="manual"?"manual":initialMode==="import"?"import":"choose";
 const [entryMode,setEntryMode]=useState<EntryMode>(initial);
 const [launchingManual,setLaunchingManual]=useState(false);
 const [navigationError,setNavigationError]=useState("");
 useEffect(()=>{
  if(entryMode==="import"){
   const target="/importer-une-annonce?from=create-entry";
   const fallback=window.setTimeout(()=>{
    if(window.location.pathname==="/deposer-une-annonce"){
     setEntryMode("choose");setLaunchingManual(false);setNavigationError("La page d’import n’a pas pu s’ouvrir. Touchez de nouveau « Importer une annonce ».");
    }
   },4500);
   window.location.replace(target);
   return()=>window.clearTimeout(fallback);
  }
  if(entryMode==="manual")return;
  const warm=()=>void import("./listing-wizard");
  if(typeof window.requestIdleCallback==="function"){const id=window.requestIdleCallback(warm,{timeout:1800});return()=>window.cancelIdleCallback(id)}
  const id=window.setTimeout(warm,1000);return()=>window.clearTimeout(id);
 },[entryMode]);
 function openManual(){setNavigationError("");setLaunchingManual(true);window.requestAnimationFrame(()=>window.requestAnimationFrame(()=>setEntryMode("manual")))}
 function openImport(){setNavigationError("");setLaunchingManual(true);setEntryMode("import")}
 if(entryMode==="manual")return <ListingWizard initialListingId={initialListingId} initialResumeStep={initialResumeStep} initialCategorySlug={initialCategorySlug}/>;
 if(launchingManual)return <WizardLoading/>;
 if(entryMode==="import")return <WizardLoading/>;
 return <section className={styles.card}>
  <div className={styles.icon}><AppIcon name="sparkles"/></div>
  <span className={styles.kicker}>Déposer une annonce</span>
  <h2>Comment souhaitez-vous commencer ?</h2>
  <p>Choisissez simplement entre créer une nouvelle annonce ou importer une annonce que vous avez déjà publiée ailleurs.</p>
  {navigationError&&<div className={styles.helper} role="alert"><AppIcon name="info"/><span>{navigationError}</span></div>}
  <div className={styles.choiceGrid}>
   <button type="button" className={`${styles.choiceCard} ${styles.newChoice}`} onClick={openManual}><span className={styles.choiceIcon}><AppIcon name="plus"/></span><div><strong>Créer une nouvelle annonce</strong><small>Commencez de zéro avec notre wizard en 6 étapes : catégorie, photos, détails, prix, visibilité et publication.</small></div><span className={styles.choiceArrow}><AppIcon name="arrow-right"/></span></button>
   <button type="button" className={`${styles.choiceCard} ${styles.importChoice}`} onClick={openImport}><span className={styles.choiceIcon}><AppIcon name="share"/></span><div><strong>Importer une annonce</strong><small>Importez votre propre annonce depuis Leboncoin, Vinted ou un autre site public compatible.</small></div><span className={styles.choiceArrow}><AppIcon name="arrow-right"/></span></button>
  </div>
  <div className={styles.helper}><AppIcon name="shield"/><span>Dans les deux cas, vous pourrez vérifier et modifier toutes les informations avant publication.</span></div>
 </section>;
}
