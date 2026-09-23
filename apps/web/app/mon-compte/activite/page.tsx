"use client";

import { useEffect, useMemo, useState } from "react";
import { AccountSidebar } from "../../../components/account-sidebar";
import { AppIcon, type AppIconName } from "../../../components/app-icon";
import styles from "./page.module.css";

type ActivityItem = {
  id:string; type:"MESSAGE"|"OFFER"|"PURCHASE"|"SALE"; occurredAt:string; title:string; description:string;
  listing?:{id:string;title:string|null;slug:string|null}; counterpart?:string; conversationId?:string; offerId?:string; orderId?:string;
  status?:string; direction?:"IN"|"OUT"; amountMinor?:number; currency?:string;
};
type Payload={summary:{messages:number;offers:number;purchases:number;sales:number};items:ActivityItem[]};

function apiBase(){return (process.env.NEXT_PUBLIC_API_URL??"/api").replace(/\/$/,"")}
function money(v?:number,c="EUR"){return v==null?null:new Intl.NumberFormat("fr-FR",{style:"currency",currency:c}).format(v/100)}
function date(v:string){return new Intl.DateTimeFormat("fr-FR",{dateStyle:"medium",timeStyle:"short"}).format(new Date(v))}
const labels={MESSAGE:"Messages",OFFER:"Offres",PURCHASE:"Achats",SALE:"Ventes"} as const;
const icons:Record<ActivityItem["type"],AppIconName>={MESSAGE:"comments",OFFER:"handshake",PURCHASE:"credit-card",SALE:"store"};

export default function ActivityPage(){
  const [data,setData]=useState<Payload>({summary:{messages:0,offers:0,purchases:0,sales:0},items:[]});
  const [filter,setFilter]=useState<"ALL"|ActivityItem["type"]>("ALL");
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  async function load(){setLoading(true);setError("");try{const r=await fetch(`${apiBase()}/account/activity?limit=80`,{credentials:"include",cache:"no-store"});if(!r.ok)throw new Error();setData(await r.json())}catch{setError("Impossible de charger votre activité pour le moment.")}finally{setLoading(false)}}
  useEffect(()=>{void load()},[]);
  const items=useMemo(()=>filter==="ALL"?data.items:data.items.filter(i=>i.type===filter),[data.items,filter]);
  return <div className={styles.page}><main className={styles.shell}>
    <AccountSidebar/>
    <section className={styles.content}><div className={styles.hero}><div><span>Mon activité</span><h1>Tout ce qui bouge, au même endroit</h1><p>Messages, offres, achats et ventes réunis dans une seule chronologie.</p></div><a href="/deposer-une-annonce"><AppIcon name="plus"/> Déposer une annonce</a></div>
    <div className={styles.stats}><button type="button" onClick={()=>setFilter("MESSAGE")}><b><AppIcon name="comments"/></b><span>Messages</span><strong>{data.summary.messages}</strong></button><button type="button" onClick={()=>setFilter("OFFER")}><b><AppIcon name="handshake"/></b><span>Offres</span><strong>{data.summary.offers}</strong></button><button type="button" onClick={()=>setFilter("PURCHASE")}><b><AppIcon name="credit-card"/></b><span>Achats</span><strong>{data.summary.purchases}</strong></button><button type="button" onClick={()=>setFilter("SALE")}><b><AppIcon name="store"/></b><span>Ventes</span><strong>{data.summary.sales}</strong></button></div>
    <section className={styles.panel}><div className={styles.panelHead}><div><h2>Chronologie</h2><p>Les événements les plus récents apparaissent en premier.</p></div><div className={styles.filters}>{(["ALL","MESSAGE","OFFER","PURCHASE","SALE"] as const).map(f=><button type="button" key={f} className={filter===f?styles.on:""} onClick={()=>setFilter(f)}>{f==="ALL"?"Tout":labels[f]}</button>)}</div></div>
    {loading?<div className={styles.empty}>Chargement de votre activité…</div>:error?<div className={styles.empty}><strong>Chargement impossible</strong><p>{error}</p><button type="button" onClick={()=>void load()}>Réessayer</button></div>:items.length===0?<div className={styles.empty}>Aucune activité pour ce filtre.</div>:<div className={styles.timeline}>{items.map(item=><article key={item.id} className={styles.item}><div className={styles.icon}><AppIcon name={icons[item.type]}/></div><div className={styles.body}><div className={styles.top}><div><strong>{item.title}</strong><span>{date(item.occurredAt)}</span></div>{item.status&&<em>{item.status}</em>}</div><p>{item.description}</p>{item.counterpart&&<small>Avec {item.counterpart}</small>}{item.listing&&<a href={item.listing.slug?`/annonce/${item.listing.slug}`:`/mon-compte/annonces`}>{item.listing.title??"Voir l’annonce"}</a>}{money(item.amountMinor,item.currency)&&<b className={styles.amount}>{money(item.amountMinor,item.currency)}</b>}<div className={styles.actions}>{item.conversationId&&<a href={`/messages?conversation=${item.conversationId}`}>Ouvrir la conversation</a>}{item.orderId&&<a href={`/commandes/${item.orderId}`}>Voir la commande</a>}</div></div></article>)}</div>}
    </section></section>
  </main></div>
}
