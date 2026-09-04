import { SiteHeader } from "../../../components/site-header";
import { SuccessClient } from "./success-client";

export const metadata={title:"Paiement | Petit Annonces",description:"Confirmation de votre paiement et suivi de commande Petit Annonces."};

export default async function CheckoutSuccessPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){const params=await searchParams;const orderId=typeof params.orderId==="string"?params.orderId:"";return <><SiteHeader/><main className="site-shell" style={{paddingBlock:28}}><SuccessClient orderId={orderId}/></main></>}
