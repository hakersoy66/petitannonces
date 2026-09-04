import { SiteHeader } from "../../components/site-header";
import { CheckoutClient } from "./checkout-client";

export const metadata = {
  title: "Paiement sécurisé | Petit Annonces",
  description: "Choisissez votre livraison Sendcloud puis finalisez votre achat protégé sur Petit Annonces.",
};

export default async function CheckoutPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const params=await searchParams;
  const listingId=typeof params.listingId==="string"?params.listingId:"";
  return (
    <>
      <SiteHeader />
      <main className="site-shell" style={{paddingBlock:36}}>
        <div style={{maxWidth:1180,margin:"0 auto 22px"}}>
          <p className="eyebrow">Paiement protégé</p>
          <h1 style={{marginBottom:8}}>Finaliser votre achat</h1>
          <p className="muted" style={{maxWidth:760}}>Les informations de l’annonce et du colis sont chargées automatiquement. Choisissez votre adresse et votre livraison Sendcloud, puis poursuivez vers le paiement sécurisé.</p>
        </div>
        <div style={{maxWidth:1180,margin:"0 auto"}}><CheckoutClient listingId={listingId} /></div>
      </main>
    </>
  );
}
