import { AppIcon } from "./app-icon";
import { EMPLOI_LOCAL_LANDINGS, emploiLocalHref } from "../lib/emploi-local";
import { EmploiTrackedLink } from "./emploi-analytics";
import styles from "./emploi-resources.module.css";

export function EmploiLocalDiscovery(){
 return <section className={styles.wrap} aria-labelledby="emploi-local-title">
  <div className={styles.head}><div><p className={styles.kicker}><AppIcon name="location"/> RECHERCHER PAR VILLE ET MÉTIER</p><h2 id="emploi-local-title">Votre métier, <span>près de chez vous</span></h2><p>Des recherches locales ciblées avec les offres France Travail correspondant aux départements.</p></div></div>
  <div className={styles.localGrid}>{EMPLOI_LOCAL_LANDINGS.map(x=><a key={x.city+"-"+x.sector} href={emploiLocalHref(x)}><AppIcon name="briefcase"/><span><strong>{x.role}</strong><small>{x.cityName} · {x.department}</small></span><AppIcon name="arrow-right"/></a>)}</div>
 </section>
}
export function EmploiOfficialResources(){
 return <section className={styles.wrap} id="ressources-officielles" aria-labelledby="emploi-extras">
  <div className={styles.head}>
   <div><p className={styles.kicker}><AppIcon name="sparkles"/> SERVICES OFFICIELS FRANCE TRAVAIL</p>
   <h2 id="emploi-extras">Encore plus loin dans <span>votre recherche</span></h2>
   <p>Explorez les entreprises susceptibles de recruter, les rencontres près de chez vous et les tendances du marché du travail.</p></div>
   <span className={styles.subtitle}>Accès aux plateformes officielles</span>
  </div>
  <div className={styles.cards}>
   <article className={styles.card}>
    <div className={styles.icon}><AppIcon name="store"/></div>
    <div className={styles.tag}>CANDIDATURE SPONTANÉE</div>
    <h3>Les entreprises à découvrir</h3>
    <p>La Bonne Boîte identifie les entreprises qui présentent un potentiel d'embauche. Choisissez votre métier et votre zone sur le site officiel.</p>
    <div className={styles.tags}><span>Entreprises</span><span>Près de chez vous</span></div>
    <EmploiTrackedLink href="https://labonneboite.francetravail.fr/" kind="labonneboite" label="official_company_discovery" external>Explorer La Bonne Boîte <AppIcon name="arrow-right"/></EmploiTrackedLink>
    <small>Consultation sur La Bonne Boîte. Les résultats ne sont pas importés ici.</small>
   </article>
   <article className={styles.card}>
    <div className={styles.icon}><AppIcon name="calendar"/></div>
    <div className={styles.tag}>RENCONTRES & RECRUTEMENT</div>
    <h3>Les événements emploi</h3>
    <p>Forums, ateliers, salons et job dating : recherchez les prochains événements par lieu et par date sur le calendrier France Travail.</p>
    <div className={styles.tags}><span>Job dating</span><span>Ateliers</span></div>
    <EmploiTrackedLink href="https://mesevenementsemploi.francetravail.fr/mes" kind="event" label="official_events_calendar" external>Voir le calendrier <AppIcon name="arrow-right"/></EmploiTrackedLink>
    <small>Dates et places disponibles à vérifier sur le site officiel.</small>
   </article>
   <article className={styles.card}>
    <div className={styles.icon}><AppIcon name="gauge" /></div>
    <div className={styles.tag}>CHIFFRES & TENDANCES</div>
    <h3>Comprendre le marché du travail</h3>
    <p>Comparez les métiers recherchés, les recrutements et les indicateurs des territoires sur Data Emploi de France Travail.</p>
    <div className={styles.tags}><span>Territoires</span><span>Statistiques</span></div>
    <EmploiTrackedLink href="https://dataemploi.francetravail.fr/emploi/panorama/NAT/FR" kind="market" label="official_market_dashboard" external>Consulter Data Emploi <AppIcon name="arrow-right"/></EmploiTrackedLink>
    <small>Statistiques et périodes de référence indiquées par Data Emploi.</small>
   </article>
  </div>
 </section>
}
