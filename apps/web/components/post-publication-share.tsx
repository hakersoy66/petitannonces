"use client";

import {useState} from "react";
import {AppIcon} from "./app-icon";

export function PostPublicationShare({slug,className}:{slug:string;className?:string}){
 const[copied,setCopied]=useState(false);
 function url(){const u=new URL(`/annonce/${encodeURIComponent(slug)}`,window.location.origin);u.searchParams.set("utm_source","listing_owner");u.searchParams.set("utm_medium","share");u.searchParams.set("utm_campaign","listing_share");return u.toString()}
 function track(method:string){try{window.dispatchEvent(new CustomEvent("pa:analytics-event",{detail:{name:"share",params:{method,content_type:"listing",source:"publication_success"}}}))}catch{}void fetch("/api/growth/events",{method:"POST",credentials:"include",keepalive:true,headers:{"content-type":"application/json"},body:JSON.stringify({eventName:"LISTING_SHARED",channel:"WEB",campaign:"listing_share",source:"listing_owner",medium:method,properties:{slug,placement:"publication_success"}})}).catch(()=>undefined)}
 async function copy(){const shareUrl=url();try{await navigator.clipboard.writeText(shareUrl);track("copy_link");setCopied(true);window.setTimeout(()=>setCopied(false),1800)}catch{}}
 function facebook(){const shareUrl=url();track("facebook");window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,"_blank","noopener,noreferrer,width=680,height=620")}
 function whatsapp(){const shareUrl=url();track("whatsapp");window.open(`https://wa.me/?text=${encodeURIComponent(`Découvrez mon annonce sur Petit Annonces : ${shareUrl}`)}`,"_blank","noopener,noreferrer")}
 async function messenger(){const shareUrl=url();track("messenger");if(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)){window.location.href=`fb-messenger://share/?link=${encodeURIComponent(shareUrl)}`;return}try{if(navigator.share){await navigator.share({title:"Mon annonce sur Petit Annonces",text:"Découvrez mon annonce sur Petit Annonces.",url:shareUrl});return}}catch{}await copy()}
 return <>
  <button type="button" className={className} onClick={facebook}><AppIcon name="share"/>Facebook</button>
  <button type="button" className={className} onClick={whatsapp}><AppIcon name="message"/>WhatsApp</button>
  <button type="button" className={className} onClick={()=>void messenger()}><AppIcon name="comments"/>Messenger</button>
  <button type="button" className={className} onClick={()=>void copy()}><AppIcon name="share"/>{copied?"Lien copié ✓":"Copier le lien"}</button>
 </>
}
