"use client";

import { useEffect, useState } from "react";

const API=process.env.NEXT_PUBLIC_API_URL??"http://127.0.0.1:4000";
type Order={id:string;orderNumber:string;status:string;currency:string;itemAmountMinor:number;shippingAmountMinor:number;buyerProtectionFeeMinor:number;totalAmountMinor:number;title:string|null;imageUrl:string|null;paymentStatus:string|null};
function money(v:number,c="EUR"){return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c}).format(v/100)}

export function SuccessClient({orderId}:{orderId:string}){
 const [order,setOrder]=useState<Order|null>(null);const [error,setError]=useState("");
 useEffect(()=>{if(!orderId){setError("Commande introuvable.");return;}let stop=false;let timer:number|undefined;const load=async()=>{try{const r=await fetch(`${API}/checkout/orders/${encodeURIComponent(orderId)}/status`,{credentials:"include",cache:"no-store"});const d=await r.json();if(!r.ok)throw new Error(d.error??"status_failed");if(stop)return;setOrder(d.order);if(!["PAID","PROCESSING","SHIPPED","DELIVERED","COMPLETED"].includes(String(d.order.status)))timer=window.setTimeout(load,2500);}catch{if(!stop)setError("Impossible de vérifier le paiement pour le moment.");}};load();return()=>{stop=true;if(timer)window.clearTimeout(timer);};},[orderId]);
 const paid=order&&["PAID","PROCESSING","SHIPPED","DELIVERED","COMPLETED"].includes(order.status);
 if(error)return <div className="panel" style={{maxWidth:760,margin:"40px auto",padding:28}}><h1>Vérification du paiement</h1><p className="muted">{error}</p><a className="button button-primary" href="/commandes">Voir mes commandes</a></div>;
 if(!order)return <div className="panel" style={{maxWidth:760,margin:"40px auto",padding:28}}><p>Vérification de votre paiement…</p></div>;
 return <div className="panel" style={{maxWidth:820,margin:"40px auto",padding:30}}>
  <div style={{fontSize:44,marginBottom:12}}>{paid?"✅":"⏳"}</div>
  <p className="eyebrow">Commande {order.orderNumber}</p>
  <h1>{paid?"Paiement confirmé":"Paiement en cours de confirmation"}</h1>
  <p className="muted">{paid?"Votre achat est enregistré. Le vendeur peut maintenant préparer l’envoi via Sendcloud.":"Nous attendons la confirmation du prestataire de paiement. Cette page se met à jour automatiquement."}</p>
  <div style={{display:"grid",gridTemplateColumns:"96px 1fr",gap:18,alignItems:"center",margin:"26px 0"}}>{order.imageUrl?<img src={order.imageUrl} alt="" style={{width:96,height:96,objectFit:"cover",borderRadius:14}}/>:<div style={{width:96,height:96,borderRadius:14,background:"#f2f2f6"}}/>}<div><strong>{order.title??"Annonce Petit Annonces"}</strong><div className="muted" style={{marginTop:6}}>Total · {money(order.totalAmountMinor,order.currency)}</div></div></div>
  <div style={{display:"grid",gap:8,marginBottom:26}}><div style={{display:"flex",justifyContent:"space-between"}}><span>Article</span><b>{money(order.itemAmountMinor,order.currency)}</b></div><div style={{display:"flex",justifyContent:"space-between"}}><span>Livraison</span><b>{money(order.shippingAmountMinor,order.currency)}</b></div><div style={{display:"flex",justifyContent:"space-between"}}><span>Protection acheteur</span><b>{money(order.buyerProtectionFeeMinor,order.currency)}</b></div></div>
  <div style={{display:"flex",gap:12,flexWrap:"wrap"}}><a className="button button-primary" href={`/commandes/${order.id}`}>Suivre ma commande</a><a className="button" href="/">Continuer mes achats</a></div>
 </div>;
}
