"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AccountSidebar } from "../../../components/account-sidebar";
import styles from "./page.module.css";
import { formatListingPrice } from "../../../lib/listing-price";

type Status = "DRAFT" | "PENDING" | "PUBLISHED" | "SUSPENDED" | "SOLD" | "EXPIRED";
type Listing = {
  id: string;
  title: string | null;
  slug: string | null;
  status: Status;
  priceMinor: number | null;
  currency: string;
  city: string | null;
  createdAt: string;
  updatedAt: string;
  viewCount: number;
  performance?: {favorites:number;conversations:number;messages:number;offers:number;views7:number;views30:number;score?:number;level?:string;actions?:Array<{code:string;label:string;href:string}>};
  publishedAt: string | null;
  imageUrl?: string | null;
  category: { name: string; slug: string; domain: string };
  property?: { transactionType?: string | null } | null;
  store?: { id: string; name: string } | null;
  moderation?: { caseId:string; status:string; decisionAction:string|null; reasonCode:string|null; statement:string|null; decidedAt:string|null } | null;
  lifecycle?: { expiresAt:string; renewalRequired?:boolean; renewalAvailable?:boolean; freeRenewalAvailable:boolean; renewalCount:number; renewalCostMinor:number; renewalCurrency:string; lifetimeDays:number } | null;
  promotions?: Array<{id:string;code:string;type:string;name:string;startsAt:string|null;endsAt:string|null;status:string}>;
};

const labels: Record<Status | "ALL", string> = {
  ALL: "Toutes",
  DRAFT: "Brouillons",
  PENDING: "En modération",
  PUBLISHED: "Actives",
  SUSPENDED: "En pause",
  SOLD: "Vendues",
  EXPIRED: "Expirées",
};

function apiBase() {
  return (process.env.NEXT_PUBLIC_API_URL ?? "/api").replace(/\/$/, "");
}

