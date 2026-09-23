import type { Metadata } from "next";
import { AppIcon } from "../../components/app-icon";
import { PostPublicationShare } from "../../components/post-publication-share";
import styles from "./page.module.css";

export const metadata:Metadata={title:"Annonce ajoutée | Petit Annonces",robots:{index:false,follow:false}};

export default async function Page({searchParams}:{searchParams:Promise<{status?:string;slug?:string;promotion?:string}>}){
 const q=await searchParams;const live=q.status==="PUBLISHED";const slug=q.slug;const promoted=q.promotion==="success";
 return <div className={styles.page}><main className={styles.shell}><section className={styles.card}><div className={styles.icon}><AppIcon name="circle-check"/></div><span className={styles.kicker}>Publication réussie</span><h1>Félicitations, votre annonce a bien été ajoutée !</h1><p>{live?"Votre annonce est maintenant en ligne sur Petit Annonces.":promoted?"Votre option de visibilité a été activée et votre annonce a été envoyée en modération. Le badge sera conservé lors de sa mise en ligne après validation.":"Votre annonce a été enregistrée et envoyée pour vérification. Vous pouvez suivre son statut depuis « Mes annonces »."}</p><div className={styles.steps}><article><AppIcon name="check"/><div><strong>Annonce enregistrée</strong><span>Vos informations et photos ont bien été prises en compte.</span></div></article><article><AppIcon name="shield"/><div><strong>{live?"Annonce en ligne":"Vérification en cours"}</strong><span>{live?"Elle peut maintenant être consultée par les acheteurs.":"Notre contrôle protège la qualité et la sécurité de la plateforme."}</span></div></article></div><div className={styles.actions}><a className={styles.primary} href="/mon-compte/annonces"><AppIcon name="list"/>Aller à mes annonces</a>{live&&slug&&<PostPublicationShare slug={slug} className={styles.secondary}/>} {live&&slug&&<a className={styles.secondary} href={`/annonce/${encodeURIComponent(slug)}`}><AppIcon name="arrow-right"/>Voir mon annonce</a>}<a className={styles.ghost} href="/deposer-une-annonce"><AppIcon name="plus"/>Ajouter une autre annonce</a></div></section></main></div>
}

