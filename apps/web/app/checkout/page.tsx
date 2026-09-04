import { SiteHeader } from "../../components/site-header";
import { CheckoutClient } from "./checkout-client";

export const metadata = {
  title: "Paiement sécurisé | Petit Annonces",
  description: "Choisissez votre livraison Sendcloud puis finalisez votre achat protégé sur Petit Annonces.",
};

export default async function CheckoutPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const params=await searchParams;
  const listingId=typeof params.listingId==="string"?params.listingId:"";
  const fromPostalCode=typeof params.fromPostalCode==="string"?params.fromPostalCode:"75001";
  const parsedAmount=typeof params.itemAmountMinor==="string"?Number(params.itemAmountMinor):0;
  const itemAmountMinor=Number.isInteger(parsedAmount)&&parsedAmount>0?parsedAmount:0;

  return (
    <>
      <SiteHeader />
      <main className="site-shell" style={{paddingBlock:36}}>
        <div style={{maxWidth:1180,margin:"0 auto 22px"}}>
          <p className="eyebrow">Paiement protégé</p>
          <h1 style={{marginBottom:8}}>Finaliser votre achat</h1>
          <p className="muted" style={{maxWidth:760}}>Choisissez votre mode de livraison parmi les options proposées par Sendcloud, sélectionnez un point relais lorsque nécessaire, puis poursuivez vers le paiement sécurisé.</p>
        </div>
        <div style={{maxWidth:1180,margin:"0 auto"}}>
          <CheckoutClient listingId={listingId} fromPostalCode={fromPostalCode} itemAmountMinor={itemAmountMinor} />
        </div>
      </main>
    </>
  );
}