export default function MyListingsPage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [status, setStatus] = useState<Status | "ALL">("ALL");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [counts, setCounts] = useState<Record<Status | "ALL",number>>({ALL:0,DRAFT:0,PENDING:0,PUBLISHED:0,SUSPENDED:0,SOLD:0,EXPIRED:0});
  const [proStores, setProStores] = useState<Array<{id:string;name:string}>>([]);
  const [proAutoRenew, setProAutoRenew] = useState(false);
  const [actionListingId, setActionListingId] = useState<string | null>(null);
  const actionListing = listings.find(item => item.id === actionListingId) ?? null;

  useEffect(() => {
    if (!actionListingId) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActionListingId(null);
    };
    window.addEventListener("keydown", onEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onEscape);
    };
  }, [actionListingId]);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (status !== "ALL") params.set("status", status);
    if (query.trim()) params.set("q", query.trim());
    try {
      const response = await fetch(`${apiBase()}/account/listings?${params}`, { credentials: "include", cache: "no-store" });
      if (!response.ok) throw new Error();
      const payload = await response.json() as { listings: Listing[]; counts?:Record<Status | "ALL",number> };
      setListings(payload.listings);
      if(payload.counts)setCounts(payload.counts);
      setMessage("");
    } catch {
      setMessage("Impossible de charger vos annonces pour le moment.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { const requested = new URLSearchParams(window.location.search).get("status"); if (status === "ALL" && requested && requested !== "ALL" && Object.prototype.hasOwnProperty.call(labels, requested)) return; void load(); }, [status]);
  useEffect(() => { const target = new URLSearchParams(window.location.search).get("listingId"); if (target && listings.some(item => item.id === target)) window.requestAnimationFrame(() => document.getElementById(`annonce-${target}`)?.scrollIntoView({ block: "center" })); }, [listings]);
  useEffect(()=>{const params=new URLSearchParams(window.location.search);const requested=params.get("status");if(requested&&requested!=="ALL"&&Object.prototype.hasOwnProperty.call(labels,requested))setStatus(requested as Status);const q=params.get("renewal");if(q==="success")setMessage("Paiement confirmé. La prolongation sera visible après validation Stripe.");else if(q==="cancelled")setMessage("Paiement de prolongation annulé.");else if(params.get("submitted")==="1")setMessage("Annonce envoyée en vérification. Vous recevrez une notification dès qu’une décision sera prise.");else if(params.get("editing")==="moderation")setMessage("Cette annonce est déjà en cours de vérification. Attendez la décision de modération avant de la modifier.")},[]);
  useEffect(() => { fetch(`${apiBase()}/pro/me`, { credentials: "include", cache: "no-store" }).then(async r => r.ok ? r.json() : null).then(p => {setProStores((p?.professional?.stores ?? []).map((x:any)=>({id:x.id,name:x.name})));const subscription=p?.professional?.subscriptions?.[0];setProAutoRenew(Boolean(subscription&&["ACTIVE","TRIALING"].includes(String(subscription.status))&&subscription.plan?.autoRenewListings===true));}).catch(()=>{}); }, []);

  async function changeStatus(id: string, next: Status) {
    setMessage("");
    const response = await fetch(`${apiBase()}/account/listings/${encodeURIComponent(id)}/status`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (!response.ok) {
      setMessage("Cette action n’est pas disponible pour cette annonce.");
      return;
    }
    await load();
  }

  async function renewListing(item: Listing) {
    const free=item.lifecycle?.freeRenewalAvailable!==false;
    if(free){if(!window.confirm("Prolonger gratuitement cette annonce de 30 jours ?"))return;setMessage("");const response=await fetch(`${apiBase()}/account/listings/${encodeURIComponent(item.id)}/renew`,{method:"POST",credentials:"include"});const payload=await response.json().catch(()=>({})) as {renewal?:{requiresReview?:boolean}};if(!response.ok){setMessage("Impossible de prolonger cette annonce pour le moment.");return}await load();setMessage(payload.renewal?.requiresReview?"Prolongation gratuite activée. Finalisez vos modifications puis renvoyez l’annonce en modération.":"Annonce prolongée gratuitement de 30 jours.");return}
    if(!window.confirm("Prolonger cette annonce de 30 jours pour 0,99 € ?"))return;
    setMessage("");const response=await fetch(`${apiBase()}/billing/stripe/listing-renewal/checkout`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({listingId:item.id})});const payload=await response.json().catch(()=>({})) as {url?:string;paidWith?:string;renewal?:{requiresReview?:boolean}};if(response.ok&&payload.paidWith==="SITE_CREDIT"){await load();setMessage(payload.renewal?.requiresReview?"Prolongation payée avec votre crédit Petit Annonces. Finalisez vos modifications puis renvoyez l’annonce en modération.":"Annonce prolongée de 30 jours avec votre crédit Petit Annonces.");return}if(!response.ok||!payload.url){setMessage("Impossible d’ouvrir le paiement sécurisé pour le moment.");return}window.location.href=payload.url;
  }

  async function assignStore(listing: Listing, storeId: string) {
    setMessage("");
    let response: Response;
    if (!storeId && listing.store?.id) response = await fetch(`${apiBase()}/pro/stores/${encodeURIComponent(listing.store.id)}/listings/${encodeURIComponent(listing.id)}`, { method: "DELETE", credentials: "include" });
    else if (storeId) response = await fetch(`${apiBase()}/pro/stores/${encodeURIComponent(storeId)}/listings/${encodeURIComponent(listing.id)}`, { method: "POST", credentials: "include" });
    else return;
    if (!response.ok) { setMessage("Impossible de modifier la boutique associée à cette annonce."); return; }
    await load();
  }

  async function deleteListing(item: Listing) {
    const title=item.title?.trim()||"cette annonce";
    if (!window.confirm(`Supprimer définitivement « ${title} » ? Cette action est irréversible.`)) return;
    setMessage("");
    const response = await fetch(`${apiBase()}/account/listings/${encodeURIComponent(item.id)}`, { method: "DELETE", credentials: "include" });
    const payload=await response.json().catch(()=>({})) as {error?:string;message?:string};
    if (!response.ok) {
      if(payload.error==="listing_has_orders")setMessage("Cette annonce est liée à une commande. Elle doit être conservée pour l’historique de la transaction.");
      else setMessage(payload.message||"Impossible de supprimer cette annonce pour le moment.");
      return;
    }
    await load();
    setMessage("Annonce supprimée définitivement.");
  }

  return (
    <div className={styles.page}>

      <main className={styles.shell}>
        <AccountSidebar/>

        <section className={styles.content}>
          <header className={styles.heading}>
            <div>
              <p>Mon espace</p>
              <h1>Mes annonces</h1>
              <span>Gérez vos brouillons, annonces actives et ventes depuis un seul endroit.</span>
            </div>
            <a className={styles.create} href="/deposer-une-annonce">+ Déposer une annonce</a>
          </header>

          {counts.EXPIRED > 0 && status !== "EXPIRED" && <a className={styles.renewalCallout} href="/mon-compte/annonces?status=EXPIRED"><span><strong>{counts.EXPIRED} annonce{counts.EXPIRED > 1 ? "s" : ""} expirée{counts.EXPIRED > 1 ? "s" : ""}</strong><small>Renouvelez chaque annonce pour 30 jours : première prolongation gratuite.</small></span><b>Renouveler mes annonces →</b></a>}

          <div className={styles.toolbar}>
            <div className={styles.tabs}>
              {(Object.keys(labels) as Array<Status | "ALL">).map((item) => (
                <button type="button" key={item} className={`${status === item ? styles.selected : ""} ${item === "EXPIRED" && counts.EXPIRED > 0 ? styles.expiredTab : ""}`} onClick={() => { setMessage(""); setStatus(item); const next = new URL(window.location.href); if (item === "ALL") next.searchParams.delete("status"); else next.searchParams.set("status", item); window.history.replaceState(null, "", next.pathname + next.search); }}>
                  {labels[item]} <span>{counts[item] ?? 0}</span>
                </button>
              ))}
            </div>
            <form className={styles.search} onSubmit={(event) => { event.preventDefault(); void load(); }}>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher dans mes annonces" />
              <button>Rechercher</button>
            </form>
          </div>

          {message && <div className={styles.notice}>{message}</div>}
          {loading ? <div className={`${styles.empty} ${styles.loadingReserve}`} aria-busy="true"><b>Chargement de vos annonces…</b><span>Préparation de votre espace d’annonces.</span></div> : listings.length === 0 ? (
            <div className={styles.empty}><b>Aucune annonce dans cette section.</b><span>Créez une nouvelle annonce ou changez de filtre.</span></div>
          ) : (
            <div className={styles.list}>
              {listings.map((item) => (
                <article className={styles.card} id={`annonce-${item.id}`} key={item.id}>
                  <div className={styles.thumb}>{item.imageUrl?<img src={item.imageUrl} alt={item.title??"Annonce"}/>:<span>{item.category.name.slice(0, 1).toUpperCase()}</span>}</div>
                  <div className={styles.mainInfo}>
                    <div className={styles.titleLine}>
                      <div>
                        <small>{item.category.name}</small>
                        <h2>{item.title ?? "Annonce sans titre"}</h2>
                      </div>
                      <span className={`${styles.badge} ${styles[item.status.toLowerCase()]}`}>{labels[item.status]}</span>
                    </div>
                    <strong className={styles.price}>{formatListingPrice(item.priceMinor,item.currency,{domain:item.category.domain,transactionType:item.property?.transactionType??null},"Prix non défini")}</strong>
                    <div className={styles.meta}>
                      <span>{item.city ?? "Localisation à compléter"}</span>
                      <span>Mis à jour le {new Date(item.updatedAt).toLocaleDateString("fr-FR")}</span>
                      {item.lifecycle?.expiresAt&&item.status==="PUBLISHED"&&<span className={styles.expiry}>Expire le {new Date(item.lifecycle.expiresAt).toLocaleDateString("fr-FR")}</span>}
                      {proAutoRenew&&item.status==="PUBLISHED"&&<span className={styles.expiry}>Renouvellement automatique Pro activé</span>}
                    </div>
                    <div className={styles.performanceMetrics}><span><b>{Number(item.viewCount??0).toLocaleString("fr-FR")}</b> vues</span><span><b>{item.performance?.favorites??0}</b> favoris</span><span><b>{item.performance?.messages??0}</b> messages</span><span><b>{item.performance?.offers??0}</b> offres</span>{item.status==="PUBLISHED"&&<span className={styles.performanceScore}><b>{item.performance?.score??0}/100</b> {item.performance?.level==="FORTE"?"Forte":item.performance?.level==="CORRECTE"?"Correcte":"Faible"}</span>}</div>{item.status==="PUBLISHED"&&(item.performance?.actions?.length??0)>0&&<div className={styles.smartActions}>{item.performance!.actions!.map(a=><a key={a.code} href={a.href}>{a.label}</a>)}</div>}
                    {(item.status==="EXPIRED"||item.lifecycle?.renewalRequired||item.lifecycle?.renewalAvailable)&&<div className={styles.renewalInfo}><b>{item.status==="PUBLISHED"?"Expiration proche · renouvellement ouvert":"Publication expirée"}</b><span>{item.lifecycle?.freeRenewalAvailable!==false?"Prolongez dès maintenant de 30 jours gratuitement.":"Prolongez dès maintenant de 30 jours pour "+((item.lifecycle?.renewalCostMinor??99)/100).toFixed(2).replace(".",",")+" €."} {item.status==="PUBLISHED"?"Les jours restants sont conservés.":""}</span></div>}
                    {item.promotions&&item.promotions.length>0&&<div className={styles.promotionList}>{item.promotions.map(p=><span key={p.id}><b>{p.name}</b><small>{p.startsAt&&new Date(p.startsAt)>new Date()?`Prévu à partir du ${new Date(p.startsAt).toLocaleDateString("fr-FR")}`:p.endsAt?`Actif jusqu’au ${new Date(p.endsAt).toLocaleDateString("fr-FR")}`:"Actif"}</small></span>)}</div>}
                    {item.status === "PENDING" && <div className={styles.moderationPending}><b>Vérification en cours</b><span>Votre annonce est dans la file de modération. Elle sera visible publiquement après validation.</span></div>}
                    {item.status === "SUSPENDED" && item.moderation?.decisionAction && item.moderation.decisionAction !== "NONE" && <div className={styles.moderationRejected}><b>Annonce à corriger</b><span>{item.moderation.statement ?? "Cette annonce nécessite une modification avant une nouvelle publication."}</span></div>}
                    {proStores.length>0 && <label className={styles.storeAssign}>Boutique<select value={item.store?.id??""} onChange={e=>void assignStore(item,e.target.value)}><option value="">Hors boutique</option>{proStores.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></label>}
                  </div>
                  <div className={`${styles.actions} ${styles.desktopActions}`}>
                    {item.status === "PUBLISHED" && item.slug && <a href={`/annonce/${item.slug}`}>Voir</a>}
                    {item.status === "DRAFT" && <a href={`/deposer-une-annonce?listingId=${encodeURIComponent(item.id)}`}>Continuer</a>}
                    {item.status === "SUSPENDED" && <a className={styles.correct} href={`/deposer-une-annonce?listingId=${encodeURIComponent(item.id)}`}>Corriger mon annonce</a>}
                    {item.status === "PUBLISHED" && <a className={styles.optimize} href={`/deposer-une-annonce?listingId=${encodeURIComponent(item.id)}&resumeStep=4&mode=edit`}>Optimiser mon annonce</a>}
                    {item.status === "DRAFT" && <a className={styles.optimize} href={`/deposer-une-annonce?listingId=${encodeURIComponent(item.id)}`}>Compléter les informations</a>}
                    {item.status === "PUBLISHED" && <a href={`/deposer-une-annonce?listingId=${encodeURIComponent(item.id)}&resumeStep=0&mode=edit`}>Modifier</a>}
                    {item.status === "EXPIRED" && <a href={`/deposer-une-annonce?listingId=${encodeURIComponent(item.id)}&resumeStep=0&mode=edit`}>Modifier</a>}
                    {item.status === "PUBLISHED" && <a href={`/mon-compte/visibilite?listingId=${encodeURIComponent(item.id)}`}>Booster</a>}
                    {item.status === "PUBLISHED" && <button type="button" onClick={() => void changeStatus(item.id, "SUSPENDED")}>Mettre en pause</button>}
                    {item.status === "PUBLISHED" && <button type="button" onClick={() => void changeStatus(item.id, "SOLD")}>Marquer vendue</button>}
                    {(item.status === "EXPIRED" || item.lifecycle?.renewalRequired || item.lifecycle?.renewalAvailable) && <button type="button" className={styles.renew} onClick={() => void renewListing(item)}>{item.lifecycle?.freeRenewalAvailable!==false?"Prolonger +30 jours gratuitement":`Prolonger +30 jours · ${((item.lifecycle?.renewalCostMinor??99)/100).toFixed(2).replace(".",",")} €`}</button>}
                    <button type="button" className={styles.danger} onClick={() => void deleteListing(item)}>Supprimer</button>
                  </div>
                  <div className={styles.mobileActions}>
                    {item.status === "PUBLISHED" && item.slug && <a className={styles.mobilePrimary} href={`/annonce/${item.slug}`}>Voir l’annonce</a>}
                    {item.status === "DRAFT" && !item.lifecycle?.renewalRequired && <a className={styles.mobilePrimary} href={`/deposer-une-annonce?listingId=${encodeURIComponent(item.id)}`}>Continuer</a>}
                    {item.status === "SUSPENDED" && <a className={styles.mobilePrimary} href={`/deposer-une-annonce?listingId=${encodeURIComponent(item.id)}`}>Corriger</a>}
                    {(item.status === "EXPIRED" || item.lifecycle?.renewalRequired || item.lifecycle?.renewalAvailable) && <button type="button" className={styles.mobilePrimary} onClick={() => void renewListing(item)}>{item.lifecycle?.freeRenewalAvailable!==false?"Prolonger gratuitement":"Prolonger l’annonce"}</button>}
                    {item.status === "PENDING" && <span className={styles.mobileState}>En cours de vérification</span>}
                    {item.status === "SOLD" && <span className={styles.mobileState}>Annonce vendue</span>}
                    <button
                      type="button"
                      className={styles.mobileMoreButton}
                      aria-label={`Actions pour ${item.title ?? "cette annonce"}`}
                      aria-haspopup="dialog"
                      aria-expanded={actionListingId === item.id}
                      onClick={() => setActionListingId(item.id)}
                    >
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" />
                      </svg>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
      {actionListing && typeof document !== "undefined" && createPortal(
        <div className={styles.actionOverlay}>
          <button type="button" className={styles.actionBackdrop} aria-label="Fermer le menu des actions" onClick={() => setActionListingId(null)} />
          <section className={styles.actionSheet} role="dialog" aria-modal="true" aria-labelledby="listing-actions-heading">
            <div className={styles.actionHandle} aria-hidden="true" />
            <div className={styles.actionSheetHead}>
              <div>
                <small>Actions de l’annonce</small>
                <h2 id="listing-actions-heading">{actionListing.title || "Mon annonce"}</h2>
                <span>{labels[actionListing.status]}</span>
              </div>
              <button className={styles.actionClose} type="button" onClick={() => setActionListingId(null)} aria-label="Fermer">×</button>
            </div>
            <div className={styles.actionSheetItems}>
              {actionListing.status === "PUBLISHED" && actionListing.slug &&
                <a href={`/annonce/${actionListing.slug}`} onClick={() => setActionListingId(null)}>Voir l’annonce</a>}
              {actionListing.status === "DRAFT" &&
                <a href={`/deposer-une-annonce?listingId=${encodeURIComponent(actionListing.id)}`} onClick={() => setActionListingId(null)}>Continuer mon annonce</a>}
              {actionListing.status === "SUSPENDED" &&
                <a href={`/deposer-une-annonce?listingId=${encodeURIComponent(actionListing.id)}`} onClick={() => setActionListingId(null)}>Corriger mon annonce</a>}
              {(actionListing.status === "PUBLISHED" || actionListing.status === "EXPIRED") &&
                <a href={`/deposer-une-annonce?listingId=${encodeURIComponent(actionListing.id)}&resumeStep=0&mode=edit`} onClick={() => setActionListingId(null)}>Modifier</a>}
              {actionListing.status === "PUBLISHED" &&
                <a href={`/mon-compte/visibilite?listingId=${encodeURIComponent(actionListing.id)}`} onClick={() => setActionListingId(null)}>Booster l’annonce</a>}
              {actionListing.status === "PUBLISHED" &&
                <button type="button" onClick={() => { setActionListingId(null); void changeStatus(actionListing.id, "SUSPENDED"); }}>Mettre en pause</button>}
              {actionListing.status === "PUBLISHED" &&
                <button type="button" onClick={() => { setActionListingId(null); void changeStatus(actionListing.id, "SOLD"); }}>Marquer comme vendue</button>}
              {(actionListing.status === "EXPIRED" || actionListing.lifecycle?.renewalRequired || actionListing.lifecycle?.renewalAvailable) &&
                <button type="button" className={styles.actionRenew} onClick={() => { setActionListingId(null); void renewListing(actionListing); }}>
                  {actionListing.lifecycle?.freeRenewalAvailable !== false ? "Prolonger gratuitement +30 jours" : "Prolonger +30 jours"}
                </button>}
              {actionListing.status === "PENDING" && <p className={styles.actionHint}>Cette annonce est en cours de vérification.</p>}
              <button type="button" className={styles.actionDelete} onClick={() => { setActionListingId(null); void deleteListing(actionListing); }}>Supprimer définitivement</button>
            </div>
          </section>
        </div>, document.body
      )}
    </div>
  );
}
