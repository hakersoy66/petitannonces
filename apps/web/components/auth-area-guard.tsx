"use client";

import { useEffect, useState, type ReactNode } from "react";

type Area="account"|"professional";
type MePayload={user?:{kind?:"PARTICULIER"|"PROFESSIONNEL"}};
function api(){return (process.env.NEXT_PUBLIC_API_URL??"/api").replace(/\/$/,"")}

export function AuthAreaGuard({area,children}:{area:Area;children:ReactNode}){
  const [ready,setReady]=useState(false);
  const [error,setError]=useState(false);
  useEffect(()=>{
    let active=true;
    const controllers=new Set<AbortController>();
    async function requestMe(timeoutMs=6500){
      const controller=new AbortController();controllers.add(controller);
      const timer=window.setTimeout(()=>controller.abort(),timeoutMs);
      try{return await fetch(`${api()}/auth/me`,{credentials:"include",cache:"no-store",signal:controller.signal})}
      finally{window.clearTimeout(timer);controllers.delete(controller)}
    }
    async function verify(){
      setError(false);setReady(false);
      try{
        let response:Response;
        try{response=await requestMe()}catch{await new Promise(resolve=>window.setTimeout(resolve,350));response=await requestMe()}
        if(response.status===401){window.location.replace(`/connexion?next=${encodeURIComponent(window.location.pathname+window.location.search)}`);return}
        if(!response.ok)throw new Error("auth_unavailable");
        const payload=await response.json() as MePayload;
        if(area==="professional"&&payload.user?.kind!=="PROFESSIONNEL"){window.location.replace("/professionnels");return}
        if(active)setReady(true);
      }catch{if(active)setError(true)}
    }
    void verify();
    return()=>{active=false;for(const controller of controllers)controller.abort();controllers.clear()};
  },[area]);
  if(error)return <div style={{minHeight:"55vh",display:"grid",placeItems:"center",padding:24,background:"#f7f7fb"}}><div style={{width:"min(460px,100%)",padding:24,border:"1px solid #e7e6ef",borderRadius:20,background:"#fff",textAlign:"center",boxShadow:"0 16px 45px rgba(31,28,65,.06)"}}><strong style={{display:"block",fontSize:18,color:"#272638"}}>Votre espace est momentanément indisponible</strong><p style={{margin:"9px 0 16px",color:"#757485",lineHeight:1.5,fontSize:13}}>Vérifiez votre connexion puis réessayez.</p><button type="button" onClick={()=>window.location.reload()} style={{minHeight:44,padding:"0 18px",border:0,borderRadius:13,background:"#5b4cf0",color:"#fff",fontWeight:850,cursor:"pointer"}}>Réessayer</button></div></div>;
  if(!ready)return <div aria-label="Vérification de la session" style={{minHeight:"45vh",display:"grid",placeItems:"center",background:"#f7f7fb"}}><div style={{display:"grid",justifyItems:"center",gap:12,color:"#666576",fontSize:13,fontWeight:750}}><span style={{width:34,height:34,border:"3px solid #ddd9f6",borderTopColor:"#5b4cf0",borderRadius:"50%",animation:"paAuthGuardSpin .8s linear infinite"}}/><span>Ouverture de votre espace…</span><style>{`@keyframes paAuthGuardSpin{to{transform:rotate(360deg)}}`}</style></div></div>;
  return <>{children}</>;
}