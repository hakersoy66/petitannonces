import type { Metadata } from 'next';
import PartnerApplicationForm from './partner-form';
import PricingGuide from './pricing-guide';
import styles from './page.module.css';

export const metadata:Metadata={
  title:'Devenir partenaire influenceur',
  description:'Proposez une collaboration avec Petit Annonces : Reels, vidéos et publications Instagram, TikTok, YouTube et Facebook.',
  alternates:{canonical:'https://petitannonces.fr/devenir-partenaire'},
  openGraph:{title:'Devenir partenaire | Petit Annonces',description:'Construisons une collaboration utile à votre communauté.',url:'https://petitannonces.fr/devenir-partenaire',type:'website'}
};
const steps=[
  {n:'01',title:'Présentez votre communauté',description:'Partagez votre réseau, votre audience et les performances moyennes de vos contenus.'},
  {n:'02',title:'Recevez une réponse',description:'Notre équipe examine votre proposition et vous recontacte si elle correspond aux campagnes disponibles.'},
  {n:'03',title:'Créez ensemble',description:'Nous définissons les livrables, les dates et les conditions dans un accord clair.'}
];
export default function PartnerPage(){return <main className={styles.page}>
  <section className={styles.hero}>
    <div className={styles.shell}>
      <a className={styles.eyebrow} href="/">Petit Annonces <span>／</span> Partenariats</a>
      <div className={styles.heroGrid}>
       <div>
        <span className={styles.pill}><span className={styles.dot}/> Collaborations créateurs</span>
        <h1>Votre communauté.<br/><em>De belles opportunités.</em></h1>
        <p className={styles.lead}>Vous créez des Reels, des Stories ou des vidéos qui inspirent les Français ? Faisons découvrir ensemble une nouvelle façon d'acheter et de vendre près de chez soi.</p>
        <a className={styles.heroButton} href="#candidature">Proposer une collaboration <span aria-hidden="true">↗</span></a>
        <p className={styles.fine}>Instagram · TikTok · YouTube · Facebook · <a href="#tarifs" style={{color:'#fff',textUnderlineOffset:4}}>Voir les rémunérations ↗</a></p>
       </div>
       <div className={styles.visual} aria-hidden="true">
         <div className={styles.visualGlow}/>
         <div className={styles.visualCard}><span>✦ Petit Annonces</span><strong>Votre voix<br/>fait la différence.</strong><p>Créez du contenu authentique. Partagez des découvertes locales.</p><div className={styles.visualFoot}><span>FRANCE</span><span>↗ CRÉATEURS</span></div></div>
         <div className={styles.bubbleOne}>♥ Communauté</div>
         <div className={styles.bubbleTwo}>◉ Créativité</div>
       </div>
      </div>
    </div>
  </section>
  <div className={styles.shell}>
   <section className={styles.steps} aria-label="Comment ça marche ?">{steps.map(item=><article key={item.n}><span>{item.n}</span><h2>{item.title}</h2><p>{item.description}</p></article>)}</section>
   <PricingGuide/>
   <section className={styles.application} id="candidature">
    <div className={styles.left}>
      <span className={styles.kicker}>REJOIGNEZ LE PROGRAMME</span>
      <h2>Parlons de votre prochaine collaboration.</h2>
      <p>Pas besoin d’un nombre minimum d’abonnés : nous privilégions une audience réelle, un contenu de qualité et une communauté engagée en France.</p>
      <div className={styles.points}><span>✓</span><p>Réponse après étude de votre profil</p></div>
      <div className={styles.points}><span>✓</span><p>Budget et livrables convenus avant toute publication</p></div>
      <div className={styles.points}><span>✓</span><p>Aucun partenariat garanti par l’envoi du formulaire</p></div>
      <p className={styles.privacy}>Vos informations servent exclusivement à étudier votre proposition et à vous contacter au sujet de cette collaboration. Consultez notre <a href="/confidentialite">politique de confidentialité</a>.</p>
    </div>
    <div className={styles.formCard}><PartnerApplicationForm/></div>
   </section>
  </div>
 </main>;}
