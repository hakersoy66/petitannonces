"use client";

import { FormEvent, useState } from "react";
import styles from "../app/auth.module.css";

function apiBase(){return (process.env.NEXT_PUBLIC_API_URL??"/api").replace(/\/$/,"")}
const CANONICAL_ORIGIN="https://petitannonces.fr";
function safeDestination(path:string){return new URL(path.startsWith("/")?path:"/mon-compte",CANONICAL_ORIGIN).href}
function nextPaint(){return new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()))}
async function fetchWithTimeout(input:RequestInfo|URL,init:RequestInit={},timeoutMs=12000){
  const controller=new AbortController();
  const timer=window.setTimeout(()=>controller.abort(),timeoutMs);
  try{return await fetch(input,{...init,signal:controller.signal})}
  finally{window.clearTimeout(timer)}
}

type Props={
  oauthProviders:{google:boolean;apple:boolean};
  nextPath:string;
  initialOauth2fa?:boolean;
  initialOauthError?:string|null;
};

const oauthMessages:Record<string,string>={
  oauth_provider_not_configured:"Cette connexion sociale n’est pas encore configurée.",
  oauth_cancelled:"Connexion annulée.",
  oauth_state_invalid:"La demande de connexion a expiré. Réessayez.",
  oauth_existing_account_requires_password:"Un compte existe déjà avec cette adresse. Connectez-vous d’abord avec votre mot de passe pour sécuriser l’association.",
  oauth_account_unavailable:"Ce compte n’est pas disponible.",
  registrations_disabled:"Les nouvelles inscriptions sont temporairement fermées.",
  oauth_email_not_verified:"L’adresse e-mail fournie par le service n’a pas pu être vérifiée.",
};

