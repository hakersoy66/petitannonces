"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./page.module.css";
import { trackSiteConversionOnce } from "../../../components/site-telemetry";
import { fetchWithRetry } from "../../../lib/fetch-resilient";

const API=process.env.NEXT_PUBLIC_API_URL??"/api";
type Order={id:string;orderNumber:string;status:string;currency:string;itemAmountMinor:number;shippingAmountMinor:number;buyerServiceFeeMinor:number;commissionPayer:"SELLER"|"BUYER"|null;totalAmountMinor:number;title:string|null;imageUrl:string|null;paymentStatus:string|null};
function money(v:number,c="EUR"){return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c}).format(v/100)}

export function SuccessClient({orderId}:{orderId:string}){
 const [order,setOrder]=useState<Order|null>(null);const [error,setError]=useState("");const polls=useRef(0);
 useEffect(()=>{if(!orderId){setError("Commande introuvable.");return;}let stop=false;let timer:number|undefined;polls.current=0;const load=async()=>{try{const r=await fetchWithRetry(`${API}/checkout/orders/${encodeURIComponent(orderId)}/status`,{credentials:"include",cache:"no-store"},{timeoutMs:6500,retries:1});const d=await r.json();if(!r.ok)throw new Error(d.error??"status_failed");if(stop)return;setOrder(d.order);setError("");const status=String(d.order.status??"");const paymentStatus=String(d.order.paymentStatus??"");const paid=["PAID","PROCESSING","SHIPPED","DELIVERED","COMPLETED"].includes(status);const failed=["CANCELED","REFUNDED"].includes(status)||["FAILED","CANCELED"].includes(paymentStatus);if(paid||failed)return;polls.current+=1;if(polls.current>=24){setError("La confirmation prend plus de temps que prévu. Vous pouvez consulter vos commandes et revenir dans quelques instants.");return}timer=window.setTimeout(load,2500);}catch{if(stop)return;polls.current+=1;if(polls.current>=4){setError("Impossible de vérifier le paiement pour le moment.");return}timer=window.setTimeout(load,2500);}};void load();return()=>{stop=true;if(timer)window.clearTimeout(timer);};},[orderId]);
 const paid=Boolean(order&&["PAID","PROCESSING","SHIPPED","DELIVERED","COMPLETED"].includes(order.status));const failed=Boolean(order&&(["CANCELED","REFUNDED"].includes(order.status)||["FAILED","CANCELED"].includes(String(order.paymentStatus??""))));
 useEffect(()=>{if(!paid||!order)return;trackSiteConversionOnce("PURCHASE_COMPLETED","purchase",order.id,{transaction_id:order.orderNumber||order.id,value:order.totalAmountMinor/100,currency:order.currency,item_name:order.title??"Annonce Petit Annonces",shipping:order.shippingAmountMinor/100,service_fee:order.buyerServiceFeeMinor/100});},[paid,order]);
 if(error)return <div className={styles.page}><section className={styles.card}><div className={`${styles.icon} ${styles.pending}`}>!</div><p className={styles.eyebrow}>Vérification du paiement</p><h1>Nous ne pouvons pas encore confirmer le paiement</h1><p className={styles.lead}>{error}</p><div className={styles.actions} style={{marginTop:22}}><a className={styles.primary} href="/commandes">Voir mes achats & ventes</a></div></section></div>;
 if(!order)return <div className={styles.page}><section className={`${styles.card} ${styles.loading}`}><div className={styles.bar}/><div className={styles.bar}/><div className={styles.bar}/></section></div>;
 return <div className={styles.page}><section className={styles.card}>
  <div className={`${styles.icon} ${paid?"":styles.pending}`}>{paid?"✓":failed?"!":"…"}</div>
  <p className={styles.eyebrow}>Commande {order.orderNumber}</p>
  <h1>{paid?"Paiement confirmé":failed?"Paiement non confirmé":"Paiement en cours de confirmation"}</h1>
  <p className={styles.lead}>{paid?"Votre achat est enregistré. Le vendeur peut maintenant préparer l’envoi.":failed?"Le paiement n’a pas été confirmé. Aucun envoi ne sera déclenché pour cette commande; vous pouvez revenir à vos achats et réessayer si l’annonce est toujours disponible.":"Nous attendons la confirmation du prestataire de paiement. Cette page se met à jour automatiquement."}</p>
  <div className={styles.steps}><div className={styles.active}><b>1 · Paiement</b><small>{paid?"Paiement confirmé et sécurisé.":failed?"Paiement non confirmé.":"Confirmation en cours."}</small></div><div><b>2 · Préparation</b><small>{failed?"Aucun envoi ne sera déclenché.":"Le vendeur prépare votre colis."}</small></div><div><b>3 · Suivi</b><small>{failed?"Vous pouvez revenir à vos commandes.":"Le suivi apparaîtra dans la commande."}</small></div></div>
  <div className={styles.product}>{order.imageUrl?<img src={order.imageUrl} alt=""/>:<div className={styles.placeholder}/>}<div><strong>{order.title??"Annonce Petit Annonces"}</strong><span>Total · {money(order.totalAmountMinor,order.currency)}</span></div></div>
  <div className={styles.summary}><div><span>Article</span><b>{money(order.itemAmountMinor,order.currency)}</b></div><div><span>Livraison</span><b>{money(order.shippingAmountMinor,order.currency)}</b></div><div><span>Frais de service (TTC)</span><b>{order.commissionPayer==="BUYER"?money(order.buyerServiceFeeMinor,order.currency):"Pris en charge par le vendeur"}</b></div><div><span>Total payé</span><b>{money(order.totalAmountMinor,order.currency)}</b></div></div>
  <div className={styles.actions}><a className={styles.primary} href={`/commandes/${order.id}`}>Suivre ma commande</a><a className={styles.secondary} href="/recherche">Continuer mes achats</a></div>
 </section></div>;
}
