import type {Metadata} from "next";
import {AboutExperience} from "./about-experience";
import styles from "./page.module.css";

export const metadata:Metadata={
 title:"Qui sommes-nous ? | Petit Annonces",
 description:"Découvrez Petit Annonces, une marketplace française pensée pour publier plus simplement, acheter avec davantage de confiance et profiter d’outils modernes assistés par l’intelligence artificielle.",
 alternates:{canonical:"https://petitannonces.fr/qui-sommes-nous"},
 openGraph:{title:"Qui sommes-nous ? | Petit Annonces",description:"Une marketplace française construite autour de la simplicité, de la confiance et d’outils intelligents.",url:"https://petitannonces.fr/qui-sommes-nous",type:"website"},
};

const trustItems=[
 {k:"01",title:"Modération & anti-spam",text:"Contrôles automatiques, règles anti-abus, signalements et outils de modération pour intervenir plus vite."},
 {k:"02",title:"Profils & réputation",text:"Les profils, informations professionnelles et historiques visibles aident acheteurs et vendeurs à mieux se connaître."},
 {k:"03",title:"Paiement encadré",text:"Pour les transactions compatibles, les parcours de paiement et de versement sont structurés et suivis étape par étape."},
 {k:"04",title:"Support & conformité",text:"Centre d’aide, confidentialité, conformité et outils internes font partie du produit dès sa conception."},
];

const buildAreas=["Recherche IA","Publication guidée","Véhicules","Immobilier","Vacances","Boutiques Pro","Paiements","Messagerie","PWA","Android","Notifications","SEO","Modération","Support","Administration"];

type AboutBrand={logoUrl?:string|null;mobileLogoUrl?:string|null;appLogoUrl?:string|null;pwaIconUrl?:string|null;pwaIcon512Url?:string|null};
async function getAboutBrand():Promise<AboutBrand>{
 const base=(process.env.API_INTERNAL_URL??process.env.NEXT_PUBLIC_API_URL??"http://127.0.0.1:4100").replace(/\/$/,"");
 try{const response=await fetch(`${base}/public/site-config`,{next:{revalidate:15},signal:AbortSignal.timeout(1500)});if(!response.ok)return{};const payload=await response.json() as{site?:AboutBrand};return payload.site??{}}catch{return{}}
}

