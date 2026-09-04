"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { SiteHeader } from "../../components/site-header";
import styles from "./page.module.css";

type Person = { id: string; profile?: { displayName?: string | null; avatarUrl?: string | null } | null };
type Listing = { id: string; title: string | null; slug: string | null; priceMinor: number | null; currency: string };
type Offer = { id: string; amountMinor: number; currency: string; status: string; makerId: string; recipientId: string; expiresAt?: string | null };
type Message = { id: string; senderId: string; kind: "TEXT" | "IMAGE" | "FILE" | "SYSTEM" | "OFFER"; body: string | null; attachmentUrl?: string | null; attachmentName?: string | null; createdAt: string; offer?: Offer | null };
type Conversation = { id: string; buyerId: string; sellerId: string; status: string; buyerLastReadAt?: string | null; sellerLastReadAt?: string | null; lastMessageAt?: string | null; listing: Listing; buyer: Person; seller: Person; messages: Message[] };
type Me = { user: { id: string; profile?: { displayName?: string | null } | null } };

function apiBase() { return (process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, ""); }
function money(minor: number | null, currency = "EUR") { return minor == null ? "Prix non défini" : new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(minor / 100); }
function timeLabel(value?: string | null) { if (!value) return ""; return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function dateLabel(value: string) { return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }

const quickReplies = ["Bonjour, l’annonce est-elle toujours disponible ?", "Merci, je reviens vers vous rapidement.", "Pouvez-vous me confirmer l’état de l’article ?"];

export default function MessagesPage() {
  const [me, setMe] = useState<Me["user"] | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [offerAmount, setOfferAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [offerBusy, setOfferBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [mobileChat, setMobileChat] = useState(false);

  async function loadConversations(preselect?: string | null) {
    const [meRes, convRes] = await Promise.all([
      fetch(`${apiBase()}/auth/me`, { credentials: "include" }),
      fetch(`${apiBase()}/conversations`, { credentials: "include" }),
    ]);
    if (!meRes.ok || !convRes.ok) throw new Error("messages_unavailable");
    const mePayload = await meRes.json() as Me;
    const convPayload = await convRes.json() as { conversations: Conversation[] };
    setMe(mePayload.user);
    setConversations(convPayload.conversations);
    const next = preselect ?? activeId ?? convPayload.conversations[0]?.id ?? null;
    setActiveId(next);
    if (next) await loadMessages(next);
  }

  async function loadMessages(id: string) {
    const response = await fetch(`${apiBase()}/conversations/${id}/messages`, { credentials: "include" });
    if (!response.ok) throw new Error("conversation_unavailable");
    const payload = await response.json() as { messages: Message[] };
    setMessages(payload.messages);
    setActiveId(id);
  }

  useEffect(() => { loadConversations().catch(() => setError("Impossible de charger la messagerie.")); }, []);

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
      setDraft("");
      await loadConversations(activeId);
    } catch (err) {
      const code = err instanceof Error ? err.message : "send_failed";
      setError(code === "message_requires_review" ? "Ce message semble contenir une demande de paiement hors plateforme. Modifiez-le avant l’envoi." : code === "message_rate_limited" ? "Vous envoyez trop de messages. Réessayez dans un instant." : "Message non envoyé.");
    } finally { setBusy(false); }
  }

  async function sendOffer() {
    if (!activeId || !offerAmount) return;
    const amount = Number(offerAmount.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) { setError("Montant de l’offre invalide."); return; }
    setOfferBusy(true); setError("");
    try {
      const response = await fetch(`${apiBase()}/conversations/${activeId}/offers`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ amount }) });
      if (!response.ok) throw new Error("offer_failed");
      setOfferAmount("");
      await loadConversations(activeId);
    } catch { setError("Impossible d’envoyer cette offre."); }
    finally { setOfferBusy(false); }
  }

  async function respondOffer(offerId: string, action: "ACCEPT" | "DECLINE") {
    setError("");
    const response = await fetch(`${apiBase()}/offers/${offerId}/respond`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    if (!response.ok) { setError("Cette offre ne peut plus être modifiée."); return; }
    if (activeId) await loadConversations(activeId);
  }

  return <div className={styles.page}>
    <SiteHeader />
    <main className={styles.shell}>
      <div className={styles.topbar}>
        <div><span className={styles.eyebrow}>Messagerie sécurisée</span><h1>Mes messages</h1><p>Discutez, négociez et suivez vos offres sans quitter Petit Annonces.</p></div>
        <a href="/mon-compte/activite" className={styles.secondary}>Voir toute l’activité</a>
      </div>
      {error && <div className={styles.error}>{error}</div>}
      <section className={`${styles.chatShell} ${mobileChat ? styles.mobileOpen : ""}`}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHead}><strong>Conversations</strong><span>{conversations.length}</span></div>
          <input className={styles.search} value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Rechercher un membre ou une annonce" />
          <div className={styles.conversationList}>
            {filtered.length === 0 ? <div className={styles.emptyList}>Aucune conversation.</div> : filtered.map((c) => {
              const counterpart = me?.id === c.buyerId ? c.seller : c.buyer;
              const name = counterpart.profile?.displayName ?? "Membre Petit Annonces";
              const last = c.messages?.[0];
              return <button key={c.id} className={`${styles.conversationItem} ${c.id === activeId ? styles.active : ""}`} onClick={() => { loadMessages(c.id).catch(()=>setError("Conversation indisponible.")); setMobileChat(true); }}>
                <div className={styles.avatar}>{name.slice(0,2).toUpperCase()}</div>
                <div className={styles.convMain}><div className={styles.convTop}><strong>{name}</strong><span>{timeLabel(c.lastMessageAt)}</span></div><b>{c.listing.title ?? "Annonce"}</b><p>{last?.body ?? "Nouvelle conversation"}</p></div>
              </button>;
            })}
          </div>
        </aside>
        <section className={styles.chatPanel}>
          {!active || !me ? <div className={styles.emptyChat}><div>💬</div><h2>Sélectionnez une conversation</h2><p>Vos messages, offres et échanges liés à une annonce apparaîtront ici.</p></div> : <>
            <header className={styles.chatHeader}>
              <button className={styles.back} onClick={()=>setMobileChat(false)}>‹</button>
              <div className={styles.avatar}>{otherName.slice(0,2).toUpperCase()}</div>
              <div className={styles.chatIdentity}><strong>{otherName}</strong><span>Échange lié à une annonce Petit Annonces</span></div>
              <a href={active.listing.slug ? `/annonce/${active.listing.slug}` : "#"} className={styles.listingLink}><span>{active.listing.title ?? "Annonce"}</span><b>{money(active.listing.priceMinor, active.listing.currency)}</b></a>
            </header>
            <div className={styles.security}>🔒 Restez sur Petit Annonces pour vos échanges et paiements. N’envoyez jamais d’argent par virement, mandat ou crypto à la demande d’un inconnu.</div>
            <div className={styles.messages}>
              {messages.map((message) => {
                const mine = message.senderId === me.id;
                if (message.kind === "OFFER" && message.offer) {
                  const offer = message.offer;
                  const canRespond = offer.recipientId === me.id && offer.status === "PENDING";
                  return <div key={message.id} className={`${styles.offerCard} ${mine ? styles.mineOffer : ""}`}>
                    <div><span>Offre</span><strong>{money(offer.amountMinor, offer.currency)}</strong></div><p>{mine ? "Vous avez envoyé cette offre." : `${otherName} vous a envoyé une offre.`}</p><small>{dateLabel(message.createdAt)} · {offer.status}</small>{canRespond && <div className={styles.offerActions}><button onClick={()=>respondOffer(offer.id,"ACCEPT")}>Accepter</button><button onClick={()=>respondOffer(offer.id,"DECLINE")}>Refuser</button></div>}
                  </div>;
                }
                return <div key={message.id} className={`${styles.messageRow} ${mine ? styles.mine : ""}`}><div className={styles.bubble}><p>{message.body}</p><small>{dateLabel(message.createdAt)}</small></div></div>;
              })}
            </div>
            <div className={styles.quickReplies}>{quickReplies.map((text)=><button key={text} onClick={()=>setDraft(text)}>{text}</button>)}</div>
            <div className={styles.composerZone}>
              <form className={styles.composer} onSubmit={sendMessage}><textarea value={draft} onChange={(e)=>setDraft(e.target.value)} placeholder="Écrivez votre message…" maxLength={4000}/><button disabled={busy || !draft.trim()}>{busy ? "…" : "Envoyer"}</button></form>
              <div className={styles.offerComposer}><span>Faire une offre</span><input inputMode="decimal" value={offerAmount} onChange={(e)=>setOfferAmount(e.target.value)} placeholder="Montant €"/><button onClick={sendOffer} disabled={offerBusy || !offerAmount}>{offerBusy ? "Envoi…" : "Envoyer l’offre"}</button></div>
            </div>
          </>}
        </section>
      </section>
    </main>
  </div>;
}
