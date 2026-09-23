import type {Metadata} from "next";
import {AppIcon} from "../../components/app-icon";
import {CampaignLink} from "../../components/campaign-link";
import styles from "./page.module.css";

export const metadata:Metadata={
 title:"Vendre sa voiture gratuitement | Petit Annonces",
 description:"Publiez votre annonce automobile sur Petit Annonces. Sélectionnez votre véhicule, utilisez votre plaque pour préremplir les informations disponibles et publiez gratuitement.",
 alternates:{canonical:"https://petitannonces.fr/vendre-voiture"},
 openGraph:{title:"Vendez votre voiture facilement | Petit Annonces",description:"Créez votre annonce auto en quelques minutes et publiez gratuitement.",url:"https://petitannonces.fr/vendre-voiture",type:"website"}
};

type Params=Record<string,string|string[]|undefined>;
type Props={searchParams:Promise<Params>};
const TRACKING_KEYS=["utm_source","utm_medium","utm_campaign","utm_content","utm_term","fbclid","gclid","gbraid","wbraid","msclkid"] as const;
function first(value:string|string[]|undefined){return Array.isArray(value)?value[0]:value}

export default async function SellCarLanding({searchParams}:Props){
 const params=await searchParams;
 const next=new URLSearchParams({mode:"manual",category:"vehicules"});
 for(const key of TRACKING_KEYS){const value=first(params[key]);if(value)next.set(key,value)}
 const cta=`/deposer-une-annonce?${next.toString()}`;
 return <div className={styles.page}>
  
  <main>
   <section className={styles.hero}>
    <div className={styles.heroInner}>
     <div className={styles.copy}>
      <span className={styles.kicker}><AppIcon name="car"/> Vente automobile</span>
      <h1>Vendez votre voiture <em>plus simplement.</em></h1>
      <p>Créez votre annonce en quelques minutes. Pour un véhicule français, votre plaque peut préremplir automatiquement les informations disponibles avant que vous les vérifiiez.</p>
      <div className={styles.heroPoints}>
       <span><AppIcon name="circle-check"/> Dépôt gratuit</span>
       <span><AppIcon name="camera"/> Photos & prix libres</span>
       <span><AppIcon name="shield"/> Contrôle avant publication</span>
      </div>
      <div className={styles.ctaRow}><CampaignLink className={styles.primary} href={cta} cta="hero_primary" landing="/vendre-voiture" campaign="vehicle_seller">Publier mon véhicule <AppIcon name="arrow-right"/></CampaignLink><small>Aucun paiement requis pour déposer l’annonce.</small></div>
     </div>
     <div className={styles.visual} aria-label="Création simplifiée d’une annonce automobile">
      <div className={styles.plate}><span>F</span><b>AB-123-CD</b></div>
      <div className={styles.car}><AppIcon name="car"/></div>
      <div className={`${styles.floatCard} ${styles.auto}`}><AppIcon name="wand"/><div><strong>Informations disponibles</strong><small>Préremplies depuis la plaque</small></div></div>
      <div className={`${styles.floatCard} ${styles.photos}`}><AppIcon name="camera"/><div><strong>Ajoutez vos photos</strong><small>Choisissez votre couverture</small></div></div>
      <div className={`${styles.floatCard} ${styles.price}`}><AppIcon name="credit-card"/><div><strong>Fixez votre prix</strong><small>Vous gardez le contrôle</small></div></div>
     </div>
    </div>
   </section>

   <section className={styles.steps}>
    <div className={styles.shell}>
     <div className={styles.sectionHead}><span>Simple et rapide</span><h2>De la plaque à l’annonce en quelques étapes</h2><p>Vous contrôlez toujours les informations avant l’envoi en modération.</p></div>
     <div className={styles.stepGrid}>
      <article><i>1</i><span><AppIcon name="car"/></span><h3>Choisissez votre véhicule</h3><p>La catégorie Véhicules est déjà préparée lorsque vous arrivez depuis cette page.</p></article>
      <article><i>2</i><span><AppIcon name="camera"/></span><h3>Ajoutez vos photos</h3><p>Présentez l’extérieur, l’intérieur et les détails importants du véhicule.</p></article>
      <article><i>3</i><span><AppIcon name="list"/></span><h3>Complétez les détails</h3><p>Entrez votre plaque pour préremplir les données disponibles, puis vérifiez-les.</p></article>
      <article><i>4</i><span><AppIcon name="credit-card"/></span><h3>Prix & publication</h3><p>Fixez votre prix et envoyez l’annonce au contrôle avant sa mise en ligne.</p></article>
     </div>
    </div>
   </section>

   <section className={styles.trust}>
    <div className={styles.shell}>
     <div className={styles.trustCopy}><span>Petit Annonces</span><h2>Une annonce claire inspire davantage confiance.</h2><p>Photos, caractéristiques, localisation approximative et informations utiles sont regroupées dans un parcours guidé pensé pour le mobile comme pour l’ordinateur.</p><CampaignLink className={styles.secondary} href={cta} cta="trust_secondary" landing="/vendre-voiture" campaign="vehicle_seller">Commencer mon annonce <AppIcon name="arrow-right"/></CampaignLink></div>
     <div className={styles.trustCards}>
      <article><AppIcon name="shield"/><div><strong>Modération</strong><small>Les annonces sont soumises aux contrôles de sécurité avant publication.</small></div></article>
      <article><AppIcon name="location"/><div><strong>France entière</strong><small>Votre annonce peut être découverte par des acheteurs partout en France.</small></div></article>
      <article><AppIcon name="message"/><div><strong>Messagerie intégrée</strong><small>Les acheteurs peuvent vous contacter directement depuis Petit Annonces.</small></div></article>
     </div>
    </div>
   </section>
   <CampaignLink className={styles.mobileCta} href={cta} cta="mobile_sticky" landing="/vendre-voiture" campaign="vehicle_seller">Publier mon véhicule <AppIcon name="arrow-right"/></CampaignLink>
  </main>
 </div>;
}