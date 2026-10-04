"use client";
import {useEffect,useState} from "react";
const KEY="pa_audience_optout_v1";
export function AnonymousAudienceOptOut(){
 const [off,setOff]=useState(false);
 useEffect(()=>{try{setOff(localStorage.getItem(KEY)==="1")}catch{}},[]);
 function toggle(){const next=!off;try{if(next)localStorage.setItem(KEY,"1");else localStorage.removeItem(KEY)}catch{}setOff(next)}
 return <section style={{padding:18,border:"1px solid #e7e5ef",borderRadius:18,background:"#fff",margin:"18px auto",maxWidth:1380}}>
  <strong>Mesure d’audience agrégée sans identification</strong>
  <p style={{fontSize:14,lineHeight:1.6,color:"#626274"}}>Nous comptons des chargements de pages et des signaux d’activité agrégés sans identifiant, cookie de suivi, profil publicitaire, ni transmission à Google ou Meta. Ce décompte est distinct des mesures nécessitant votre consentement. Vous pouvez vous y opposer ci-dessous.</p>
  <button type="button" onClick={toggle} style={{border:"1px solid #d9d7e5",borderRadius:999,padding:"11px 16px",fontWeight:750,cursor:"pointer",background:off?"#eef9f4":"#f1efff",color:"#252240"}}>{off?"Opposition active — réactiver la mesure":"M’opposer à la mesure agrégée"}</button>
 </section>;
}
