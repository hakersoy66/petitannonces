'use client';
import { useState, type FormEvent } from 'react';
import styles from './page.module.css';

type Form={platform:string;handle:string;email:string;followers:string;averageViews:string;franceAudiencePercent:string;requestedFee:string;mediaKitUrl:string;message:string;consent:boolean;website:string};
const blank:Form={platform:'instagram',handle:'',email:'',followers:'',averageViews:'',franceAudiencePercent:'',requestedFee:'',mediaKitUrl:'',message:'',consent:false,website:''};
const available=['instagram','tiktok','youtube','facebook'];
function numberValue(input:string){return input.trim()===''?0:Number(input);}
export default function PartnerApplicationForm(){
 const [form,setForm]=useState<Form>(blank),[saving,setSaving]=useState(false),[success,setSuccess]=useState(false),[error,setError]=useState('');
 function set<K extends keyof Form>(field:K,value:Form[K]){setForm(old=>({...old,[field]:value}));}
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();setSaving(true);setError('');
  try{
    const payload={platform:form.platform,handle:form.handle.trim(),email:form.email.trim(),followers:numberValue(form.followers),averageViews:numberValue(form.averageViews),franceAudiencePercent:form.franceAudiencePercent.trim()===''?null:Number(form.franceAudiencePercent),requestedFeeMinor:Math.round(numberValue(form.requestedFee)*100),mediaKitUrl:form.mediaKitUrl.trim(),message:form.message.trim(),consent:form.consent,website:form.website};
    const result=await fetch('/api/partners/applications',{method:'POST',credentials:'omit',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
    const response=await result.json().catch(()=>({})) as {error?:string};
    if(!result.ok){if(result.status===409)throw new Error('Nous avons déjà reçu une candidature en cours pour ce compte.');if(result.status===429)throw new Error('Trop de demandes. Merci de réessayer plus tard.');throw new Error('Impossible d’envoyer votre proposition pour le moment.');}
    setSuccess(true);setForm(blank);
  }catch(e){setError(e instanceof Error?e.message:'Une erreur est survenue.');}finally{setSaving(false);}
 }
 if(success)return <div className={styles.done} role="status"><div className={styles.doneIcon}>✓</div><h2>Merci pour votre intérêt !</h2><p>Votre candidature a été reçue. Notre équipe l’examinera et vous contactera par e-mail si une campagne correspond à votre profil.</p><button type="button" className={styles.reset} onClick={()=>setSuccess(false)}>Envoyer une autre proposition</button></div>;
 return <form onSubmit={submit} className={styles.form} aria-label="Candidature créateur">
   <div className={styles.formHead}><span>Candidature influenceur</span><strong>Présentez votre profil</strong><p>Quelques renseignements suffisent pour commencer.</p></div>
   <div className={styles.two}>
    <label>Réseau social<select required value={form.platform} onChange={e=>set('platform',e.target.value)}>{available.map(n=><option value={n} key={n}>{n[0]?.toUpperCase()+n.slice(1)}</option>)}</select></label>
    <label>Compte / @pseudo<input required minLength={2} maxLength={39} pattern="@?[a-zA-Z0-9._-]{2,38}" autoComplete="off" placeholder="@votrecompte" value={form.handle} onChange={e=>set('handle',e.target.value)}/></label>
   </div>
   <label>Adresse e-mail de contact<input required type="email" maxLength={180} autoComplete="email" placeholder="bonjour@exemple.fr" value={form.email} onChange={e=>set('email',e.target.value)}/></label>
   <div className={styles.two}>
    <label>Nombre d'abonnés<input required min={0} max={1000000000} step="1" type="number" placeholder="Ex. 15000" value={form.followers} onChange={e=>set('followers',e.target.value)}/></label>
    <label>Vues moyennes par contenu<input required min={0} max={1000000000} step="1" type="number" placeholder="Ex. 10000" value={form.averageViews} onChange={e=>set('averageViews',e.target.value)}/></label>
   </div>
   <div className={styles.two}>
    <label>Audience basée en France (%)<input min={0} max={100} step="0.1" type="number" placeholder="Facultatif" value={form.franceAudiencePercent} onChange={e=>set('franceAudiencePercent',e.target.value)}/></label>
    <label>Tarif proposé (€)<input min={0} max={1000000} step="0.01" type="number" placeholder="Ex. 150" value={form.requestedFee} onChange={e=>set('requestedFee',e.target.value)}/></label>
   </div>
   <label>Lien vers votre media kit ou des statistiques (facultatif)<input type="url" maxLength={900} placeholder="https://..." value={form.mediaKitUrl} onChange={e=>set('mediaKitUrl',e.target.value)}/><span className={styles.hint}>Un lien HTTPS accessible à notre équipe, sans informations sensibles.</span></label>
   <label>Votre proposition<textarea rows={3} maxLength={1800} placeholder="Parlez-nous de vos formats (Reels, Stories, vidéo) et de votre idée de collaboration…" value={form.message} onChange={e=>set('message',e.target.value)}/></label>
   <div className={styles.trap} aria-hidden="true"><label>Votre site web<input tabIndex={-1} autoComplete="off" value={form.website} onChange={e=>set('website',e.target.value)}/></label></div>
   <label className={styles.consent}><input required type="checkbox" checked={form.consent} onChange={e=>set('consent',e.target.checked)}/><span>J’accepte que Petit Annonces utilise ces informations pour examiner ma proposition et me recontacter à ce sujet. <a href="/confidentialite">Confidentialité</a>.</span></label>
   {error&&<p className={styles.error} role="alert">{error}</p>}
   <button type="submit" className={styles.submit} disabled={saving||!form.consent}>{saving?'Envoi en cours…':'Envoyer ma candidature'} <span>→</span></button>
   <small className={styles.footnote}>Aucun paiement ni engagement à cette étape.</small>
 </form>;
}
