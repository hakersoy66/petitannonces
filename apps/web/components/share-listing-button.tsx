"use client";

import { useState } from "react";
import { AppIcon } from "./app-icon";

function trackedUrl(channel:string){
  const url=new URL(window.location.href);
  url.searchParams.set("utm_source",channel);
  url.searchParams.set("utm_medium",channel==="copy"?"share":"social");
  url.searchParams.set("utm_campaign","listing_share");
  return url.toString();
}

export function ShareListingButton({title,listingId,className,iconOnly=false}:{title:string;listingId:string;className?:string;iconOnly?:boolean}){
  const [copied,setCopied]=useState(false);
  const [open,setOpen]=useState(false);

  function track(channel:string){
    try{window.dispatchEvent(new CustomEvent("pa:analytics-event",{detail:{name:"share",params:{method:channel,content_type:"listing",item_id:listingId}}}))}catch{}
    void fetch("/api/growth/events",{method:"POST",credentials:"include",keepalive:true,headers:{"content-type":"application/json"},body:JSON.stringify({eventName:"LISTING_SHARED",channel:"WEB",source:channel,medium:channel==="copy"?"share":"social",properties:{listingId,path:window.location.pathname}})}).catch(()=>undefined);
  }

  async function copy(){
    try{const url=trackedUrl("copy");await navigator.clipboard.writeText(url);track("copy");setCopied(true);window.setTimeout(()=>setCopied(false),1800);setOpen(false)}catch{}
  }

  function social(channel:"whatsapp"|"facebook"|"x"){
    const url=trackedUrl(channel);
    const text=`${title} · Petit Annonces`;
    const destination=channel==="whatsapp"?`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`:channel==="facebook"?`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`:`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    track(channel);
    window.open(destination,"_blank","noopener,noreferrer,width=760,height=620");
    setOpen(false);
  }

  async function share(){
    try{
      if(navigator.share){const url=trackedUrl("native_share");await navigator.share({title,text:`${title} · Petit Annonces`,url});track("native_share");return}
      setOpen(true);
    }catch{}
  }

  return <>
    <button type="button" className={className} onClick={share} aria-label={copied?"Lien copié":"Partager l’annonce"} title={copied?"Lien copié":"Partager"}><span aria-hidden="true"><AppIcon name="share"/></span>{!iconOnly&&(copied?"Lien copié":"Partager")}</button>
    {open&&<div role="presentation" onClick={()=>setOpen(false)} style={{position:"fixed",inset:0,zIndex:1400,background:"rgba(18,16,31,.42)",display:"grid",placeItems:"center",padding:18}}><div role="dialog" aria-modal="true" aria-label="Partager cette annonce" onClick={e=>e.stopPropagation()} style={{width:"min(440px,100%)",background:"white",borderRadius:22,padding:22,boxShadow:"0 24px 70px rgba(24,18,55,.24)"}}><div style={{display:"flex",justifyContent:"space-between",gap:16,alignItems:"center"}}><div><small style={{color:"#777789",fontWeight:800}}>Partager l’annonce</small><strong style={{display:"block",marginTop:4,fontSize:17,color:"#232333",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:330}}>{title}</strong></div><button type="button" onClick={()=>setOpen(false)} aria-label="Fermer" style={{border:0,background:"#f1f0f8",borderRadius:999,width:36,height:36,cursor:"pointer",fontSize:20}}>×</button></div><div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:10,marginTop:20}}><button type="button" onClick={()=>social("whatsapp")} style={{border:"1px solid #e7e5ef",background:"#fff",borderRadius:14,padding:"13px 10px",fontWeight:850,cursor:"pointer"}}>WhatsApp</button><button type="button" onClick={()=>social("facebook")} style={{border:"1px solid #e7e5ef",background:"#fff",borderRadius:14,padding:"13px 10px",fontWeight:850,cursor:"pointer"}}>Facebook</button><button type="button" onClick={()=>social("x")} style={{border:"1px solid #e7e5ef",background:"#fff",borderRadius:14,padding:"13px 10px",fontWeight:850,cursor:"pointer"}}>X</button><button type="button" onClick={()=>void copy()} style={{border:"1px solid #e7e5ef",background:"#fff",borderRadius:14,padding:"13px 10px",fontWeight:850,cursor:"pointer"}}>Copier le lien</button></div><p style={{margin:"14px 0 0",fontSize:12,lineHeight:1.5,color:"#858596"}}>Les liens partagés incluent uniquement des paramètres de mesure de campagne afin d’identifier le canal qui génère les visites.</p></div></div>}
  </>;
}
