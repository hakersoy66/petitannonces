import styles from "./page.module.css";

export default function Loading(){
  return <main className={styles.loadingShell} aria-busy="true" aria-label="Chargement des annonces">
    <div className={styles.loadingSearch}/>
    <div className={styles.loadingGrid}>{Array.from({length:8},(_,i)=><div className={styles.loadingCard} key={i}/>)}</div>
  </main>;
}
