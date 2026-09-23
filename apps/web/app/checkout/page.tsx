import type { Metadata } from "next";
import { cookies } from "next/headers";
import { CheckoutClient, type CheckoutContext } from "./checkout-client";
import styles from "./page.module.css";

export const metadata:Metadata={
  title:{absolute:"Paiement sécurisé | Petit Annonces"},
  description:"Choisissez votre mode de livraison puis finalisez votre achat protégé sur Petit Annonces.",
};

const base=()=> (process.env.API_INTERNAL_URL??process.env.NEXT_PUBLIC_API_URL??"http://127.0.0.1:4000").replace(/\/$/,"");

async function checkoutData(listingId:string,offerId:string,cookieHeader:string):Promise<{context:CheckoutContext|null;error:string|null}> {
  if(!listingId)return{context:null,error:"missing_listing"};
  try{
    const url=`${base()}/checkout/listings/${encodeURIComponent(listingId)}/context${offerId?`?offerId=${encodeURIComponent(offerId)}`:""}`;
    const response=await fetch(url,{cache:"no-store",headers:cookieHeader?{cookie:cookieHeader}:undefined});
    const payload=await response.json().catch(()=>({})) as CheckoutContext&{error?:string};
    if(!response.ok)return{context:null,error:payload.error??"context_failed"};
    return{context:payload,error:null};
  }catch{return{context:null,error:null}}
}

export default async function CheckoutPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const [params,cookieStore]=await Promise.all([searchParams,cookies()]);
  const listingId=typeof params.listingId==="string"?params.listingId:"";
  const offerId=typeof params.offerId==="string"?params.offerId:"";
  const cookieHeader=cookieStore.getAll().map(cookie=>`${cookie.name}=${cookie.value}`).join("; ");
  const checkout=await checkoutData(listingId,offerId,cookieHeader);
  return <>

    <main className={styles.checkoutPage}>
      <header className={styles.checkoutHero}>
        <div><p className={styles.eyebrow}>Paiement protégé</p><h1>Finaliser votre achat</h1><p>Adresse, livraison et paiement sécurisé réunis dans un parcours simple.</p></div>
        <div className={styles.checkoutTrust}><span>🔒 Paiement sécurisé</span><span>✓ Livraison possible</span><span>✓ Protection acheteur</span></div>
      </header>
      <div className={styles.checkoutProgress}><div className={styles.progressActive}><b>1</b><span>Adresse</span></div><div><b>2</b><span>Livraison</span></div><div><b>3</b><span>Paiement</span></div></div>
      <CheckoutClient listingId={listingId} offerId={offerId} initialContext={checkout.context} initialError={checkout.error}/>
    </main>
  </>;
}
