"use client";

import {useEffect,useMemo,useState} from "react";
import {AppIcon} from "./app-icon";
import styles from "./listing-wizard.module.css";

type PromotionOffer={id:string;code:string;type:string;name:string;description:string|null;priceMinor:number;currency:string;durationHours:number|null};
type WalletReply={wallet?:{balanceMinor:number;currency:string}};

const api=()=> (process.env.NEXT_PUBLIC_API_URL??"/api").replace(/\/$/,"");
const money=(minor:number,currency="EUR")=>new Intl.NumberFormat("fr-FR",{style:"currency",currency,maximumFractionDigits:2}).format(minor/100);
const duration=(hours:number|null)=>!hours?"Durée continue":hours%24===0?String(hours/24)+" jours":String(hours)+" h";

export function ListingVisibilityStep({
 listingId,selectedCode,onSelect,onBack,onContinue,
}:{listingId:string;selectedCode:string;onSelect:(code:string,name:string)=>void;onBack:()=>void;onContinue:()=>void}){
 const[products,setProducts]=useState<PromotionOffer[]>([]);
 const[balance,setBalance]=useState(0);
 const[currency,setCurrency]=useState("EUR");
 const[loading,setLoading]=useState(true);
 const[message,setMessage]=useState("");

 useEffect(()=>{let cancelled=false;(async()=>{
  setLoading(true);
  try{
   const [productsResponse,walletResponse]=await Promise.all([
    fetch(api()+"/promotions/products",{credentials:"include",cache:"no-store"}),
    fetch(api()+"/promotions/wallet",{credentials:"include",cache:"no-store"}),
   ]);
   const productsPayload=productsResponse.ok?await productsResponse.json():{products:[]};
   const walletPayload=walletResponse.ok?await walletResponse.json() as WalletReply:{};
   if(cancelled)return;
   setProducts(Array.isArray(productsPayload.products)?productsPayload.products:[]);
   setBalance(Number(walletPayload.wallet?.balanceMinor??0));
   setCurrency(String(walletPayload.wallet?.currency??"EUR"));
  }catch{if(!cancelled)setMessage("Les options de visibilité ne peuvent pas être chargées pour le moment. Vous pouvez continuer gratuitement.")}finally{if(!cancelled)setLoading(false)}
 })();return()=>{cancelled=true}},[listingId]);

 const recommended=useMemo(()=>products.find(p=>p.type==="FEATURED")??products[0]??null,[products]);
 const selected=products.find(p=>p.code===selectedCode)??null;
 const covered=Boolean(selected&&balance>=selected.priceMinor);

 return <section className={styles.card}>
  <div className={styles.cardHead}><div><span className={styles.kicker}>Étape 5 sur 6</span><h2>Donnez plus de visibilité à votre annonce</h2><p>Cette étape est facultative. Choisissez une mise en avant ou continuez gratuitement. Aucune option payante n’est sélectionnée automatiquement.</p></div><span className={styles.headIcon}><AppIcon name="sparkles"/></span></div>
  <div className={styles.visibilityWallet}><span><AppIcon name="wallet"/></span><div><small>Votre crédit Petit Annonces</small><strong>{money(balance,currency)}</strong><p>{balance>0?"Si votre crédit couvre l’option choisie, il sera utilisé automatiquement.":"Vous pouvez continuer sans option de visibilité."}</p></div></div>
  {message&&<div className={styles.stepRequirement}><AppIcon name="info"/>{message}</div>}
  <div className={styles.visibilityChoices}>
   <button type="button" className={styles.visibilityChoice+" "+(selectedCode===""?styles.visibilityChoiceActive:"")} onClick={()=>onSelect("","Sans option")}>
    <span className={styles.visibilityChoiceIcon}><AppIcon name="circle-check"/></span>
    <div><span className={styles.visibilityChoiceTop}><strong>Sans option</strong><em>Gratuit</em></span><p>Votre annonce passe normalement en modération, sans mise en avant payante.</p></div>
   </button>
   {loading?<div className={styles.visibilityLoading}>Chargement des options…</div>:products.map(product=>{
    const active=selectedCode===product.code;const isRecommended=recommended?.code===product.code;const canUseCredit=balance>=product.priceMinor;
    return <button type="button" key={product.id} className={styles.visibilityChoice+" "+(active?styles.visibilityChoiceActive:"")} onClick={()=>onSelect(product.code,product.name)}>
     <span className={styles.visibilityChoiceIcon}><AppIcon name={product.type==="URGENT"?"bolt":"sparkles"}/></span>
     <div><span className={styles.visibilityChoiceTop}><strong>{product.name}</strong><em>{money(product.priceMinor,product.currency)}</em></span>
      <span className={styles.visibilityMeta}>{isRecommended&&<b>Recommandé</b>}<small>{duration(product.durationHours)}</small>{canUseCredit&&<small className={styles.visibilityCreditTag}>Payable avec votre crédit</small>}</span>
      <p>{product.description||"Améliore la visibilité de votre annonce pendant la durée choisie."}</p>
     </div>
    </button>
   })}
  </div>
  {selected&&<div className={covered?styles.visibilityPaymentReady:styles.visibilityPaymentInfo}><AppIcon name={covered?"wallet":"credit-card"}/><div><strong>{covered?"Votre crédit couvrira cette option":"Paiement nécessaire après vérification"}</strong><span>{covered?money(selected.priceMinor,selected.currency)+" seront débités de votre crédit après votre confirmation finale.":"Votre solde est de "+money(balance,currency)+". L’option sera réglée via le paiement sécurisé après votre confirmation finale."}</span></div></div>}
  <div className={styles.footer}><button type="button" className={styles.secondary} onClick={onBack}><AppIcon name="arrow-left"/>Précédent</button><button type="button" onClick={onContinue}>Suivant : Vérification<AppIcon name="arrow-right"/></button></div>
 </section>;
}
