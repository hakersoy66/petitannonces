"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SiteHeader } from "../../components/site-header";
import styles from "../auth.module.css";

function apiBase(){return (process.env.NEXT_PUBLIC_API_URL??"http://127.0.0.1:4000").replace(/\/$/,"")}

export default function VerifyEmailPage(){
  const search=useSearchParams();const token=useMemo(()=>search.get("token")??"",[search]);const [state,setState]=useState<"loading"|"success"|"error">("loading");
  useEffect(()=>{if(!token){setState("error");return}fetch(`${apiBase()}/auth/verify-email`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token})}).then(r=>{if(!r.ok)throw new Error();setState("success")}).catch(()=>setState("error"))},[token]);
  return <div className={styles.page}><SiteHeader/><main className={styles.main}><div className={styles.authGrid}><section className={styles.formCard}><span className={styles.eyebrow}>Vérification e-mail</span><h1 className={styles.title}>{state==="loading"?"Vérification en cours…":state==="success"?"Votre e-mail est vérifié":"Lien de vérification invalide"}</h1><p className={styles.lead}>{state==="loading"?"Nous validons votre lien sécurisé.":state==="success"?"Votre compte Petit Annonces est maintenant activé. Vous pouvez vous connecter et commencer à utiliser votre espace.":"Le lien a expiré, a déjà été utilisé ou n’est pas valide."}</p>{state==="success"&&<a className={styles.primary} href="/bienvenue">Continuer</a>}{state==="error"&&<div className={styles.error}>Demandez un nouveau lien de vérification depuis votre compte ou recommencez l’inscription si nécessaire.</div>}<p className={styles.footText}><a href="/connexion">Aller à la connexion</a></p></section><aside className={styles.benefitCard}><span className={styles.eyebrow}>Compte activé</span><h2 className={styles.title}>La vérification renforce la confiance.</h2><p className={styles.lead}>Une adresse e-mail confirmée facilite la récupération du compte, les notifications et les échanges avec les autres membres.</p><div className={styles.benefits}><div className={styles.benefit}><div className={styles.benefitIcon}>✓</div><div><strong>Compte activé</strong><p>Accédez aux annonces, favoris, messages et transactions.</p></div></div><div className={styles.benefit}><div className={styles.benefitIcon}>✉</div><div><strong>Notifications fiables</strong><p>Recevez les messages importants liés à votre activité.</p></div></div><div className={styles.benefit}><div className={styles.benefitIcon}>⌁</div><div><strong>Récupération simplifiée</strong><p>Retrouvez plus facilement votre compte en cas d’oubli du mot de passe.</p></div></div></div></aside></div></main></div>
}
