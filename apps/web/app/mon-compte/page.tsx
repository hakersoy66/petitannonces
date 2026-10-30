"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AccountSidebar } from "../../components/account-sidebar";
import { AppIcon } from "../../components/app-icon";
import styles from "./page.module.css";
import { formatListingPrice } from "../../lib/listing-price";

type ListingStatus = "DRAFT" | "PENDING" | "PUBLISHED" | "SUSPENDED" | "SOLD" | "EXPIRED";
type DashboardData = {
  user: { id: string; email: string; kind: "PARTICULIER" | "PROFESSIONNEL"; displayName: string; avatarUrl: string | null };
  stats: { listings: Record<ListingStatus, number>; totalListings: number; unreadConversations: number; pendingOffers: number; unreadNotifications:number };
  profileHealth: { emailVerified:boolean; profileComplete:boolean; phoneVerified:boolean; defaultAddress:boolean; twoFactorEnabled:boolean; completion:number };
  recentListings: Array<{ id: string; title: string | null; slug: string | null; status: ListingStatus; priceMinor: number | null; currency: string; city: string | null; updatedAt: string; imageUrl?: string | null; category: { name: string; slug: string; domain: string }; property?: { transactionType?: string | null } | null }> ;
  stores: Array<{ id: string; name: string; slug: string; status: string; isVerified: boolean }>;
  commerce: { purchases:number; sales:number; active:number; creditBalanceMinor:number; creditCurrency:string };
};

const preview: DashboardData = {
  user: { id: "", email: "", kind: "PARTICULIER", displayName: "Mon compte", avatarUrl: null },
  stats: { listings: { DRAFT: 0, PENDING: 0, PUBLISHED: 0, SUSPENDED: 0, SOLD: 0, EXPIRED: 0 }, totalListings: 0, unreadConversations: 0, pendingOffers: 0, unreadNotifications: 0 },
  profileHealth:{emailVerified:false,profileComplete:false,phoneVerified:false,defaultAddress:false,twoFactorEnabled:false,completion:0},
  recentListings: [], stores: [], commerce:{purchases:0,sales:0,active:0,creditBalanceMinor:0,creditCurrency:"EUR"},
};

const statusLabels: Record<ListingStatus, string> = { DRAFT: "Brouillon", PENDING: "En vérification", PUBLISHED: "En ligne", SUSPENDED: "Suspendue", SOLD: "Vendue", EXPIRED: "Expirée" };
function apiBase() { return (process.env.NEXT_PUBLIC_API_URL ?? "/api").replace(/\/$/, ""); }
function modifiedLabel(value:string){const d=new Date(value);return Number.isNaN(d.getTime())?"Mise à jour récente":`Modifiée le ${new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"short",year:"numeric"}).format(d)}`}

