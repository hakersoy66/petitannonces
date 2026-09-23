"use client";

import { useEffect, useState } from "react";
import { AccountSidebar } from "../../components/account-sidebar";

function api(){return (process.env.NEXT_PUBLIC_API_URL??"/api").replace(/\/$/,"")}
function urlBase64ToUint8Array(value:string){const padding="=".repeat((4-(value.length%4))%4);const base64=(value+padding).replace(/-/g,"+").replace(/_/g,"/");const raw=atob(base64);return Uint8Array.from([...raw].map(char=>char.charCodeAt(0)))}

export default function NotificationsPage(){
  const [supported,setSupported]=useState(true);
  const [enabled,setEnabled]=useState(false);
  const [busy,setBusy]=useState(false);
  const [checking,setChecking]=useState(true);
  const [status,setStatus]=useState("Vérification de cet appareil…");
  const [iosHint,setIosHint]=useState(false);
  const [appLogoUrl,setAppLogoUrl]=useState("/icons/icon-192.png");

  useEffect(()=>{void inspect();fetch(`${api()}/public/site-config`,{cache:"no-store"}).then(async r=>{if(!r.ok)throw new Error();return r.json() as Promise<{site?:{appLogoUrl?:string|null;pwaIconUrl?:string|null;pwaIcon512Url?:string|null;logoUrl?:string|null}}>}).then(p=>{const site=p.site??{};setAppLogoUrl(site.appLogoUrl??site.pwaIcon512Url??site.pwaIconUrl??site.logoUrl??"/icons/icon-192.png")}).catch(()=>{})},[]);
  async function registerExistingSubscription(subscription:PushSubscription){const json=subscription.toJSON();if(!json.keys?.p256dh||!json.keys?.auth)return false;const response=await fetch(`${api()}/notifications/push/subscribe`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({platform:"WEB",endpoint:subscription.endpoint,keys:json.keys,deviceLabel:navigator.platform||"Web"})});return response.ok}
  async function inspect(){
    setChecking(true);
    try{
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {setSupported(false);setEnabled(false);setStatus("Les notifications push ne sont pas prises en charge sur cet appareil.");return}
      const standalone=window.matchMedia("(display-mode: standalone)").matches||Boolean((navigator as Navigator&{standalone?:boolean}).standalone);
      const isiOS=/iPad|iPhone|iPod/.test(navigator.userAgent);setIosHint(isiOS&&!standalone);
      const registration=await navigator.serviceWorker.ready;const subscription=await registration.pushManager.getSubscription();
      if(!subscription||Notification.permission!=="granted"){setEnabled(false);setStatus(Notification.permission==="denied"?"Les notifications sont bloquées dans les réglages de votre navigateur.":"Les notifications sont désactivées sur cet appareil.");return}
      const statusResponse=await fetch(`${api()}/notifications/push/status?endpoint=${encodeURIComponent(subscription.endpoint)}`,{credentials:"include",cache:"no-store"});
      const payload=statusResponse.ok?await statusResponse.json() as{active?:boolean}:null;let active=Boolean(payload?.active);
      if(!active)active=await registerExistingSubscription(subscription);
      setEnabled(active);setStatus(active?"Notifications activées sur cet appareil.":"L’abonnement push doit être réactivé sur cet appareil.");
    }catch{setStatus("Impossible de vérifier les notifications pour le moment.")}finally{setChecking(false)}
  }

  async function enablePush(){
    setBusy(true);
    try{
      const keyResponse=await fetch(`${api()}/notifications/push/public-key`,{credentials:"include",cache:"no-store"});
      if(keyResponse.status===401){location.href="/connexion?next=%2Fnotifications";return}
      const kp=await keyResponse.json().catch(()=>({})) as{configured?:boolean;publicKey?:string|null};
      if(!keyResponse.ok||!kp.configured||!kp.publicKey){setStatus("Le service de notifications est momentanément indisponible.");return}
      const permission=await Notification.requestPermission();
      if(permission!=="granted"){setStatus("Autorisation refusée. Vous pouvez la réactiver dans les réglages du navigateur.");return}
      const registration=await navigator.serviceWorker.ready;
      let subscription=await registration.pushManager.getSubscription();
      if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(kp.publicKey)});
      const json=subscription.toJSON();
      const response=await fetch(`${api()}/notifications/push/subscribe`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({platform:"WEB",endpoint:subscription.endpoint,keys:json.keys,deviceLabel:navigator.platform||"Web"})});
      if(!response.ok)throw new Error("subscribe_failed");
      setEnabled(true);setStatus("Notifications activées sur cet appareil.");
    }catch{setStatus("Impossible d’activer les notifications pour le moment.")}finally{setBusy(false)}
  }

  async function disablePush(){
    setBusy(true);
    try{
      const registration=await navigator.serviceWorker.ready;
      const subscription=await registration.pushManager.getSubscription();
      if(subscription){await fetch(`${api()}/notifications/push/unsubscribe`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({endpoint:subscription.endpoint})});await subscription.unsubscribe()}
      setEnabled(false);setStatus("Notifications désactivées sur cet appareil.");
    }catch{setStatus("Impossible de désactiver les notifications pour le moment.")}finally{setBusy(false)}
  }

  return <div style={{minHeight:"100vh",background:"#f7f7fb"}}><main style={{width:"min(1380px,calc(100% - 36px))",margin:"28px auto 72px",display:"grid",gridTemplateColumns:"290px minmax(0,1fr)",gap:26}} className="pwa-settings-shell"><AccountSidebar/><section style={{minWidth:0}}><div style={{display:"flex",alignItems:"center",gap:16,marginBottom:20}}><img src={appLogoUrl} alt="Petit Annonces" width={72} height={72} style={{borderRadius:20}}/><div><p style={{margin:0,color:"#ff4c55",fontWeight:900,textTransform:"uppercase",fontSize:12}}>Application Petit Annonces</p><h1 style={{margin:"6px 0 5px",fontSize:"clamp(2rem,4vw,3rem)"}}>Application & notifications</h1><p style={{margin:0,color:"#707080"}}>Installez Petit Annonces sur votre écran d’accueil et recevez vos messages, offres, commandes et alertes.</p></div></div><section style={{background:"#fff",border:"1px solid #e7e7ee",borderRadius:24,padding:24,boxShadow:"0 12px 36px rgba(32,29,73,.05)"}}><h2 style={{marginTop:0}}>Notifications push</h2><p style={{color:"#6c6c7d",lineHeight:1.65}}>{status}</p>{iosHint&&<p style={{padding:13,borderRadius:12,background:"#fff4f4",color:"#8f3941"}}>Sur iPhone/iPad, ajoutez d’abord Petit Annonces à l’écran d’accueil depuis le menu Partager, puis ouvrez l’application installée pour activer les notifications.</p>}<div style={{display:"flex",gap:10,flexWrap:"wrap",marginTop:18}}>{supported&&!enabled&&<button type="button" disabled={busy||checking||iosHint} onClick={()=>void enablePush()} className="button button-primary">{checking?"Vérification…":busy?"Activation…":"Activer les notifications"}</button>}{enabled&&<button type="button" disabled={busy||checking} onClick={()=>void disablePush()} className="button">Désactiver sur cet appareil</button>}</div></section><section style={{marginTop:18,display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:12}}>{[["Messages","Nouveaux messages et réponses"],["Offres","Offres, contre-offres et décisions"],["Commandes","Paiement, préparation, expédition et livraison"],["Alertes","Recherches enregistrées et baisses de prix"]].map(([title,body])=><article key={title} style={{background:"#fff",border:"1px solid #e9e9ef",borderRadius:18,padding:18}}><strong>{title}</strong><p style={{margin:"6px 0 0",color:"#777786",fontSize:13,lineHeight:1.5}}>{body}</p></article>)}</section></section></main><style jsx global>{`@media(max-width:820px){.pwa-settings-shell{width:min(100% - 20px,1380px)!important;grid-template-columns:1fr!important;margin-top:16px!important;gap:16px!important}}`}</style></div>
}
