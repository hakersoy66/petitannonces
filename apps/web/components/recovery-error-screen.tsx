"use client";

import {useEffect,useState} from "react";

export function RecoveryErrorScreen({reset,professional=false}:{reset:()=>void;professional?:boolean}){
 const[auto,setAuto]=useState(false);
 useEffect(()=>{
  const key=`pa:error-screen-reload:${location.pathname}`;
  let last=0;
  try{last=Number(sessionStorage.getItem(key)??0)}catch{}
  if(Date.now()-last<20_000)return;
  try{sessionStorage.setItem(key,String(Date.now()))}catch{}
  setAuto(true);
  const timer=window.setTimeout(()=>location.reload(),2600);
  return()=>window.clearTimeout(timer);
 },[]);
 const retry=()=>{try{reset()}finally{window.setTimeout(()=>location.reload(),120)}};
 return <main style={{minHeight:"100dvh",display:"grid",placeItems:"center",padding:"24px",background:"linear-gradient(145deg,#f7f7fb,#efedff)",fontFamily:"Inter,system-ui,-apple-system,Segoe UI,sans-serif",color:"#202033"}}>
  <section style={{width:"min(92vw,580px)",padding:"34px",border:"1px solid #e2defc",borderRadius:26,background:"#fff",boxShadow:"0 24px 70px rgba(57,46,139,.12)",textAlign:"center"}}>
   <div style={{width:76,height:76,margin:"0 auto 18px",borderRadius:20,display:"grid",placeItems:"center",background:"#5b4cf0",color:"#fff",fontSize:24,fontWeight:950,boxShadow:"0 10px 20px rgba(91,76,240,.22)"}}>PA</div>
   <span style={{display:"inline-block",padding:"7px 11px",borderRadius:999,background:"#f0edff",color:"#5b4cf0",fontSize:12,fontWeight:850}}>Actualisation</span>
   <h1 style={{margin:"16px 0 10px",fontSize:"clamp(26px,5vw,34px)",letterSpacing:"-.04em"}}>La page se remet à jour.</h1>
   <p style={{margin:0,color:"#6e6d7e",lineHeight:1.65}}>Une version plus récente de Petit Annonces est disponible. Nous rechargeons la page proprement pour éviter une interruption.</p>
   <div style={{height:8,margin:"24px 0 16px",borderRadius:999,background:"#eceaf6",overflow:"hidden"}}><i style={{display:"block",width:"62%",height:"100%",borderRadius:999,background:"#5b4cf0"}}/></div>
   <div style={{display:"flex",gap:10,justifyContent:"center",flexWrap:"wrap"}}><button type="button" onClick={retry} style={{minHeight:44,padding:"0 18px",border:0,borderRadius:13,background:"#5b4cf0",color:"#fff",fontWeight:850,cursor:"pointer"}}>Recharger maintenant</button><a href={professional?"/espace-pro":"/"} style={{minHeight:44,padding:"0 18px",border:"1px solid #dedbea",borderRadius:13,background:"#fff",color:"#4d4b5e",fontWeight:800,textDecoration:"none",display:"inline-flex",alignItems:"center"}}>{professional?"Espace Pro":"Accueil"}</a></div>
   <small style={{display:"block",marginTop:16,color:"#92909f"}}>{auto?"Rechargement automatique en cours…":"Vous pouvez recharger la page manuellement."}</small>
  </section>
 </main>;
}
