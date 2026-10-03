import { AppIcon } from "./app-icon";
import styles from "./vehicle-warranty-card.module.css";

type VehicleWarranty={commercialOffered:boolean;commercialMonths:number|null;commercialCoverage:string|null;commercialProvider:string|null};
export function VehicleWarrantyCard({warranty}:{warranty:VehicleWarranty|null}){
 return <section className={styles.wrapper} aria-labelledby="warranty-title">
   <div className={styles.title}><span><AppIcon name="shield"/></span><h2 id="warranty-title">Garanties incluses</h2></div>
   <details className={styles.details} open>
     <summary><strong>Garanties légales</strong><span>24 mois <AppIcon name="chevron-down"/></span></summary>
     <div className={styles.content}>
       <p>Protections légales pour un achat effectué par un consommateur auprès d’un vendeur professionnel, dans les conditions prévues par la loi.</p>
       <div className={styles.item}><AppIcon name="check"/><div><strong>Garantie légale de conformité</strong><span>Défauts de conformité existant à la délivrance du véhicule. Délai de 2 ans ; pour l’occasion, présomption d’antériorité pendant 12 mois.</span></div></div>
       <div className={styles.item}><AppIcon name="check"/><div><strong>Garantie contre les vices cachés</strong><span>Défauts cachés graves présents lors de la vente, sous réserve des conditions légales propres à cette garantie.</span></div></div>
       <a href="https://www.economie.gouv.fr/dgccrf/les-fiches-pratiques/les-garanties-legales-de-conformite-et-contre-les-vices-caches" target="_blank" rel="noopener noreferrer">En savoir plus sur les garanties légales <AppIcon name="arrow-right"/></a>
     </div>
   </details>
   {warranty?.commercialOffered&&warranty.commercialMonths&&warranty.commercialCoverage&&<details className={styles.details}>
     <summary><strong>Garantie commerciale complémentaire</strong><span>{warranty.commercialMonths} mois <AppIcon name="chevron-down"/></span></summary>
     <div className={styles.content}>
       <p>Garantie annoncée par le vendeur, distincte de vos droits légaux.</p>
       {warranty.commercialProvider&&<p><strong>Organisme :</strong> {warranty.commercialProvider}</p>}
       <div className={styles.item}><AppIcon name="check"/><div><strong>Couverture communiquée par le vendeur</strong><span className={styles.coverage}>{warranty.commercialCoverage}</span></div></div>
       <small>Vérifiez les exclusions, plafonds, conditions et documents contractuels directement auprès du professionnel avant l’achat.</small>
     </div>
   </details>}
 </section>;
}
