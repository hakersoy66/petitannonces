"use client";

import { useMemo, useState } from "react";
import styles from "./page.module.css";

type ShippingOption = { code:string; name:string; carrierCode:string; carrierName:string; priceMinor:number; currency:string; servicePoint:boolean; quoteToken:string };
type ServicePoint = { id:string; name:string; address1:string; postalCode:string; city:string; countryCode:string; distanceM?:number };

const API=process.env.NEXT_PUBLIC_API_URL??"http://127.0.0.1:4000";
function euro(minor:number){return new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR"}).format(minor/100)}

export function CheckoutClient({listingId,fromPostalCode="75001",itemAmountMinor=0}:{listingId:string;fromPostalCode?:string;itemAmountMinor?:number}){
 const [postalCode,setPostalCode]=useState("");
 const [city,setCity]=useState("");
 const [address1,setAddress1]=useState("");
 const [name,setName]=useState("");
 const [email,setEmail]=useState("");
 const [phone,setPhone]=useState("");
 const [weightG,setWeightG]=useState(1000);
 const [options,setOptions]=useState<ShippingOption[]>([]);
 const [selected,setSelected]=useState<ShippingOption|null>(null);
 const [points,setPoints]=useState<ServicePoint[]>([]);
 const [point,setPoint]=useState<ServicePoint|null>(null);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState("");
 const [sandbox,setSandbox]=useState(false);

 const buyerFee=Math.max(99,Math.round(itemAmountMinor*0.04));
 const total=useMemo(()=>itemAmountMinor+(selected?.priceMinor??0)+buyerFee,[itemAmountMinor,selected,buyerFee]);

 async function loadOptions(){
  setError("");setLoading(true);setSelected(null);setPoint(null);setPoints([]);
  try{
   const response=await fetch(`${API}/shipping/options`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({weightG,sender:{name:"Vendeur Petit Annonces",address1:"Adresse vendeur",postalCode:fromPostalCode,city:"France",countryCode:"FR"},recipient:{name:name||"Acheteur",address1:address1||"Adresse de livraison",postalCode,city:city||"France",countryCode:"FR",email:email||undefined,phone:phone||undefined}})});
   const data=await response.json();if(!response.ok)throw new Error(data.error??"shipping_options_unavailable");
   setOptions(data.options??[]);setSandbox(Boolean(data.sandbox));
  }catch{setError("Impossible de charger les modes de livraison pour le moment.");}finally{setLoading(false);}
 }

 async function chooseOption(option:ShippingOption){
  setSelected(option);setPoint(null);setPoints([]);setError("");
  if(!option.servicePoint)return;
  try{
   const params=new URLSearchParams({postalCode,countryCode:"FR",carrierCode:option.carrierCode});
   const response=await fetch(`${API}/shipping/service-points?${params}`,{credentials:"include"});const data=await response.json();if(!response.ok)throw new Error();setPoints(data.points??[]);
  }catch{setError("Les points relais ne sont pas disponibles pour le moment.");}
 }

 async function continueToPayment(){
  if(!listingId){setError("Annonce introuvable. Revenez à l’annonce puis relancez l’achat.");return;}
  if(!selected){setError("Choisissez un mode de livraison.");return;}
  if(selected.servicePoint&&!point){setError("Choisissez un point relais.");return;}
  setLoading(true);setError("");
  try{
   const idempotencyKey=`checkout-${listingId}-${Date.now()}-${Math.random().toString(36).slice(2,10)}`;
   const orderResponse=await fetch(`${API}/checkout/orders`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({listingId,shippingAmountMinor:selected.priceMinor,idempotencyKey})});
   const orderData=await orderResponse.json();if(!orderResponse.ok)throw new Error(orderData.error??"checkout_failed");
   const orderId=String(orderData.order.id);
   const deliveryResponse=await fetch(`${API}/orders/${encodeURIComponent(orderId)}/delivery-selection`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({quoteToken:selected.quoteToken,servicePoint:point??undefined})});
   if(!deliveryResponse.ok)throw new Error("delivery_selection_failed");
   const url=String(orderData.checkout.checkoutUrl??"");
   window.location.href=url||`/commandes/${orderId}`;
  }catch(error){setError(String(error).includes("unauthorized")?"Connectez-vous pour continuer votre achat.":"La commande n’a pas pu être créée. Vérifiez vos informations et réessayez.");setLoading(false);}
 }

 return <div className={styles.checkoutGrid}>
  <section className={styles.mainColumn}>
   <div className={styles.card}>
    <div className={styles.step}><span>1</span><div><strong>Adresse de livraison</strong><small>Utilisée pour calculer les options Sendcloud disponibles.</small></div></div>
    <div className={styles.formGrid}>
     <label>Nom complet<input value={name} onChange={e=>setName(e.target.value)} placeholder="Jean Dupont" /></label>
     <label>E-mail<input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="jean@exemple.fr" /></label>
     <label className={styles.full}>Adresse<input value={address1} onChange={e=>setAddress1(e.target.value)} placeholder="12 rue de la République" /></label>
     <label>Code postal<input value={postalCode} onChange={e=>setPostalCode(e.target.value)} placeholder="75011" /></label>
     <label>Ville<input value={city} onChange={e=>setCity(e.target.value)} placeholder="Paris" /></label>
     <label>Téléphone<input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="06 00 00 00 00" /></label>
     <label>Poids du colis<input type="number" min={50} max={30000} value={weightG} onChange={e=>setWeightG(Number(e.target.value)||1000)} /><small>en grammes</small></label>
    </div>
    <button className={styles.secondaryButton} disabled={loading||postalCode.length<4} onClick={loadOptions}>{loading?"Recherche…":"Afficher les modes de livraison"}</button>
   </div>

   <div className={styles.card}>
    <div className={styles.step}><span>2</span><div><strong>Mode de livraison</strong><small>Tarifs et services proposés par Sendcloud.</small></div></div>
    {sandbox&&<div className={styles.sandbox}>Mode test Sendcloud — les tarifs affichés sont de démonstration.</div>}
    {!options.length?<p className={styles.empty}>Renseignez votre adresse pour afficher les transporteurs disponibles.</p>:<div className={styles.options}>{options.map(option=><button type="button" key={option.code} className={`${styles.optionCard} ${selected?.code===option.code?styles.optionSelected:""}`} onClick={()=>chooseOption(option)}><div><strong>{option.carrierName}</strong><span>{option.name}</span>{option.servicePoint&&<small>Point relais disponible</small>}</div><b>{euro(option.priceMinor)}</b></button>)}</div>}
    {selected?.servicePoint&&<div className={styles.pointSection}><h3>Choisissez votre point relais</h3>{!points.length?<p className={styles.empty}>Recherche des points disponibles…</p>:points.map(p=><button type="button" key={p.id} className={`${styles.pointCard} ${point?.id===p.id?styles.pointSelected:""}`} onClick={()=>setPoint(p)}><div><strong>{p.name}</strong><span>{p.address1}, {p.postalCode} {p.city}</span></div>{p.distanceM!=null&&<small>{Math.round(p.distanceM)} m</small>}</button>)}</div>}
   </div>

   <div className={styles.card}><div className={styles.step}><span>3</span><div><strong>Paiement protégé</strong><small>Le paiement passe par le prestataire marketplace; Petit Annonces ne stocke pas votre carte.</small></div></div><div className={styles.protection}><b>🛡️ Protection acheteur</b><p>Le vendeur est payé selon l’état de livraison et la fenêtre de protection. En cas de problème, la commande reste liée au litige et au remboursement.</p></div></div>
  </section>

  <aside className={styles.summary}>
   <div className={styles.summaryCard}><p className={styles.eyebrow}>Récapitulatif</p><h2>Votre commande</h2><div className={styles.summaryLine}><span>Article</span><b>{itemAmountMinor?euro(itemAmountMinor):"Calculé au paiement"}</b></div><div className={styles.summaryLine}><span>Livraison</span><b>{selected?euro(selected.priceMinor):"—"}</b></div><div className={styles.summaryLine}><span>Protection acheteur</span><b>{itemAmountMinor?euro(buyerFee):"—"}</b></div>{itemAmountMinor>0&&<div className={`${styles.summaryLine} ${styles.total}`}><span>Total estimé</span><b>{euro(total)}</b></div>}<button className={styles.primaryButton} disabled={loading||!selected||(selected.servicePoint&&!point)} onClick={continueToPayment}>{loading?"Préparation…":"Continuer vers le paiement sécurisé"}</button><small className={styles.secure}>🔒 Connexion chiffrée · livraison gérée via Sendcloud</small>{error&&<p className={styles.error}>{error}</p>}</div>
  </aside>
 </div>;
}