export default function AccountDashboardPage() {
  const [data, setData] = useState<DashboardData>(preview); const [loading,setLoading]=useState(true); const [loadError,setLoadError]=useState(""); const [filter, setFilter] = useState<"ALL" | ListingStatus>("ALL"); const [actionMessage,setActionMessage]=useState("");
  const [actionListingId,setActionListingId]=useState<string|null>(null);
  const actionListing=data.recentListings.find(item=>item.id===actionListingId)??null;
  useEffect(()=>{if(!actionListingId)return;const prior=document.body.style.overflow;document.body.style.overflow="hidden";const onEscape=(event:KeyboardEvent)=>{if(event.key==="Escape")setActionListingId(null)};window.addEventListener("keydown",onEscape);return()=>{document.body.style.overflow=prior;window.removeEventListener("keydown",onEscape)}},[actionListingId]);
  async function refreshDashboard(){
    setLoadError("");
    const load=async()=>{
      const controller=new AbortController();
      const timer=window.setTimeout(()=>controller.abort(),7000);
      try{return await fetch(`${apiBase()}/account/dashboard`,{credentials:"include",cache:"no-store",signal:controller.signal})}
      finally{window.clearTimeout(timer)}
    };
    try{
      let response:Response;
      try{response=await load()}catch{await new Promise(resolve=>window.setTimeout(resolve,350));response=await load()}
      if(response.status===401){window.location.replace("/connexion?next=%2Fmon-compte");return}
      if(!response.ok)throw new Error("dashboard_unavailable");
      const payload=await response.json() as DashboardData;
      if(payload.user.kind==="PROFESSIONNEL"&&new URLSearchParams(window.location.search).get("mode")!=="particulier"){window.location.replace("/espace-pro");return}
      setData(payload);
    }catch{setLoadError("Impossible de charger votre espace pour le moment.")}finally{setLoading(false)}
  }
  useEffect(()=>{void refreshDashboard()},[]);
  async function changeListingStatus(id:string,status:ListingStatus){
    setActionMessage("");
    const response=await fetch(`${apiBase()}/account/listings/${encodeURIComponent(id)}/status`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({status})});
    if(!response.ok){setActionMessage("Impossible de modifier le statut de cette annonce.");return}
    await refreshDashboard();
  }
  async function deleteListing(id:string,title?:string|null){
    const label=title?.trim()||"cette annonce";
    if(!window.confirm(`Supprimer définitivement « ${label} » ? Cette action est irréversible.`))return;
    setActionMessage("");
    const response=await fetch(`${apiBase()}/account/listings/${encodeURIComponent(id)}`,{method:"DELETE",credentials:"include"});
    const payload=await response.json().catch(()=>({})) as {error?:string;message?:string};
    if(!response.ok){setActionMessage(payload.error==="listing_has_orders"?"Cette annonce est liée à une commande et doit être conservée dans l’historique de la transaction.":payload.message||"Impossible de supprimer cette annonce pour le moment.");return}
    await refreshDashboard();
    setActionMessage("Annonce supprimée définitivement.");
  }
  const listings = useMemo(() => (filter === "ALL" ? data.recentListings : data.recentListings.filter((listing) => listing.status === filter)).slice(0,6), [data.recentListings, filter]);
  const initials = data.user.displayName.slice(0, 2).toUpperCase();
  return <div className={styles.page}><main className={styles.shell}>
    <AccountSidebar/>
    <section className={styles.content}>{loading?<div className={styles.accountLoading}><div/><div/><div/></div>:loadError?<div className={styles.dashboardError}><span><AppIcon name="info"/></span><strong>Votre espace n’a pas pu être chargé.</strong><p>{loadError} Vérifiez votre connexion puis réessayez.</p><button type="button" onClick={()=>{setLoading(true);void refreshDashboard()}}>Réessayer</button></div>:<><div className={styles.hero}><div><span className={styles.eyebrow}>Mon compte</span><h1>Bonjour {data.user.displayName}</h1><p>Retrouvez vos annonces, messages, offres et activités au même endroit.</p></div><div className={styles.heroActions}><a className={styles.secondary} href="/recherche">Voir le site</a><a className={styles.primary} href="/deposer-une-annonce">+ Déposer une annonce</a></div></div>
      <nav className={styles.mobileQuickDock} aria-label="Actions rapides du compte"><a href="/deposer-une-annonce"><AppIcon name="plus"/><span>Déposer</span></a><a href="/messages"><AppIcon name="comments"/><span>Messages</span>{data.stats.unreadConversations>0&&<b>{data.stats.unreadConversations>99?"99+":data.stats.unreadConversations}</b>}</a><a href="/mon-compte/annonces"><AppIcon name="list"/><span>Annonces</span></a><a href="/mon-compte/notifications"><AppIcon name="bell"/><span>Alertes</span>{data.stats.unreadNotifications>0&&<b>{data.stats.unreadNotifications>99?"99+":data.stats.unreadNotifications}</b>}</a></nav>
      <div className={styles.statsGrid}><article><span className={styles.statIcon}><AppIcon name="list"/></span><div><small>Annonces en ligne</small><strong>{data.stats.listings.PUBLISHED}</strong><em>{data.stats.totalListings} au total</em></div></article><article><span className={styles.statIcon}><AppIcon name="comments"/></span><div><small>Messages non lus</small><strong>{data.stats.unreadConversations}</strong><em>À consulter</em></div></article><article><span className={styles.statIcon}><AppIcon name="handshake"/></span><div><small>Offres reçues</small><strong>{data.stats.pendingOffers}</strong><em>En attente de réponse</em></div></article><article><span className={styles.statIcon}><AppIcon name="bell"/></span><div><small>Notifications</small><strong>{data.stats.unreadNotifications}</strong><em>Non lues</em></div></article></div>
      <section className={styles.commerceOverview}><a href="/commandes"><span><AppIcon name="credit-card"/></span><div><small>Achats & ventes</small><strong>{data.commerce.purchases} achat(s) · {data.commerce.sales} vente(s)</strong><em>{data.commerce.active} transaction(s) en cours</em></div><i>›</i></a><a href="/mon-compte/portefeuille"><span><AppIcon name="wallet"/></span><div><small>Crédit Petit Annonces</small><strong>{new Intl.NumberFormat("fr-FR",{style:"currency",currency:data.commerce.creditCurrency}).format(data.commerce.creditBalanceMinor/100)}</strong><em>Utilisable pour vos services Petit Annonces</em></div><i>›</i></a></section>
      {data.stats.listings.EXPIRED > 0 && <a className={styles.renewalBanner} href="/mon-compte/annonces?status=EXPIRED"><span><strong>{data.stats.listings.EXPIRED} annonce{data.stats.listings.EXPIRED > 1 ? "s" : ""} expirée{data.stats.listings.EXPIRED > 1 ? "s" : ""}</strong><small>Votre première prolongation de 30 jours est gratuite. Retrouvez vos annonces à renouveler.</small></span><b>Renouveler →</b></a>}
      <div className={styles.mainGrid}><section className={styles.panel}><div className={styles.panelHeader}><div><span className={styles.eyebrow}>Mes annonces</span><h2>Mes annonces récentes</h2></div><a href="/mon-compte/annonces">Tout voir →</a></div><div className={styles.filters}>{(["PUBLISHED","ALL","PENDING","DRAFT","SOLD"] as const).map((item) => {const count=item==="ALL"?data.stats.totalListings:data.stats.listings[item];return <button type="button" key={item} aria-pressed={filter===item} onClick={()=>setFilter(item)} className={filter===item?styles.filterActive:undefined}><span>{item==="ALL"?"Toutes":statusLabels[item]}</span><b>{count}</b></button>})}</div>{actionMessage&&<div className={styles.actionNotice}>{actionMessage}</div>}<div className={styles.recentCards}>
  {listings.length===0?<div className={styles.empty}>Aucune annonce dans cette catégorie.</div>:listings.map(listing=>(
    <article className={styles.recentCard} key={listing.id}>
      <div className={styles.recentThumb}>
        {listing.imageUrl?<img src={listing.imageUrl} alt={listing.title??"Annonce"} width={96} height={74} loading="lazy"/>:<span>{listing.category.name.charAt(0)}</span>}
      </div>
      <div className={styles.recentInfo}>
        <div className={styles.recentHeading}>
          <div><small>{listing.category.name}</small><h3>{listing.title??"Annonce sans titre"}</h3></div>
          <span className={styles["recentStatus"+listing.status]}>{statusLabels[listing.status]}</span>
        </div>
        <strong className={styles.recentPrice}>{formatListingPrice(listing.priceMinor,listing.currency,{domain:listing.category.domain,transactionType:listing.property?.transactionType??null},"Prix non défini")}</strong>
        <div className={styles.recentMeta}><span>{listing.city??"France"}</span><span>{modifiedLabel(listing.updatedAt)}</span></div>
      </div>
      <div className={styles.recentActions}>
        {listing.status==="PUBLISHED"&&listing.slug&&<a className={styles.recentPrimary} href={"/annonce/"+listing.slug}>Voir l’annonce</a>}
        {listing.status==="DRAFT"&&<a className={styles.recentPrimary} href={"/deposer-une-annonce?listingId="+encodeURIComponent(listing.id)}>Continuer</a>}
        {listing.status==="SUSPENDED"&&<a className={styles.recentPrimary} href={"/deposer-une-annonce?listingId="+encodeURIComponent(listing.id)}>Corriger</a>}
        {listing.status==="EXPIRED"&&<a className={styles.recentPrimary} href={"/mon-compte/annonces?status=EXPIRED&listingId="+encodeURIComponent(listing.id)}>Prolonger l’annonce</a>}
        {listing.status==="PENDING"&&<span className={styles.recentState}>En cours de vérification</span>}
        {listing.status==="SOLD"&&<span className={styles.recentState}>Annonce vendue</span>}
        <button type="button" className={styles.recentMore} aria-label={"Actions pour "+(listing.title??"cette annonce")} aria-haspopup="dialog" aria-expanded={actionListingId===listing.id} onClick={()=>setActionListingId(listing.id)}>
          <svg viewBox="0 0 24 24" fill="currentColor" width="21" height="21" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>
        </button>
      </div>
    </article>
  ))}
</div></section>
        <aside className={styles.rightColumn}><section className={`${styles.panel} ${styles.quickPanel}`}><div className={styles.panelHeader}><div><span className={styles.eyebrow}>Raccourcis</span><h2>Actions rapides</h2></div></div><div className={styles.quickLinks}><a href="/deposer-une-annonce"><span><AppIcon name="plus"/></span><div><strong>Créer une annonce</strong><small>Publier en quelques minutes</small></div><i>›</i></a><a href="/mon-compte/annonces"><span><AppIcon name="list"/></span><div><strong>Gérer mes annonces</strong><small>Modifier, mettre en pause ou marquer vendue</small></div><i>›</i></a><a href="/messages"><span><AppIcon name="comments"/></span><div><strong>Répondre aux messages</strong><small>{data.stats.unreadConversations} conversation(s) à lire</small></div><i>›</i></a><a href="/mon-compte/notifications"><span><AppIcon name="bell"/></span><div><strong>Voir mes notifications</strong><small>{data.stats.unreadNotifications} notification(s) non lue(s)</small></div><i>›</i></a><a href="/mon-compte/reputation"><span><AppIcon name="star"/></span><div><strong>Réputation & badges</strong><small>Suivre mes badges et ma progression</small></div><i>›</i></a><a href="/assistance"><span><AppIcon name="user-shield"/></span><div><strong>Besoin d’aide ?</strong><small>Contacter le support Petit Annonces</small></div><i>›</i></a></div></section>
          <section className={`${styles.panel} ${styles.accountHealth}`}><div className={styles.healthTop}><div><span className={styles.eyebrow}>Confiance</span><h2>Votre profil</h2></div><b>{data.profileHealth.completion}%</b></div><div className={styles.progress}><span style={{width:`${data.profileHealth.completion}%`}}/></div><ul><li className={data.profileHealth.emailVerified?styles.done:undefined}>{data.profileHealth.emailVerified?"✓":"○"} E-mail vérifié</li><li className={data.profileHealth.profileComplete?styles.done:undefined}>{data.profileHealth.profileComplete?"✓":"○"} Profil complet</li><li className={data.profileHealth.phoneVerified?styles.done:undefined}>{data.profileHealth.phoneVerified?"✓":"○"} Téléphone vérifié</li><li className={data.profileHealth.defaultAddress?styles.done:undefined}>{data.profileHealth.defaultAddress?"✓":"○"} Adresse principale</li><li className={data.profileHealth.twoFactorEnabled?styles.done:undefined}>{data.profileHealth.twoFactorEnabled?"✓":"○"} Double authentification</li></ul><div className={styles.healthLinks}><a href="/mon-compte/profil">Compléter mon profil</a><a href="/mon-compte/securite">Sécuriser mon compte</a></div></section></aside>
      </div></>}
    </section>
  </main>
  {actionListing&&typeof document!=="undefined"&&createPortal(
    <div className={styles.recentActionOverlay}>
      <button type="button" className={styles.recentActionBackdrop} aria-label="Fermer le menu" onClick={()=>setActionListingId(null)}/>
      <section className={styles.recentActionSheet} role="dialog" aria-modal="true" aria-labelledby="recent-actions-heading">
        <div className={styles.recentActionHandle} aria-hidden="true"/>
        <div className={styles.recentActionHead}>
          <div>
            <small>Actions de l’annonce</small>
            <h2 id="recent-actions-heading">{actionListing.title||"Mon annonce"}</h2>
            <span>{statusLabels[actionListing.status]}</span>
          </div>
          <button type="button" className={styles.recentActionClose} aria-label="Fermer" onClick={()=>setActionListingId(null)}>×</button>
        </div>
        <div className={styles.recentActionItems}>
          {actionListing.status==="PUBLISHED"&&actionListing.slug&&<a href={"/annonce/"+actionListing.slug} onClick={()=>setActionListingId(null)}>Voir l’annonce</a>}
          {actionListing.status!=="PUBLISHED"&&<a href={"/deposer-une-annonce?listingId="+encodeURIComponent(actionListing.id)} onClick={()=>setActionListingId(null)}>Prévisualiser</a>}
          <a href={"/deposer-une-annonce?listingId="+encodeURIComponent(actionListing.id)+(actionListing.status==="PUBLISHED"?"&resumeStep=0&mode=edit":"")} onClick={()=>setActionListingId(null)}>Modifier</a>
          {actionListing.status==="PUBLISHED"&&<a href={"/mon-compte/visibilite?listingId="+encodeURIComponent(actionListing.id)} onClick={()=>setActionListingId(null)}>Booster l’annonce</a>}
          {actionListing.status==="PUBLISHED"&&<button type="button" onClick={()=>{setActionListingId(null);void changeListingStatus(actionListing.id,"SUSPENDED")}}>Mettre en pause</button>}
          {actionListing.status==="PUBLISHED"&&<button type="button" onClick={()=>{setActionListingId(null);void changeListingStatus(actionListing.id,"SOLD")}}>Marquer comme vendue</button>}
          {actionListing.status==="SUSPENDED"&&<button type="button" onClick={()=>{setActionListingId(null);void changeListingStatus(actionListing.id,"PENDING")}}>Republier</button>}
          {actionListing.status==="EXPIRED"&&<a className={styles.recentActionRenew} href={"/mon-compte/annonces?status=EXPIRED&listingId="+encodeURIComponent(actionListing.id)} onClick={()=>setActionListingId(null)}>Prolonger +30 jours</a>}
          {actionListing.status==="PENDING"&&<p className={styles.recentActionHint}>Cette annonce est en cours de vérification.</p>}
          <button type="button" className={styles.recentActionDelete} onClick={()=>{setActionListingId(null);void deleteListing(actionListing.id,actionListing.title)}}>Supprimer définitivement</button>
        </div>
      </section>
    </div>,document.body
  )}
  </div>;
}
