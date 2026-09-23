import { Suspense } from "react";
import { PayPalReturnClient } from "./paypal-return-client";

export default function PayPalReturnPage(){
 return <Suspense fallback={<main style={{minHeight:"60vh",display:"grid",placeItems:"center"}}><p>Confirmation PayPal…</p></main>}><PayPalReturnClient/></Suspense>;
}

[executed on device: mail.petitannonces.fr (b9fdfe5f-3df4-4e4a-a34e-5aa72c2ab64d)]