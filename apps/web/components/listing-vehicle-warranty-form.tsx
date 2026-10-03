"use client";
import { AppIcon } from "./app-icon";
import styles from "./listing-vehicle-warranty-form.module.css";

export type VehicleWarrantyDraft={
  commercialOffered:boolean;
  commercialMonths:string;
  commercialCoverage:string;
  commercialProvider:string;
};
export const emptyVehicleWarranty:VehicleWarrantyDraft={
  commercialOffered:false,commercialMonths:"12",commercialCoverage:"",commercialProvider:"",
};
type Props={value:VehicleWarrantyDraft;onChange:(value:VehicleWarrantyDraft)=>void;showErrors?:boolean};

export function ListingVehicleWarrantyForm({value,onChange,showErrors=false}:Props){
  const patch=(changes:Partial<VehicleWarrantyDraft>)=>onChange({...value,...changes});
  return <section className={styles.section} aria-labelledby="vehicle-warranty-heading">
    <div className={styles.heading}>
      <span className={styles.icon}><AppIcon name="shield"/></span>
      <div><strong id="vehicle-warranty-heading">Garanties du véhicule</strong>
        <p>Vendeur professionnel · informations visibles sur votre annonce</p></div>
    </div>
    <div className={styles.legal}>
      <div><AppIcon name="circle-check"/><strong>Garanties légales</strong><b>24 mois*</b></div>
      <p>La garantie légale de conformité et la garantie des vices cachés s’appliquent de plein droit, selon leurs conditions, aux achats d’un consommateur auprès d’un professionnel.</p>
      <small>* La conformité peut être invoquée pendant 2 ans après la délivrance. Sur un véhicule d’occasion, les défauts sont présumés antérieurs à la vente durant les 12 premiers mois.</small>
    </div>
    <fieldset className={styles.fieldset}>
      <legend>Proposez-vous une garantie commerciale supplémentaire ?</legend>
      <label className={styles.radio}><input type="radio" name="vehicle-commercial-warranty" checked={!value.commercialOffered} onChange={()=>patch({commercialOffered:false})}/><span>Non, garanties légales uniquement</span></label>
      <label className={styles.radio}><input type="radio" name="vehicle-commercial-warranty" checked={value.commercialOffered} onChange={()=>patch({commercialOffered:true})}/><span>Oui, une garantie commerciale est incluse</span></label>
    </fieldset>
    {value.commercialOffered&&<div className={styles.extra}>
      <div className={styles.two}>
        <label>Durée de la garantie supplémentaire *
          <select value={value.commercialMonths} onChange={e=>patch({commercialMonths:e.target.value})}>
            {[3,6,12,18,24,36,48,60].map(months=><option key={months} value={months}>{months} mois</option>)}
          </select>
        </label>
        <label>Organisme garant (facultatif)
          <input maxLength={120} value={value.commercialProvider} onChange={e=>patch({commercialProvider:e.target.value})} placeholder="Garage, assureur ou organisme…"/>
        </label>
      </div>
      <label>Éléments couverts et principales exclusions *
        <textarea rows={3} maxLength={1200} value={value.commercialCoverage} onChange={e=>patch({commercialCoverage:e.target.value})} placeholder="Ex. moteur et boîte de vitesses ; précisez les exclusions et conditions…"/>
        <small>{value.commercialCoverage.trim().length}/1200 caractères · Soyez précis et ne promettez que la couverture réellement souscrite.</small>
        {showErrors&&value.commercialCoverage.trim().length<10&&<em role="alert">Précisez les éléments couverts (10 caractères minimum).</em>}
      </label>
    </div>}
    <p className={styles.note}><AppIcon name="info"/>La garantie commerciale est facultative et ne remplace jamais les garanties légales. Les conditions définitives doivent être communiquées à l’acheteur.</p>
  </section>;
}
