import { adminServerFetch } from "../../../lib/server-api";
import { AdminIcon } from "../../../components/admin-icon";
type Status={publishedListings:number;eligibleProducts:number;candidatesAfterCommerceFilters:number;categories:Record<string,number>;feedUrl:string;accountConnection:string};
const number=(v:number)=>v.toLocaleString("fr-FR");
export default async function MerchantPage(){
 const d=await adminServerFetch<Status>("/admin/merchant/status");
 return <div>
  <div className="admin-page-head"><div><p>Marketing</p><h1>Google Merchant Center</h1><span className="subtitle">Flux produits dynamique · Petitannonces.fr</span></div><a className="admin-btn" href="https://merchants.google.com/" target="_blank" rel="noreferrer"><AdminIcon name="external"/>Merchant Center</a></div>
  {!d?<section className="admin-card admin-section"><p>Statistiques du flux indisponibles.</p></section>:<>
   <div className="admin-grid admin-kpis">
    <article className="admin-card admin-kpi"><small>Annonces publiées</small><strong>{number(d.publishedListings)}</strong><p>Toutes catégories</p></article>
    <article className="admin-card admin-kpi"><small>Produits éligibles</small><strong>{number(d.eligibleProducts)}</strong><p>Prix, photo, état, paiement et livraison</p></article>
    <article className="admin-card admin-kpi"><small>Candidats vérifiés</small><strong>{number(d.candidatesAfterCommerceFilters)}</strong><p>Avant les contrôles finaux</p></article>
   </div>
   <section className="admin-card admin-section" style={{marginTop:16}}>
    <div className="admin-section-head"><div><h2>Flux Google Shopping</h2><p>Les annonces vendues, supprimées ou expirées sont automatiquement retirées du flux.</p></div><span className="admin-seo-warn">Compte Google à connecter</span></div>
    <p><strong>URL :</strong> <a href={d.feedUrl} target="_blank" rel="noreferrer">{d.feedUrl}</a></p>
    <p>Ce flux est prêt pour une source de données Merchant Center multi-vendeurs. La soumission et la diffusion Google ne sont pas encore activées.</p>
    <p>Avant activation : valider le compte marketplace, les réglages de livraison, les retours et le domaine du site.</p>
   </section>
   <section className="admin-card admin-section" style={{marginTop:16}}><h2>Catégories incluses</h2>
    {Object.entries(d.categories).length?<div className="admin-seo-list">{Object.entries(d.categories).sort((a,b)=>b[1]-a[1]).map(([name,count])=><div key={name}><span>{name}</span><strong>{number(count)}</strong></div>)}</div>:<p>Aucun produit ne remplit encore tous les critères. Vérifier l’état, le paiement et la livraison des annonces.</p>}
   </section>
  </>}
 </div>;
}