export function LoginForm({oauthProviders,nextPath,initialOauth2fa=false,initialOauthError=null}:Props){
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [remember,setRemember]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState(initialOauthError?(oauthMessages[initialOauthError]??"Connexion Google/Apple impossible. Réessayez."):"");
  const [needsVerification,setNeedsVerification]=useState(false);
  const [needsPasswordReset,setNeedsPasswordReset]=useState(false);
  const [resendMessage,setResendMessage]=useState("");
  const [challenge,setChallenge]=useState(initialOauth2fa?"__oauth__":"");
  const [twoFactorCode,setTwoFactorCode]=useState("");
  const signupHref=`/inscription?next=${encodeURIComponent(nextPath)}`;

  async function submit(e:FormEvent){
    e.preventDefault();
    setBusy(true);setError("");setNeedsVerification(false);setNeedsPasswordReset(false);setResendMessage("");
    await nextPaint();
    try{
      const r=await fetchWithTimeout(`${apiBase()}/auth/login`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({email,password,remember})});
      const p=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(p.error??"login_failed");
      if(p.twoFactorRequired&&p.challengeToken){setChallenge(p.challengeToken);if(typeof p.remember==="boolean")setRemember(p.remember);return}
      window.location.replace(safeDestination(nextPath));
    }catch(err){
      const code=err instanceof Error?err.message:"login_failed";
      if(code==="email_verification_required")setNeedsVerification(true);
      if(code==="password_reset_required")setNeedsPasswordReset(true);
      setError(code==="invalid_credentials"?"E-mail ou mot de passe incorrect.":code==="password_reset_required"?"Votre compte a été transféré vers la nouvelle version de Petit Annonces. Pour votre sécurité, définissez un nouveau mot de passe.":code==="email_verification_required"?"Veuillez d’abord vérifier votre adresse e-mail.":code==="account_temporarily_locked"?"Compte temporairement verrouillé.":"Connexion impossible. Réessayez dans quelques instants.");
    }finally{setBusy(false)}
  }

  async function complete2fa(e:FormEvent){
    e.preventDefault();setBusy(true);setError("");await nextPaint();
    try{
      const oauth=challenge==="__oauth__";
      const r=await fetchWithTimeout(`${apiBase()}${oauth?"/auth/oauth/2fa/complete":"/auth/2fa/complete"}`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify(oauth?{code:twoFactorCode,remember}:{challengeToken:challenge,code:twoFactorCode,remember})});
      const p=await r.json().catch(()=>({}));if(!r.ok)throw new Error(p.error??"two_factor_failed");window.location.replace(safeDestination(nextPath));
    }catch(err){const code=err instanceof Error?err.message:"two_factor_failed";setError(code==="invalid_two_factor_code"?"Code d’authentification ou code de secours invalide.":"Vérification impossible. Réessayez.")}finally{setBusy(false)}
  }

  async function resendVerification(){
    setResendMessage("");
    const r=await fetchWithTimeout(`${apiBase()}/auth/resend-verification`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email})},10000).catch(()=>null);
    setResendMessage(r?.ok?"Si ce compte attend une vérification, un nouveau lien vient d’être envoyé.":"Impossible d’envoyer un nouveau lien pour le moment.");
  }

  return <section className={styles.formCard}>
    <span className={styles.eyebrow}>{challenge?"Double authentification":"Bienvenue"}</span>
    <h1 className={styles.title}>{challenge?"Confirmez votre connexion":"Connectez-vous à Petit Annonces"}</h1>
    <p className={styles.lead}>{challenge?"Saisissez le code à 6 chiffres de votre application d’authentification, ou utilisez un code de secours.":"Retrouvez vos annonces, vos messages, vos achats et vos ventes dans un espace personnel simple et sécurisé."}</p>
    <div className={styles.authMessageSlot} aria-live="polite">{error&&<div className={styles.error}>{error}{needsVerification&&<div style={{marginTop:10}}><button type="button" className={styles.inlineLink} onClick={resendVerification}>Renvoyer l’e-mail de vérification</button></div>}{needsPasswordReset&&<div style={{marginTop:10}}><a className={styles.inlineLink} href={`/mot-de-passe-oublie?email=${encodeURIComponent(email)}`}>Définir un nouveau mot de passe →</a></div>}{resendMessage&&<div style={{marginTop:8}}>{resendMessage}</div>}</div>}</div>
    {challenge?<form className={styles.form} onSubmit={complete2fa}><label className={styles.field}>Code d’authentification ou code de secours<input autoFocus inputMode="numeric" autoComplete="one-time-code" value={twoFactorCode} onChange={e=>setTwoFactorCode(e.target.value.trim().slice(0,32))} placeholder="123456 ou code de secours" required/></label><button className={styles.primary} aria-busy={busy} disabled={busy||twoFactorCode.length<6}>{busy?"Vérification…":"Continuer"}</button><button type="button" className={styles.inlineLink} onClick={()=>{setChallenge("");setTwoFactorCode("");setError("")}}>← Revenir à la connexion</button></form>:<><div className={styles.switcher}><a className={styles.active} href={`/connexion?next=${encodeURIComponent(nextPath)}`}>Connexion</a><a href={signupHref}>Créer un compte</a></div><form className={styles.form} onSubmit={submit}><label className={styles.field}>Adresse e-mail<input type="email" autoComplete="email" inputMode="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="vous@exemple.fr" required/></label><label className={styles.field}>Mot de passe<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Votre mot de passe" required/></label><div className={styles.loginOptions}><label className={styles.check}><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/><span>Rester connecté</span></label><a className={styles.inlineLink} href="/mot-de-passe-oublie">Mot de passe oublié ?</a></div><button className={styles.primary} aria-busy={busy} disabled={busy}>{busy?"Connexion…":"Se connecter"}</button></form><div className={styles.divider}>ou continuer avec</div><div className={styles.socialGrid}>{oauthProviders.google?<a className={styles.socialButton} href={`${apiBase()}/auth/oauth/google/start?next=${encodeURIComponent(nextPath)}`}><span className={styles.googleMark}>G</span><b>Continuer avec Google</b></a>:<button type="button" className={`${styles.socialButton} ${styles.socialDisabled}`} disabled><span className={styles.googleMark}>G</span><b>Google</b><small>Configuration à terminer</small></button>}{oauthProviders.apple?<a className={`${styles.socialButton} ${styles.appleButton}`} href={`${apiBase()}/auth/oauth/apple/start?next=${encodeURIComponent(nextPath)}`}><span className={styles.appleMark}></span><b>Continuer avec Apple</b></a>:<button type="button" className={`${styles.socialButton} ${styles.socialDisabled}`} disabled><span className={styles.appleMark}></span><b>Apple</b><small>Configuration à terminer</small></button>}</div><p className={styles.socialNote}>En continuant avec Google ou Apple, vous acceptez les <a href="/conditions-generales">conditions générales</a> et la <a href="/confidentialite">politique de confidentialité</a>.</p><p className={styles.footText}>Pas encore de compte ? <a href={signupHref}>Inscrivez-vous gratuitement</a></p><p className={styles.footText}>Vous êtes professionnel ? <a href="/inscription/pro">Ouvrir un compte Pro</a></p></>}
  </section>;
}
