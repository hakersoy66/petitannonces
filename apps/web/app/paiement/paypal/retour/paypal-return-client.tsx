"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

const API=process.env.NEXT_PUBLIC_API_URL??"/api";

export function PayPalReturnClient(){
 const search=useSearchParams();
 const orderId=search.get("orderId")??"";
 const paypalOrderId=search.get("token")??"";
 const [error,setError]=useState("");
 useEffect(()=>{
  if(!orderId||!paypalOrderId){setError("Le retour PayPal est incomplet.");return}
  let cancelled=false;
  (async()=>{
   try{
    const response=await fetch(`${API}/orders/${encodeURIComponent(orderId)}/paypal/capture`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({paypalOrderId})});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(String(payload.error??"paypal_capture_failed"));
    if(!cancelled)window.location.replace(`/commandes/${encodeURIComponent(orderId)}?paypal=success`);
   }catch(e){if(!cancelled)setError("Le paiement PayPal n’a pas pu être confirmé automatiquement. Votre compte ne sera pas considéré comme payé tant que PayPal n’aura pas confirmé la transaction.")}
  })();
  return()=>{cancelled=true};
 },[orderId,paypalOrderId]);
 return <main style={{minHeight:"60vh",display:"grid",placeItems:"center",padding:"32px 18px"}}>
  <section style={{width:"min(560px,100%)",background:"#fff",border:"1px solid #ececf3",borderRadius:22,padding:28,boxShadow:"0 14px 40px rgba(40,35,70,.08)",textAlign:"center"}}>
   <div style={{fontSize:18,fontWeight:900,color:"#003087",marginBottom:10}}>PayPal</div>
   <h1 style={{margin:"0 0 10px",fontSize:26}}>{error?"Confirmation nécessaire":"Confirmation du paiement…"}</h1>
   <p style={{margin:"0 0 18px",color:"#68667a",lineHeight:1.6}}>{error||"Nous vérifions le paiement auprès de PayPal. Ne fermez pas cette page."}</p>
   {error&&orderId&&<Link href={`/commandes/${encodeURIComponent(orderId)}`} style={{display:"inline-block",background:"#5b4cf0",color:"#fff",textDecoration:"none",fontWeight:800,borderRadius:12,padding:"12px 16px"}}>Voir ma commande</Link>}
  </section>
 </main>;
}