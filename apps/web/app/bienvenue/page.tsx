"use client";

import { SiteHeader } from "../../components/site-header";
import styles from "./page.module.css";

const pieces = Array.from({ length: 34 }, (_, index) => ({
  left: `${(index * 29) % 100}%`,
  delay: `${(index % 9) * 0.22}s`,
  duration: `${4.8 + (index % 7) * 0.35}s`,
}));

export default function WelcomePage(){
  return <div className={styles.page}>
    <SiteHeader/>
    <div className={styles.confetti} aria-hidden="true">{pieces.map((piece,index)=><span key={index} className={styles.piece} style={{left:piece.left,animationDelay:piece.delay,animationDuration:piece.duration}}/>)}</div>
    <main className={styles.main}>
      <section className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>Bienvenue chez Petit Annonces 🎉</span>
          <h1 className={styles.title}>Vous avez fait un bon choix.</h1>
          <p className={styles.lead}>Votre inscription vous ouvre un espace plus simple pour publier, acheter, vendre, négocier et suivre toute votre activité. Plus votre profil est complet, plus vous gagnez en confiance et en efficacité sur la plateforme.</p>
          <div className={styles.actions}>
            <a className={styles.primary} href="/connexion">Se connecter à mon compte</a>
            <a className={styles.secondary} href="/mon-compte/portefeuille">Voir mon portefeuille</a>
          </div>
        </div>
        <aside className={styles.gift}>
          <small>Cadeau de bienvenue</small>
          <strong>20 PA</strong>
          <p>Vos 20 crédits PA sont ajoutés automatiquement après la vérification de votre e-mail.</p>
          <div className={styles.giftNote}>Utilisables uniquement sur Petit Annonces pour les fonctionnalités éligibles. Non convertibles en euros et non retirables.</div>
        </aside>
      </section>

      <section className={styles.grid}>
        <article className={styles.card}><div className={styles.icon}>＋</div><h3>Publiez plus facilement</h3><p>Des formulaires adaptés à chaque catégorie vous aident à créer des annonces plus complètes et plus attractives.</p></article>
        <article className={styles.card}><div className={styles.icon}>✉</div><h3>Centralisez vos échanges</h3><p>Messages, offres et transactions restent regroupés dans votre compte pour vous faire gagner du temps.</p></article>
        <article className={styles.card}><div className={styles.icon}>✓</div><h3>Renforcez votre confiance</h3><p>Profil vérifié, historique, sécurité et outils de modération rendent vos échanges plus rassurants.</p></article>
      </section>
    </main>
  </div>
}
