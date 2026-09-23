import type {Metadata} from "next";
import {DeleteAccountClient} from "./delete-account-client";
import styles from "./page.module.css";

export const metadata:Metadata={title:"Supprimer mon compte | Petit Annonces",description:"Demandez la suppression de votre compte Petit Annonces et des données associées pouvant légalement être effacées.",robots:{index:true,follow:true}};
export default function DeleteAccountPage(){return <div className={styles.page}><main className={styles.shell}><section className={styles.hero}><span>CONFIDENTIALITÉ</span><h1>Supprimer mon compte</h1><p>Cette page permet à tout utilisateur Petit Annonces d’initier une demande de suppression de compte depuis le web, y compris en dehors de l’application mobile.</p></section><DeleteAccountClient/></main></div>}

