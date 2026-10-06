"use client";

import { useState } from "react";
import { AppIcon } from "./app-icon";

type ShareChannel="copy"|"whatsapp"|"facebook_group"|"x"|"native_share";
type ShareMode="menu"|"facebook-group";

function attribution(channel:ShareChannel){
  if(channel==="facebook_group")return{source:"facebook",medium:"group"};
  if(channel==="copy")return{source:"copy",medium:"share"};
  return{source:channel,medium:"social"};
}

function trackedUrl(channel:ShareChannel,shareUrl?:string){
  const url=new URL(shareUrl??window.location.href,window.location.origin);
  const {source,medium}=attribution(channel);
  url.searchParams.set("utm_source",source);
  url.searchParams.set("utm_medium",medium);
  url.searchParams.set("utm_campaign","listing_share");
  return url.toString();
}

export function ShareListingButton({title,listingId,shareUrl,className,iconOnly=false,mode="menu"}:{title:string;listingId:string;shareUrl?:string;className?:string;iconOnly?:boolean;mode?:ShareMode}){
  const [copied,setCopied]=useState(false);
  const [open,setOpen]=useState(false);
  const directFacebook=mode==="facebook-group";

  function track(channel:ShareChannel){
    const {source,medium}=attribution(channel);
    const path=new URL(shareUrl??window.location.href,window.location.origin).pathname;
    try{window.dispatchEvent(new CustomEvent("pa:analytics-event",{detail:{name:"share",params:{method:channel,content_type:"listing",item_id:listingId}}}))}catch{}
    void fetch("/api/growth/events",{method:"POST",credentials:"include",keepalive:true,headers:{"content-type":"application/json"},body:JSON.stringify({eventName:"LISTING_SHARED",channel:"WEB",source,medium,properties:{listingId,path,method:channel}})}).catch(()=>undefined);
  }

  async function copy(){
    try{const url=trackedUrl("copy",shareUrl);await navigator.clipboard.writeText(url);track("copy");setCopied(true);window.setTimeout(()=>setCopied(false),1800);setOpen(false)}catch{}
  }

  function copyShareText(text:string){
    if(navigator.clipboard?.writeText)return navigator.clipboard.writeText(text).then(()=>true).catch(()=>false);
    try{
      const field=document.createElement("textarea");
      field.value=text;field.setAttribute("readonly","");field.style.position="fixed";field.style.opacity="0";
      document.body.appendChild(field);field.select();const ok=document.execCommand("copy");field.remove();return Promise.resolve(ok);
    }catch{return Promise.resolve(false)}
  }

  function facebookGroups(){
    const url=trackedUrl("facebook_group",shareUrl);
    const text=`${title} · Petit Annonces\n${url}`;
    const copiedPromise=copyShareText(text);
    const tab=window.open("https://www.facebook.com/groups/feed/","_blank");
    if(tab)tab.opener=null;
    void copiedPromise.then(ok=>{if(ok){setCopied(true);window.setTimeout(()=>setCopied(false),2400)}});
    track("facebook_group");
    setOpen(false);
  }

  function social(channel:"whatsapp"|"x"){
    const url=trackedUrl(channel,shareUrl);
    const text=`${title} · Petit Annonces`;
    const destination=channel==="whatsapp"?`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`:`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    track(channel);
    window.open(destination,"_blank","noopener,noreferrer,width=760,height=620");
    setOpen(false);
  }

  async function share(){
    if(directFacebook){facebookGroups();return}
    try{
      if(navigator.share){const url=trackedUrl("native_share",shareUrl);await navigator.share({title,text:`${title} · Petit Annonces`,url});track("native_share");return}
      setOpen(true);
    }catch{}
  }

  const buttonLabel=directFacebook?"Facebook":copied?"Lien copié":"Partager";
  return <>
    <button type="button" className={className} onClick={share} aria-label={directFacebook?"Partager l’annonce dans un groupe Facebook":copied?"Lien copié":"Partager l’annonce"} title={directFacebook?"Facebook":copied?"Lien copié":"Partager"}><span aria-hidden="true"><AppIcon name="share"/></span>{!iconOnly&&buttonLabel}</button>
    {open&&<div role="presentation" onClick={()=>setOpen(false)} style={{position:"fixed",inset:0,zIndex:1400,background:"rgba(18,16,31,.42)",display:"grid",placeItems:"center",padding:18}}><div role="dialog" aria-modal="true" aria-label="Partager cette annonce" onClick={e=>e.stopPropagation()} style={{width:"min(440px,100%)",background:"white",borderRadius:22,padding:22,boxShadow:"0 24px 70px rgba(24,18,55,.24)"}}><div style={{display:"flex",justifyContent:"space-between",gap:16,alignItems:"center"}}><div><small style={{color:"#777789",fontWeight:800}}>Partager l’annonce</small><strong style={{display:"block",marginTop:4,fontSize:17,color:"#232333",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:330}}>{title}</strong></div><button type="button" onClick={()=>setOpen(false)} aria-label="Fermer" style={{border:0,background:"#f1f0f8",borderRadius:999,width:36,height:36,cursor:"pointer",fontSize:20}}>×</button></div><div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:10,marginTop:20}}><button type="button" onClick={()=>social("whatsapp")} style={{border:"1px solid #e7e5ef",background:"#fff",borderRadius:14,padding:"13px 10px",fontWeight:850,cursor:"pointer"}}>WhatsApp</button><button type="button" onClick={facebookGroups} style={{border:"1px solid #d9e3ff",background:"#f5f8ff",color:"#214fa5",borderRadius:14,padding:"13px 10px",fontWeight:900,cursor:"pointer"}}>Ouvrir mes groupes Facebook</button><button type="button" onClick={()=>social("x")} style={{border:"1px solid #e7e5ef",background:"#fff",borderRadius:14,padding:"13px 10px",fontWeight:850,cursor:"pointer"}}>X</button><button type="button" onClick={()=>void copy()} style={{border:"1px solid #e7e5ef",background:"#fff",borderRadius:14,padding:"13px 10px",fontWeight:850,cursor:"pointer"}}>Copier le lien</button></div><p style={{margin:"14px 0 0",fontSize:12,lineHeight:1.5,color:"#858596"}}>Le lien de l’annonce est copié automatiquement, puis vos groupes Facebook s’ouvrent. Choisissez un groupe et collez le lien dans votre publication.</p></div></div>}
  </>;
}
