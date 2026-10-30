import styles from "./black-friday-banner.module.css";

export function BlackFridayBanner(){
  const now=Date.now();
  if(now<Date.parse("2026-10-30T00:00:00Z")||now>=Date.parse("2026-11-30T23:00:00Z"))return null;
  const started=now>=Date.parse("2026-11-19T23:00:00Z");
  return <section className={styles.band} style={{order:7}} aria-label="Black Friday 2026">
    <div className={styles.inner}>
      <div className={styles.emblem}><span>BLACK</span><strong>FRIDAY</strong><small>2026</small></div>
      <div className={styles.copy}>
        <span className={styles.kicker}>{started?"DU 20 AU 30 NOVEMBRE":"ÇA SE PRÉPARE · DU 20 AU 30 NOVEMBRE"}</span>
        <h2>{started?"Le rendez-vous des bonnes affaires.":"Le Black Friday arrive sur Petit Annonces."}</h2>
        <p>{started?"Explorez les annonces sélectionnées par les vendeurs.":"Vendeurs : préparez vos annonces dès aujourd’hui pour la sélection spéciale."}</p>
      </div>
      <a href="/black-friday">{started?"Voir la sélection":"Découvrir l’événement"} <span aria-hidden="true">→</span></a>
    </div>
  </section>;
}