export default async function AboutPage(){
 const brand=await getAboutBrand();
 const heroLogo=brand.appLogoUrl??brand.pwaIcon512Url??brand.pwaIconUrl??brand.mobileLogoUrl??brand.logoUrl??"/icons/icon-192.png";
 return <>
 
 <AboutExperience/>
 <main className={styles.page}>
  <section className={styles.hero}>
   <div className={styles.mesh} aria-hidden="true"><i/><i/><i/></div>
   <div className={styles.shell}>
    <div className={styles.heroGrid}>
     <div className={styles.heroCopy} data-about-reveal>
      <div className={styles.heroBadge}><span className={styles.badgeDot}/>Marketplace française nouvelle génération</div>
      <h1>Petit Annonces, pensé pour rendre la vente entre particuliers <span>plus simple, plus rapide, plus sûre.</span></h1>
      <p>Nous construisons une marketplace française qui réduit les étapes inutiles, aide à publier plus vite et donne davantage de repères aux acheteurs, vendeurs et professionnels.</p>
      <div className={styles.heroActions}><a className={styles.primary} href="/deposer-une-annonce">Déposer une annonce <b>→</b></a><a className={styles.secondary} href="/recherche">Explorer la marketplace</a></div>
      <div className={styles.madeFrance}>
       <div className={styles.seal}><span>FR</span><small>2026</small></div>
       <div><small>UNE PLATEFORME PENSÉE EN FRANCE</small><strong>Made in France <span>🇫🇷</span></strong><p>Conçue pour les usages français, les villes françaises et les besoins locaux des particuliers comme des professionnels.</p></div>
       <div className={styles.flagWave} aria-hidden="true"><span className={styles.flagPole}/><div className={styles.flagCloth}><i/><i/><i/><b/><em/></div></div>
      </div>
     </div>

     <div className={styles.heroStage} data-about-reveal>
      <div className={styles.orbitOne}/><div className={styles.orbitTwo}/>
      <div className={styles.appFrame}>
       <div className={styles.appTop}><div className={styles.appBrand}><img src={heroLogo} alt="Petit Annonces"/></div><div className={styles.appDots}><i/><i/><i/></div></div>
       <div className={styles.appSearch}><span>Que recherchez-vous ?</span><b>IA</b></div>
       <div className={styles.appGrid}><article><div/><strong>Véhicules</strong><small>près de chez vous</small></article><article><div/><strong>Maison</strong><small>bonnes affaires</small></article><article><div/><strong>High-tech</strong><small>occasion & neuf</small></article></div>
       <div className={styles.appBottom}><span>Accueil</span><b>＋ Déposer</b><span>Messages</span></div>
       <div className={styles.scanLine}/>
      </div>
      <div className={`${styles.floatStat} ${styles.floatA}`}><small>Annonce</small><strong>Quelques secondes</strong><span>pour démarrer</span></div>
      <div className={`${styles.floatStat} ${styles.floatB}`}><small>Confiance</small><strong>Modération active</strong><span>acheteur & vendeur</span></div>
      <div className={`${styles.floatStat} ${styles.floatC}`}><small>IA</small><strong>Assistive</strong><span>recherche & rédaction</span></div>
     </div>
    </div>

    <div className={styles.metrics} data-about-reveal>
     <article><strong>30 000+</strong><span>lignes de code applicatif</span><small>Web, API, Admin et Mobile</small></article>
     <article><strong>200+</strong><span>heures de travail</span><small>estimation cumulée · conception, développement, tests</small></article>
     <article><strong>4</strong><span>expériences reliées</span><small>Web · PWA · Android · Administration</small></article>
     <article><strong>24/7</strong><span>plateforme accessible</span><small>supervision, support et outils internes</small></article>
    </div>
   </div>
  </section>

  <section className={styles.manifesto}>
   <div className={styles.shell}>
    <div className={styles.manifestoGrid} data-about-reveal>
     <div><span className={styles.eyebrow}>NOTRE MANIÈRE DE CONSTRUIRE</span><h2>Pas un simple site d’annonces. Un produit complet qui évolue en continu.</h2></div>
     <div className={styles.manifestoText}><p>Une annonce doit pouvoir commencer sans formulaire interminable. Une recherche doit comprendre l’intention. Un vendeur doit pouvoir gérer son activité depuis son téléphone. Un professionnel doit pouvoir présenter ses annonces dans une vraie vitrine.</p><p>Notre direction reste la même : <strong>simplicité, vitesse, transparence et confiance.</strong></p></div>
    </div>
    <div className={styles.marquee} aria-label="Fonctionnalités Petit Annonces"><div>{[...buildAreas,...buildAreas].map((item,index)=><span key={`${item}-${index}`}>{item}<i>•</i></span>)}</div></div>
   </div>
  </section>

  <section className={styles.speedSection}>
   <div className={styles.shell}>
    <div className={styles.sectionHead} data-about-reveal><span className={styles.eyebrow}>PUBLIER PLUS VITE</span><h2>De l’idée à l’annonce, sans friction inutile.</h2><p>Le parcours est construit pour démarrer en quelques secondes et guider l’utilisateur étape par étape, sans sacrifier les informations utiles.</p></div>
    <div className={styles.speedGrid} data-about-reveal>
     <article><span>01</span><div className={styles.speedIcon}>＋</div><h3>Choisir</h3><p>Catégorie claire, sous-catégories adaptées et formulaire qui évolue selon le type d’annonce.</p></article>
     <article><span>02</span><div className={styles.speedIcon}>✦</div><h3>Accélérer</h3><p>Pré-remplissage lorsqu’il est disponible, aide IA à la description et automatisations utiles.</p></article>
     <article><span>03</span><div className={styles.speedIcon}>✓</div><h3>Vérifier</h3><p>Contrôles anti-spam, cohérence des champs et modération selon le niveau de risque.</p></article>
     <article><span>04</span><div className={styles.speedIcon}>↗</div><h3>Publier</h3><p>Une expérience pensée pour fonctionner aussi bien sur le web, en PWA que sur mobile.</p></article>
    </div>
   </div>
  </section>

  <section className={styles.trustSection}>
   <div className={styles.shell}>
    <div className={styles.trustIntro} data-about-reveal><span className={styles.eyebrow}>CONFIANCE DES DEUX CÔTÉS</span><h2>Nous travaillons autant pour l’acheteur que pour le vendeur.</h2><p>Une marketplace ne devient pas fiable grâce à un seul badge. La confiance vient d’une accumulation de contrôles, d’informations, de règles et d’outils opérationnels.</p></div>
    <div className={styles.trustSplit} data-about-reveal>
     <div className={styles.personCard}><div className={styles.avatarBuyer}>A</div><small>POUR L’ACHETEUR</small><h3>Plus de repères avant de s’engager.</h3><ul><li>Profil et réputation du vendeur</li><li>Messagerie intégrée</li><li>Signalement et support</li><li>Paiement structuré quand disponible</li></ul><div className={styles.trustMeter}><span>Repères & transparence</span><i><b/></i></div></div>
     <div className={styles.centerShield}><div>✓</div><span>Confiance<br/>Petit Annonces</span></div>
     <div className={styles.personCard}><div className={styles.avatarSeller}>V</div><small>POUR LE VENDEUR</small><h3>Des outils pour vendre sans perdre le contrôle.</h3><ul><li>Gestion des annonces</li><li>Modération anti-spam</li><li>Suivi des commandes et messages</li><li>Espace professionnel dédié</li></ul><div className={styles.trustMeter}><span>Contrôle & visibilité</span><i><b/></i></div></div>
    </div>
    <div className={styles.trustCards}>{trustItems.map(item=><article key={item.k} data-about-reveal><span>{item.k}</span><h3>{item.title}</h3><p>{item.text}</p></article>)}</div>
   </div>
  </section>

  <section className={styles.aiSection}>
   <div className={styles.shell}>
    <div className={styles.aiPanel} data-about-reveal>
     <div className={styles.aiGlow}/><div className={styles.aiGrid}/>
     <div className={styles.aiContent}><span className={styles.aiTag}>AI · ASSISTIVE BY DESIGN</span><h2>L’intelligence artificielle accélère l’expérience. Elle ne remplace pas la confiance.</h2><p>Nous utilisons l’IA pour rendre la recherche plus naturelle, aider à la rédaction et réduire les tâches répétitives. Les décisions sensibles restent encadrées par des règles, des contrôles et une supervision humaine.</p><div className={styles.aiChips}><span>Recherche intelligente</span><span>Descriptions assistées</span><span>Catégorisation</span><span>Amélioration continue</span></div></div>
     <div className={styles.aiVisual}><div className={styles.aiCore}>AI</div><i className={styles.nodeA}/><i className={styles.nodeB}/><i className={styles.nodeC}/><i className={styles.nodeD}/></div>
    </div>
   </div>
  </section>

  <section className={styles.buildSection}>
   <div className={styles.shell}>
    <div className={styles.buildGrid}>
     <div className={styles.buildCopy} data-about-reveal><span className={styles.eyebrow}>DES CENTAINES D’AMÉLIORATIONS</span><h2>Une plateforme construite couche après couche.</h2><p>Interface, recherche, catégories, paiement, PWA, Android, notifications, SEO, outils professionnels, modération, administration et support : le produit évolue comme un ensemble cohérent.</p><p>Chaque cycle suit la même logique : observer, construire, tester, corriger, déployer.</p><a href="/assistance">Découvrir le centre d’aide <b>→</b></a></div>
     <div className={styles.buildBoard} data-about-reveal>{buildAreas.map((area,index)=><div key={area} style={{"--delay":`${index*45}ms`} as React.CSSProperties}><i/><span>{area}</span><b>{String(index+1).padStart(2,"0")}</b></div>)}</div>
    </div>
   </div>
  </section>

  <section className={styles.finalCta}>
   <div className={styles.shell}>
    <div className={styles.ctaBox} data-about-reveal><div><span className={styles.eyebrow}>PETIT ANNONCES · FRANCE</span><h2>Construire moins de friction. Créer plus de confiance.</h2><p>Notre ambition : rendre les petites annonces plus simples à publier, plus faciles à trouver et plus rassurantes à utiliser au quotidien.</p></div><div className={styles.ctaActions}><a className={styles.primaryLight} href="/deposer-une-annonce">Déposer une annonce</a><a className={styles.ghostLight} href="/professionnels">Découvrir l’espace Pro</a></div></div>
    <p className={styles.disclaimer}>Les indicateurs de développement sont arrêtés en septembre 2026. Le volume de code correspond aux sources applicatives principales ; le temps de travail est une estimation cumulée de conception, développement, tests et amélioration.</p>
   </div>
  </section>
 </main>
 </>}
