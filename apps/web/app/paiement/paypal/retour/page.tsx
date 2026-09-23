import { Suspense } from "react";
import { PayPalReturnClient } from "./paypal-return-client";

export default function PayPalReturnPage(){
 return <Suspense fallback={<main style={{minHeight:"60vh",display:"grid",placeItems:"center"}}><p>Confirmation PayPal…</p></main>}><PayPalReturnClient/></Suspense>;
}

