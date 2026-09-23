"use client";
import {useEffect,useState} from "react";
import {ProfessionalWorkspace} from "../../../components/professional-workspace";
import {AppIcon} from "../../../components/app-icon";
import {fetchWithRetry} from "../../../lib/fetch-resilient";
import styles from "./page.module.css";

type Dashboard={
 user:{name:string;email:string;avatarUrl:string|null};
 business:{verificationStatus?:string;siret?:string|null;siren?:string|null;legalName?:string|null}|null;
 subscription:{status?:string;trialEndsAt?:string|null;currentPeriodEnd?:string|null;plan?:{name?:string;monthlyPriceMinor?:number}|null}|null;
 stats:{trustScore:number;reviewCount:number;verified:boolean;stores:number;activeListings:number};
};
function api(){return (process.env.NEXT_PUBLIC_API_URL??"/api").replace(/\/$/,"")}
function money(n?:number){return new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR",maximumFractionDigits:0}).format((n??0)/100)}
export default function ProAccountHub(){
 const[data,setData]=useState<Dashboard|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState("");
 useEffect(()=>{fetchWithRetry(`${api()}/pro/dashboard`,{credentials:"include",cache:"no-store"},{timeoutMs:7000,retries:1}).then(async r=>{if(r.status===401){location.href="/connexion?next=%2Fespace-pro%2Fcompte";return null}if(!r.ok)throw new Error();return r.json()}).then(p=>{if(p)setData(p)}).catch(()=>setError("Impossible de charger votre compte professionnel.")).finally(()=>setLoading(false))},[]);
 const verified=data?.business?.verificationStatus==="VERIFIED";
 const plan=data?.subscription?.plan;
 return <ProfessionalWorkspace summary={data}><div className={styles.shell}>
  <header className={styles.hero}><div><span>Compte professionnel</span><h1>Mon compte Pro</h1><p>Entreprise, paiements, réputation et abonnement réunis au même endroit.</p></div><a href="/espace-pro/entreprise"><AppIcon name="user-shield"/> Vérifier mon entreprise</a></header>
  {error?<div className={styles.error}>{error}</div>:loading?<div className={styles.loading}><i/><i/><i/><i/></div>:<>
   <section className={styles.summary}>
    <article><small>Entreprise</small><strong>{verified?"Vérifiée":"À compléter"}</strong><span>{data?.business?.legalName??data?.user.name??"Compte professionnel"}</span></article>
    <article><small>Abonnement</small><strong>{plan?.name??"Compte Pro"}</strong><span>{plan?.monthlyPriceMinor!=null?`${money(plan.monthlyPriceMinor)} / mois`:"Gérer mon offre"}</span></article>
    <article><small>Réputation</small><strong>{data?.stats.trustScore??0}/100</strong><span>{data?.stats.reviewCount??0} avis</span></article>
    <article><small>Activité</small><strong>{data?.stats.activeListings??0} annonce(s)</strong><span>{data?.stats.stores??0} boutique(s)</span></article>
   </section>
   {!verified&&<section className={styles.callout}><div><AppIcon name="user-shield"/></div><span><strong>Finalisez votre vérification professionnelle</strong><small>Un SIRET vérifié renforce la confiance et complète votre profil professionnel.</small></span><a href="/espace-pro/entreprise">Continuer</a></section>}
   <section className={styles.section}><div className={styles.sectionHead}><div><span>Paramètres essentiels</span><h2>Gérez votre compte sans chercher dans le menu</h2></div></div><div className={styles.grid}>
    <a href="/espace-pro/entreprise"><i><AppIcon name="user-shield"/></i><div><strong>Entreprise & vérification</strong><span>SIREN, SIRET, raison sociale, adresse et statut de vérification.</span></div><b>›</b></a>
    <a href="/mon-compte/paiements"><i><AppIcon name="credit-card"/></i><div><strong>IBAN & versements</strong><span>Coordonnées de paiement, versements vendeur et historique.</span></div><b>›</b></a>
    <a href="/mon-compte/reputation"><i><AppIcon name="star"/></i><div><strong>Réputation & badges</strong><span>Avis, score de confiance et badges visibles par vos clients.</span></div><b>›</b></a>
    <a href="/espace-pro/abonnement"><i><AppIcon name="briefcase"/></i><div><strong>Abonnement Pro</strong><span>Formule actuelle, facturation, changement ou gestion de l’offre.</span></div><b>›</b></a>
    <a href="/espace-pro/equipe"><i><AppIcon name="handshake"/></i><div><strong>Équipe & accès</strong><span>Collaborateurs, rôles et permissions de votre activité.</span></div><b>›</b></a>
    <a href="/assistance?category=PROFESSIONAL"><i><AppIcon name="comments"/></i><div><strong>Support professionnel</strong><span>Une question ou un problème ? Contactez l’assistance Pro.</span></div><b>›</b></a>
   </div></section>
   <section className={styles.identity}><div><small>Compte connecté</small><strong>{data?.user.name}</strong><span>{data?.user.email}</span></div><a href="/mon-compte/securite">Sécurité du compte →</a></section>
  </>}
 </div></ProfessionalWorkspace>
}
