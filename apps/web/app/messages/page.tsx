"use client";

import { FormEvent, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AccountSidebar } from "../../components/account-sidebar";
import { AppIcon } from "../../components/app-icon";
import { trackSiteConversion } from "../../components/site-telemetry";
import styles from "./page.module.css";
import { formatListingPrice } from "../../lib/listing-price";
import { fetchWithRetry } from "../../lib/fetch-resilient";
import { navigateApp } from "../../lib/app-navigation";

type Person = { id: string; profile?: { displayName?: string | null; avatarUrl?: string | null } | null };
type Listing = { id: string; title: string | null; slug: string | null; priceMinor: number | null; currency: string; category:{domain:string}; property?:{transactionType?:string|null}|null };
type Offer = { id: string; amountMinor: number; currency: string; status: string; makerId: string; recipientId: string; expiresAt?: string | null };
type Message = { id: string; senderId: string; kind: "TEXT" | "IMAGE" | "FILE" | "SYSTEM" | "OFFER"; body: string | null; attachmentUrl?: string | null; attachmentName?: string | null; attachmentMime?: string | null; attachmentSize?: number | null; createdAt: string; offer?: Offer | null };
type OrderContext={id:string;orderNumber:string;status:string;currency:string;itemAmountMinor:number;totalAmountMinor:number;sellerNetMinor:number;shipmentStatus?:string|null;carrier?:string|null;trackingNumber?:string|null;trackingUrl?:string|null;deliveredAt?:string|null;disputeId?:string|null;disputeStatus?:string|null};
type Conversation = { id: string; buyerId: string; sellerId: string; status: string; buyerLastReadAt?: string | null; sellerLastReadAt?: string | null; lastMessageAt?: string | null; listing: Listing; buyer: Person; seller: Person; messages: Message[]; orderContext?:OrderContext|null; unreadCount?: number; blockedByMe?: boolean; blockedMe?: boolean };
type Me = { user: { id: string; kind?: "PARTICULIER" | "PROFESSIONNEL"; profile?: { displayName?: string | null } | null } };

