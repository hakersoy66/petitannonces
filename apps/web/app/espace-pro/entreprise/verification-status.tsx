import styles from "./page.module.css";

type Company={legalName:string;siret:string|null;siren:string|null;verifiedAt?:string|null};
type Receipt={kind:string;createdAt:string};
type Props={verified:boolean;business:Company|null;documents:Receipt[];dueAt?:string|null;graceActive?:boolean};

export function VerificationStatus({verified,business,documents,dueAt,graceActive}:Props){
 const lastReceipt=documents.length?new Date(Math.max(...documents.map(d=>new Date(d.createdAt).getTime()))):null;
 return <main className={styles.statusPanel}>
  <div className={verified?styles.statusGlowVerified:styles.statusGlowPending} aria-hidden="true"/>
  <div className={verified?styles.statusSymbolVerified:styles.statusSymbolPending} aria-hidden="true">
   {verified?<svg viewBox="0 0 48 48" fill="none" width="37" height="37"><path d="M10 24l10 10 19-21" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"/></svg>
    :<svg viewBox="0 0 48 48" fill="none" width="36" height="36"><path d="M12 6h18l8 8v26H12V6Z" stroke="currentColor" strokeWidth="2.8" strokeLinejoin="round"/><path d="M30 6v9h8M18 25l5 5 9-10" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
  </div>
  <span className={verified?styles.statusEyebrowVerified:styles.statusEyebrowPending}>{verified?"COMPTE PROFESSIONNEL ACTIF":"DOSSIER REÇU · VÉRIFICATION EN COURS"}</span>
  <h2 className={styles.statusTitle}>{verified?"Votre entreprise est vérifiée !":"Merci ! Nous avons bien reçu vos documents."}</h2>
  <p className={styles.statusDescription}>{verified
   ?"Votre compte professionnel est validé. Votre badge Pro est actif : vous n’avez aucune nouvelle vérification à effectuer."
   :"Votre dossier est complet et a bien été transmis à notre équipe. Nous vérifions les informations de votre entreprise et l’autorisation de son représentant. Vous n’avez rien d’autre à envoyer pour le moment."}</p>
  {verified?<div className={styles.statusDetails}>
    <div><span>Entreprise vérifiée</span><strong>{business?.legalName||"Votre entreprise"}</strong></div>
    <div><span>SIRET / SIREN enregistré</span><strong>{business?.siret||business?.siren||"—"}</strong></div>
    <div><span>Statut du compte</span><strong className={styles.statusActive}>● Actif et vérifié</strong></div>
   </div>
   :<>
    <ol className={styles.statusSteps}>
      <li className={styles.statusStepDone}><span className={styles.statusStepMark}>✓</span><div><strong>Documents reçus</strong><small>Dossier complet</small></div></li>
      <li className={styles.statusStepCurrent}><span className={styles.statusStepMark}>2</span><div><strong>Contrôle en cours</strong><small>Par notre équipe</small></div></li>
      <li><span className={styles.statusStepMark}>3</span><div><strong>Décision</strong><small>Validation du compte Pro</small></div></li>
    </ol>
    <div className={styles.statusReceipt}>
      <strong>Vos justificatifs ont bien été enregistrés</strong>
      <div className={styles.statusReceiptItems}>
       <span>✓ Kbis / RNE</span><span>✓ Identité / autorisation</span>
      </div>
      {lastReceipt&&<small>Dernier document reçu le {lastReceipt.toLocaleDateString("fr-FR",{timeZone:"Europe/Paris",day:"2-digit",month:"long",year:"numeric"})}</small>}
    </div>
    {dueAt&&<p className={styles.statusGrace}>{graceActive
      ?"Votre période de transition reste active pendant l’examen de votre dossier."
      :"La période de transition est terminée : vos annonces déjà publiées restent visibles, mais les nouvelles publications nécessitent la validation de votre compte."}</p>}
   </>}
  <div className={styles.statusActions}>
    <a className={styles.statusPrimaryLink} href="/espace-pro">Retour à mon espace Pro <span aria-hidden="true">→</span></a>
    <a className={styles.statusSecondaryLink} href="/espace-pro/annonces">Gérer mes annonces</a>
  </div>
  <p className={styles.statusFooter}>{verified
   ?"Vous pouvez utiliser votre compte professionnel normalement. Pour modifier les informations légales vérifiées, contactez notre équipe."
   :"Vous pouvez revenir sur cette page pour suivre le statut du dossier. Merci pour votre confiance !"}
  </p>
 </main>
}