function apiBase() { return (process.env.NEXT_PUBLIC_API_URL ?? "/api").replace(/\/$/, ""); }
function money(minor: number | null, currency = "EUR") { return minor == null ? "Prix non défini" : new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(minor / 100); }
function timeLabel(value?: string | null) { if (!value) return ""; return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function dateLabel(value: string) { return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }

const quickReplies = ["Bonjour, l’annonce est-elle toujours disponible ?", "Merci, je reviens vers vous rapidement.", "Pouvez-vous me confirmer l’état de l’article ?"];
const offerStatusLabel:Record<string,string>={PENDING:"En attente",COUNTERED:"Contre-offre envoyée",ACCEPTED:"Acceptée",DECLINED:"Refusée",WITHDRAWN:"Retirée",EXPIRED:"Expirée"};
const orderStatusLabel:Record<string,string>={PENDING_PAYMENT:"Paiement en attente",PAID:"Paiement confirmé",PROCESSING:"En préparation",SHIPPED:"Expédiée",DELIVERED:"Livrée",COMPLETED:"Terminée",CANCELED:"Annulée",REFUNDED:"Remboursée",DISPUTED:"Litige en cours"};
function orderAction(order:OrderContext,role:"BUYER"|"SELLER"){if(order.disputeId&&!['RESOLVED_BUYER','RESOLVED_SELLER','CLOSED'].includes(String(order.disputeStatus)))return{href:`/commandes/${order.id}#litige`,label:"Voir le litige"};if(role==="SELLER"&&["PAID","PROCESSING"].includes(order.status))return{href:`/commandes/${order.id}#livraison`,label:"Préparer mon envoi"};if(order.trackingUrl&&order.shipmentStatus&&order.shipmentStatus!=="DELIVERED")return{href:order.trackingUrl,label:"Suivre la livraison",external:true};if(role==="BUYER"&&order.status==="DELIVERED")return{href:`/commandes/${order.id}`,label:"Confirmer la réception"};return{href:`/commandes/${order.id}`,label:"Voir la commande"}}

function MessagesPageInner() {
  const router=useRouter();
  const searchParams=useSearchParams();
  const [me, setMe] = useState<Me["user"] | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [offerAmount, setOfferAmount] = useState("");
  const [counterOfferId, setCounterOfferId] = useState<string | null>(null);
  const [offerComposerOpen,setOfferComposerOpen]=useState(false);
  const [actionMenuOpen,setActionMenuOpen]=useState(false);
  const [busy, setBusy] = useState(false);
  const [offerBusy, setOfferBusy] = useState(false);
  const [error, setError] = useState("");
  const [noticeText,setNoticeText]=useState("");
  const [search, setSearch] = useState("");
  const [mobileChat, setMobileChat] = useState(false);
  const [uploading,setUploading]=useState(false);
  const [focusMessageId,setFocusMessageId]=useState<string|null>(null);
  const messagesRef=useRef<HTMLDivElement|null>(null);
  const chatShellRef=useRef<HTMLElement|null>(null);
  const [reportOpen,setReportOpen]=useState(false);const [reportReason,setReportReason]=useState("SCAM");const [reportDetails,setReportDetails]=useState("");const [reportBusy,setReportBusy]=useState(false);const [loading,setLoading]=useState(true);

  async function loadConversations(preselect?: string | null, focusId?: string | null) {
    const [meRes, convRes] = await Promise.all([
      fetchWithRetry(`${apiBase()}/auth/me`, { credentials: "include", cache: "no-store" }, {timeoutMs:7000,retries:1}),
      fetchWithRetry(`${apiBase()}/conversations`, { credentials: "include", cache: "no-store" }, {timeoutMs:7000,retries:1}),
    ]);
    if (meRes.status === 401 || convRes.status === 401) { navigateApp(router,`/connexion?next=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`,{replace:true}); return; }
    if (!meRes.ok || !convRes.ok) throw new Error("messages_unavailable");
    const mePayload = await meRes.json() as Me;
    if(mePayload.user.kind==="PROFESSIONNEL"){
      navigateApp(router,`/espace-pro/messages${window.location.search}`,{replace:true});
      return;
    }
    const convPayload = await convRes.json() as { conversations: Conversation[] };
    setMe(mePayload.user);
    setConversations(convPayload.conversations);
    const requested = preselect && convPayload.conversations.some((c)=>c.id===preselect) ? preselect : null;
    const next = requested ?? activeId ?? convPayload.conversations[0]?.id ?? null;
    setActiveId(next);
    if (next) {
      try {
        await loadMessages(next, focusId);
      } catch {
        setMessages([]);
        setError("Cette conversation n’a pas pu être chargée. Vous pouvez en sélectionner une autre.");
      }
      if (requested) setMobileChat(true);
    }
  }

  async function loadMessages(id: string, focusId?: string | null) {
    const response = await fetchWithRetry(`${apiBase()}/conversations/${id}/messages`, { credentials: "include", cache: "no-store" }, {timeoutMs:7000,retries:1});
    if (!response.ok) throw new Error("conversation_unavailable");
    const payload = await response.json() as { messages: Message[] };
    setMessages(payload.messages);
    setActiveId(id);
    setOfferComposerOpen(false);setCounterOfferId(null);setOfferAmount("");
    setConversations(prev=>prev.map(c=>c.id===id?{...c,unreadCount:0}:c));
    void fetch(`${apiBase()}/account/message-summary`,{credentials:"include",cache:"no-store"}).then(async summaryResponse=>{if(!summaryResponse.ok)return;const summary=await summaryResponse.json();window.dispatchEvent(new CustomEvent("pa:message-summary",{detail:summary}));window.dispatchEvent(new CustomEvent("pa:notification-count",{detail:Number(summary.unreadNotifications??0)}));}).catch(()=>{});
    const targetMessageId=focusId??focusMessageId;
    window.setTimeout(()=>{
      const container=messagesRef.current;if(!container)return;
      if(!targetMessageId){container.scrollTop=container.scrollHeight;return;}
      const target=document.getElementById(`message-${targetMessageId}`);if(!target)return;
      const containerRect=container.getBoundingClientRect();const targetRect=target.getBoundingClientRect();
      const top=container.scrollTop+(targetRect.top-containerRect.top)-Math.max(12,(container.clientHeight-targetRect.height)/2);
      container.scrollTo({top:Math.max(0,top),behavior:"smooth"});
    },100);
  }

  const requestedConversation=searchParams.get("conversation");
  const requestedMessage=searchParams.get("message");
  useEffect(() => { setFocusMessageId(requestedMessage); loadConversations(requestedConversation,requestedMessage).catch(() => setError("Impossible de charger la messagerie.")).finally(()=>setLoading(false)); }, [requestedConversation,requestedMessage]);
  useEffect(()=>{document.body.classList.add("pa-messages-page");return()=>document.body.classList.remove("pa-messages-page")},[]);
  useEffect(()=>{setActionMenuOpen(false)},[activeId]);
  useEffect(()=>{
    const shell=chatShellRef.current;if(!shell)return;
    const update=()=>{
      if(window.innerWidth>760){shell.style.removeProperty("--pa-chat-viewport-height");shell.removeAttribute("data-keyboard-open");return;}
      const viewport=window.visualViewport;
      const layoutHeight=window.innerHeight;
      const height=viewport?.height??layoutHeight;
      const offsetTop=viewport?.offsetTop??0;
      const keyboardOpen=layoutHeight-height>120||document.documentElement.classList.contains("pa-mobile-keyboard-open")||document.body.classList.contains("pa-mobile-keyboard-open");
      const top=Math.max(0,shell.getBoundingClientRect().top-offsetTop);
      const nav=document.querySelector<HTMLElement>(".mobile-bottom-nav");
      const navHeight=nav?.getBoundingClientRect().height??66;
      const bottomReserve=keyboardOpen?0:Math.ceil(navHeight);
      shell.toggleAttribute("data-keyboard-open",keyboardOpen);
      shell.style.setProperty("--pa-chat-viewport-height",`${Math.max(260,Math.floor(height-top-bottomReserve))}px`);
    };
    update();window.requestAnimationFrame(update);
    window.addEventListener("resize",update);
    window.addEventListener("orientationchange",update);
    window.addEventListener("pageshow",update);
    window.addEventListener("focus",update);
    window.visualViewport?.addEventListener("resize",update);
    window.visualViewport?.addEventListener("scroll",update);
    return()=>{window.removeEventListener("resize",update);window.removeEventListener("orientationchange",update);window.removeEventListener("pageshow",update);window.removeEventListener("focus",update);window.visualViewport?.removeEventListener("resize",update);window.visualViewport?.removeEventListener("scroll",update);shell.style.removeProperty("--pa-chat-viewport-height");shell.removeAttribute("data-keyboard-open")};
  },[mobileChat]);

  const active = conversations.find((c) => c.id === activeId) ?? null;
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => {
      const other = me?.id === c.buyerId ? c.seller : c.buyer;
      const name = other.profile?.displayName ?? "Membre Petit Annonces";
      return `${name} ${c.listing.title ?? ""}`.toLowerCase().includes(q);
    });
  }, [conversations, search, me?.id]);

  const other = active && me ? (me.id === active.buyerId ? active.seller : active.buyer) : null;
  const otherName = other?.profile?.displayName ?? "Membre Petit Annonces";

  async function sendMessage(e: FormEvent) {
    e.preventDefault();
    if (!activeId || !draft.trim()) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`${apiBase()}/conversations/${activeId}/messages`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: draft.trim() }) });
      if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.error ?? "send_failed"); }
      trackSiteConversion("MESSAGE_SENT","message_sent");
      setDraft("");
      await loadConversations(activeId);
    } catch (err) {
      const code = err instanceof Error ? err.message : "send_failed";
      setError(code === "message_requires_review" ? "Ce message semble contenir une demande de paiement hors plateforme. Modifiez-le avant l’envoi." : code === "messaging_temporarily_restricted" ? "Votre messagerie est temporairement limitée pour des raisons de sécurité. Réessayez après la fin de la restriction." : code === "message_rate_limited" ? "Vous envoyez trop de messages. Réessayez dans un instant." : "Message non envoyé.");
    } finally { setBusy(false); }
  }

  async function sendOffer() {
    if (!activeId || !offerAmount) return;
    const amount = Number(offerAmount.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) { setError("Montant de l’offre invalide."); return; }
    setOfferBusy(true); setError("");
    try {
      const response = await fetch(`${apiBase()}/conversations/${activeId}/offers`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ amount, parentOfferId: counterOfferId ?? undefined }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "offer_failed");
      setOfferAmount(""); setCounterOfferId(null); setOfferComposerOpen(false);
      await loadConversations(activeId);
    } catch (err) { const code=err instanceof Error?err.message:"offer_failed"; setError(code === "offers_disabled" ? "Le vendeur n’accepte pas les offres sur cette annonce." : code === "offers_temporarily_restricted" ? "L’envoi d’offres est temporairement limité pour des raisons de sécurité." : code === "offer_rate_limited" ? "Trop d’offres envoyées en peu de temps. Réessayez dans une minute." : code === "offer_cannot_be_countered" ? "Cette offre ne peut plus faire l’objet d’une contre-offre." : "Impossible d’envoyer cette offre."); }
    finally { setOfferBusy(false); }
  }

  async function respondOffer(offerId: string, action: "ACCEPT" | "DECLINE") {
    setError("");
    const response = await fetch(`${apiBase()}/offers/${offerId}/respond`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    if (!response.ok) { setError("Cette offre ne peut plus être modifiée."); return; }
    if (activeId) await loadConversations(activeId);
  }
  async function withdrawOffer(offerId:string){setError("");const response=await fetch(`${apiBase()}/offers/${offerId}/withdraw`,{method:"POST",credentials:"include"});if(!response.ok){setError("Cette offre ne peut plus être retirée.");return;}if(activeId)await loadConversations(activeId);}


  async function uploadAttachment(file:File){if(!activeId)return;setUploading(true);setError("");try{const allowed=["image/jpeg","image/png","image/webp","image/avif","application/pdf"];if(!allowed.includes(file.type)){setError("Formats autorisés : JPG, PNG, WebP, AVIF ou PDF.");return}if(file.size>10*1024*1024){setError("La pièce jointe ne doit pas dépasser 10 Mo.");return}const up=await fetch(`${apiBase()}/conversations/${activeId}/attachments/upload-direct`,{method:"POST",credentials:"include",headers:{"content-type":file.type,"x-file-name":encodeURIComponent(file.name)},body:file});const uj=await up.json().catch(()=>({}));if(!up.ok)throw new Error(uj.error??"upload_failed");const a=uj.attachment;const send=await fetch(`${apiBase()}/conversations/${activeId}/messages`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({body:"",attachmentUrl:a.url,attachmentName:a.fileName,attachmentMime:a.mimeType,attachmentSize:a.sizeBytes})});if(!send.ok)throw new Error("send_failed");await loadConversations(activeId)}catch(err){const code=err instanceof Error?err.message:"upload_failed";setError(code==="conversation_blocked"?"Cette conversation est bloquée.":"La pièce jointe n’a pas pu être envoyée.")}finally{setUploading(false)}}
  async function toggleBlock(){if(!activeId||!active)return;const method=active.blockedByMe?"DELETE":"POST";if(method==="POST"&&!window.confirm(`Bloquer ${otherName} ? Cette personne ne pourra plus échanger avec vous dans cette conversation.`))return;const r=await fetch(`${apiBase()}/conversations/${activeId}/block`,{method,credentials:"include"});if(!r.ok){setError("Impossible de modifier le blocage.");return}await loadConversations(activeId)}

  async function deleteConversation(){if(!activeId)return;if(!window.confirm("Supprimer cette conversation de votre messagerie ? Elle restera disponible pour l’autre membre et pourra réapparaître si un nouveau message est envoyé."))return;setError("");const r=await fetch(`${apiBase()}/conversations/${activeId}`,{method:"DELETE",credentials:"include"});if(!r.ok){setError("Impossible de supprimer cette conversation.");return}setNoticeText("Conversation supprimée de votre messagerie.");setActiveId(null);setMessages([]);setMobileChat(false);await loadConversations(null)}
  async function reportConversation(){if(!activeId)return;setReportBusy(true);setError("");try{const r=await fetch(`${apiBase()}/conversations/${activeId}/report`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({reason:reportReason,details:reportDetails||undefined})});if(!r.ok){setError("Le signalement n’a pas pu être envoyé.");return}setReportOpen(false);setReportDetails("");setNoticeText("Signalement envoyé à l’équipe de modération.")}finally{setReportBusy(false)}}

  return <div className={styles.page}>

    <main className={styles.accountShell}><AccountSidebar/><section className={styles.shell}>
      <div className={styles.topbar}>
        <div><span className={styles.eyebrow}>Messagerie sécurisée</span><h1>Mes messages</h1><p>Discutez, négociez et suivez vos offres sans quitter Petit Annonces.</p></div>
        <a href="/mon-compte/activite" className={styles.secondary}>Voir toute l’activité</a>
      </div>
      {error && <div className={styles.error}>{error}</div>}{noticeText&&<div className={styles.notice}>{noticeText}</div>}
      <section ref={chatShellRef} className={`${styles.chatShell} ${mobileChat ? styles.mobileOpen : ""}`}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHead}><div className={styles.inboxTitle}><i><AppIcon name="comments"/></i><div><strong>Messages</strong><small>Vos conversations</small></div></div><span>{conversations.length}</span></div>
          <input className={styles.search} value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Rechercher une conversation" />
          <div className={styles.conversationList} data-no-pull-refresh>
            {loading ? Array.from({length:5}).map((_,i)=><div className={styles.conversationSkeleton} key={i}><i/><span><b/><em/><small/></span></div>) : filtered.length === 0 ? <div className={styles.emptyList}><strong>Aucune conversation</strong><span>Vos échanges liés aux annonces apparaîtront ici.</span></div> : filtered.map((c) => {
              const counterpart = me?.id === c.buyerId ? c.seller : c.buyer;
              const name = counterpart.profile?.displayName ?? "Membre Petit Annonces";
              const last = c.messages?.[0];
              return <button key={c.id} className={`${styles.conversationItem} ${c.id === activeId ? styles.active : ""}`} onClick={() => { loadMessages(c.id).catch(()=>setError("Conversation indisponible.")); setMobileChat(true); }}>
                <div className={styles.avatar}>{counterpart.profile?.avatarUrl?<img src={counterpart.profile.avatarUrl} alt={`Photo de ${name}`}/>:name.slice(0,2).toUpperCase()}</div>
                <div className={styles.convMain}><div className={styles.convTop}><strong>{name}</strong><span>{timeLabel(c.lastMessageAt)}</span></div><b>{c.listing.title ?? "Annonce"}</b><p>{last?.body ?? (last?.attachmentName?"Pièce jointe":"Nouvelle conversation")}</p></div>{(c.unreadCount??0)>0&&<span className={styles.unreadBadge}>{c.unreadCount}</span>}
              </button>;
            })}
          </div>
        </aside>
        <section className={styles.chatPanel}>
          {!active || !me ? <div className={styles.emptyChat}><div><AppIcon name="comments"/></div><h2>Sélectionnez une conversation</h2><p>Vos messages, offres et échanges liés à une annonce apparaîtront ici.</p></div> : <>
            <header className={styles.chatHeader}>
              <button className={styles.back} onClick={()=>setMobileChat(false)}>‹</button>
              <div className={styles.avatar}>{other?.profile?.avatarUrl?<img src={other.profile.avatarUrl} alt={`Photo de ${otherName}`}/>:otherName.slice(0,2).toUpperCase()}</div>
              <div className={styles.chatIdentity}><strong>{otherName}</strong><span>{active.blockedByMe?"Vous avez bloqué ce membre":active.blockedMe?"Ce membre vous a bloqué":active.listing.title ?? "Annonce"}</span></div>
              <div className={styles.headerCompactActions}>
                <a href={active.listing.slug ? `/annonce/${active.listing.slug}` : "#"} className={styles.listingLink}><span>{active.listing.title ?? "Annonce"}</span><b>{formatListingPrice(active.listing.priceMinor,active.listing.currency,{domain:active.listing.category.domain,transactionType:active.listing.property?.transactionType??null},"Prix non défini")}</b><em className={styles.mobileListingCta}>Voir l’annonce →</em></a>
                <div className={styles.actionMenuWrap}>
                  <button type="button" className={styles.actionMenuTrigger} aria-label="Plus d’actions" aria-expanded={actionMenuOpen} onClick={()=>setActionMenuOpen(v=>!v)}><AppIcon name="ellipsis"/></button>
                  {actionMenuOpen&&<div className={styles.actionMenu}>
                    <button type="button" onClick={()=>{setActionMenuOpen(false);setReportOpen(true);}}>Signaler</button>
                    <button type="button" className={styles.actionMenuDanger} onClick={()=>{setActionMenuOpen(false);void deleteConversation();}}>Supprimer</button>
                    <button type="button" onClick={()=>{setActionMenuOpen(false);void toggleBlock();}}>{active.blockedByMe?"Débloquer":"Bloquer"}</button>
                  </div>}
                </div>
              </div>
            </header>
            <div className={styles.security}><AppIcon name="lock"/> Restez sur Petit Annonces pour vos échanges et paiements. N’envoyez jamais d’argent par virement, mandat ou crypto à la demande d’un inconnu.</div>
            {active.orderContext&&(()=>{const role: "BUYER"|"SELLER"=me.id===active.buyerId?"BUYER":"SELLER";const action=orderAction(active.orderContext,role);return <div className={styles.orderCard}><div className={styles.orderIcon}><AppIcon name="credit-card"/></div><div className={styles.orderMain}><span>{role==="BUYER"?"Votre achat":"Votre vente"} · {active.orderContext.orderNumber}</span><strong>{orderStatusLabel[active.orderContext.status]??active.orderContext.status}</strong><small>{role==="BUYER"?`Total ${money(active.orderContext.totalAmountMinor,active.orderContext.currency)}`:`Net vendeur ${money(active.orderContext.sellerNetMinor,active.orderContext.currency)}`}{active.orderContext.trackingNumber?` · Suivi ${active.orderContext.trackingNumber}`:""}</small></div><a href={action.href} target={action.external?"_blank":undefined} rel={action.external?"noreferrer":undefined}>{action.label}</a></div>})()}
            <div ref={messagesRef} className={styles.messages} data-no-pull-refresh>
              {!messages.length?<div className={styles.threadEmpty}><strong>Commencez la conversation</strong><span>Échangez ici en toute sécurité autour de cette annonce.</span></div>:messages.map((message) => {
                const mine = message.senderId === me.id;
                if (message.kind === "OFFER" && message.offer) {
                  const offer = message.offer;
                  const canRespond = offer.recipientId === me.id && offer.status === "PENDING";
                  const canWithdraw = offer.makerId === me.id && offer.status === "PENDING";
                  const canCheckout = active.buyerId === me.id && offer.status === "ACCEPTED";
                  return <div id={`message-${message.id}`} key={message.id} className={`${styles.offerCard} ${mine ? styles.mineOffer : ""}`}>
                    <div><span>Offre</span><strong>{money(offer.amountMinor, offer.currency)}</strong></div><p>{mine ? "Vous avez envoyé cette offre." : `${otherName} vous a envoyé une offre.`}</p><small>{dateLabel(message.createdAt)} · {offerStatusLabel[offer.status]??offer.status}</small>{offer.status==="ACCEPTED"&&offer.expiresAt&&<small>Paiement avant le {new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(new Date(offer.expiresAt))}</small>}{canRespond && <div className={styles.offerActions}><button onClick={()=>respondOffer(offer.id,"ACCEPT")}>Accepter</button><button onClick={()=>respondOffer(offer.id,"DECLINE")}>Refuser</button><button onClick={()=>{setCounterOfferId(offer.id);setOfferAmount("");setOfferComposerOpen(true);}}>Contre-offre</button></div>}{canWithdraw&&<div className={styles.offerActions}><button onClick={()=>withdrawOffer(offer.id)}>Retirer mon offre</button></div>}{canCheckout&&<a className={styles.buyOffer} href={`/checkout?listingId=${encodeURIComponent(active.listing.id)}&offerId=${encodeURIComponent(offer.id)}`}>Acheter à ce prix</a>}{offer.status==="ACCEPTED"&&active.sellerId===me.id&&<div className={styles.offerAcceptedSeller}><AppIcon name="circle-check"/><span>Offre acceptée. Le paiement de l’acheteur est maintenant attendu.</span></div>}
                  </div>;
                }
                return <div id={`message-${message.id}`} key={message.id} className={`${styles.messageRow} ${mine ? styles.mine : ""}`}><div className={styles.bubble}>{message.attachmentUrl&&message.attachmentMime?.startsWith("image/")&&<a href={message.attachmentUrl} target="_blank" rel="noreferrer"><img className={styles.messageImage} src={message.attachmentUrl} alt={message.attachmentName??"Photo"}/></a>}{message.attachmentUrl&&!message.attachmentMime?.startsWith("image/")&&<a className={styles.fileCard} href={message.attachmentUrl} target="_blank" rel="noreferrer">📎 {message.attachmentName??"Pièce jointe"}</a>}{message.body&&<p>{message.body}</p>}<small>{dateLabel(message.createdAt)}</small></div></div>;
              })}
            </div>
            {!offerComposerOpen&&<div className={styles.quickReplies}>{quickReplies.map((text)=><button key={text} onClick={()=>setDraft(text)}>{text}</button>)}</div>}
            <div className={styles.composerZone}>
              {offerComposerOpen?
                <div className={`${styles.composer} ${styles.offerInlineComposer}`}><span className={styles.offerInlineIcon}><AppIcon name="handshake"/></span><input className={styles.offerInlineInput} inputMode="decimal" value={offerAmount} onChange={(e)=>setOfferAmount(e.target.value)} placeholder="Montant €" aria-label="Montant de l’offre"/><div className={styles.composerActionStack}><button type="button" className={`${styles.offerToggle} ${styles.offerToggleActive}`} onClick={()=>{setOfferComposerOpen(false);setCounterOfferId(null);setOfferAmount("");}} disabled={active.blockedByMe||active.blockedMe}><AppIcon name="message"/>Écrire</button><button type="button" className={styles.sendAction} onClick={()=>void sendOffer()} disabled={offerBusy || !offerAmount || active.blockedByMe || active.blockedMe}>{offerBusy?"…":"Envoyer l’offre"}</button></div></div>
                :<form className={styles.composer} onSubmit={sendMessage}><label className={styles.attach}>📎<input type="file" accept="image/jpeg,image/png,image/webp,image/avif,application/pdf" disabled={uploading||active.blockedByMe||active.blockedMe} onChange={e=>{const f=e.target.files?.[0];if(f)void uploadAttachment(f);e.currentTarget.value=""}}/></label><textarea value={draft} onChange={(e)=>setDraft(e.target.value)} placeholder={active.blockedByMe||active.blockedMe?"Conversation bloquée":"Écrivez votre message…"} maxLength={4000} disabled={active.blockedByMe||active.blockedMe}/><div className={styles.composerActionStack}><button type="button" className={styles.offerToggle} onClick={()=>setOfferComposerOpen(true)} disabled={active.blockedByMe||active.blockedMe}><AppIcon name="handshake"/>Faire une offre</button><button type="submit" className={styles.sendAction} disabled={busy || !draft.trim() || active.blockedByMe || active.blockedMe}>{busy ? "…" : "Envoyer"}</button></div></form>}
            </div>
          </>}
        </section>
      </section>
    </section></main>
    {reportOpen&&<div className={styles.reportOverlay} role="dialog" aria-modal="true" aria-label="Signaler la conversation"><div className={styles.reportModal}><div className={styles.reportHead}><div><span>Sécurité</span><h2>Signaler cette conversation</h2></div><button type="button" onClick={()=>setReportOpen(false)}>×</button></div><p>Le dernier message reçu et le contexte utile seront transmis à l’équipe de modération.</p><label>Motif<select value={reportReason} onChange={e=>setReportReason(e.target.value)}><option value="SCAM">Tentative d’arnaque</option><option value="HARASSMENT">Harcèlement</option><option value="SPAM">Spam</option><option value="MISLEADING">Contenu trompeur</option><option value="SAFETY">Problème de sécurité</option><option value="OTHER">Autre</option></select></label><label>Détails<textarea value={reportDetails} onChange={e=>setReportDetails(e.target.value)} maxLength={2000} placeholder="Décrivez brièvement ce qui s’est passé (facultatif)."/></label><div className={styles.reportActions}><button type="button" onClick={()=>setReportOpen(false)}>Annuler</button><button type="button" className={styles.reportDanger} disabled={reportBusy} onClick={()=>void reportConversation()}>{reportBusy?"Envoi…":"Envoyer le signalement"}</button></div></div></div>}
  </div>;
}


export default function MessagesPage(){
  return <Suspense fallback={<div style={{minHeight:"60vh"}}/>}><MessagesPageInner/></Suspense>;
}
