"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const CONSENT_KEY="pa_cookie_consent_v1";
type Consent={advertising?:boolean};
type MetaEventName="CompleteRegistration"|"ListingSubmitted"|"InitiateCheckout"|"Purchase"|"StartTrial";
type MetaEventDetail={name?:MetaEventName;eventId?:string;params?:Record<string,unknown>};
type Fbq=(command:string,...args:unknown[])=>void;

declare global{interface Window{fbq?:Fbq;_fbq?:Fbq}}
function advertisingAllowed(){try{const raw=localStorage.getItem(CONSENT_KEY);return Boolean(raw&&((JSON.parse(raw) as Consent).advertising===true))}catch{return false}}
function cookie(name:string){const match=document.cookie.match(new RegExp(`(?:^|; )${name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}=([^;]*)`));return match?decodeURIComponent(match[1]!):undefined}
function eventId(prefix:string){return `${prefix}-${typeof crypto!=="undefined"&&crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2)}`}`}

function ensurePixel(pixelId:string){
 if(window.fbq){window.fbq("consent","grant");return}
 const fbq:((...args:unknown[])=>void)&{callMethod?:((...args:unknown[])=>void);queue?:unknown[];loaded?:boolean;version?:string} = function(...args:unknown[]){if(fbq.callMethod)fbq.callMethod(...args);else fbq.queue!.push(args)};
 fbq.queue=[];fbq.loaded=true;fbq.version="2.0";window.fbq=fbq as Fbq;window._fbq=fbq as Fbq;
 const script=document.createElement("script");script.async=true;script.src="https://connect.facebook.net/en_US/fbevents.js";script.dataset.paMetaPixel=pixelId;document.head.appendChild(script);
 window.fbq("init",pixelId);window.fbq("consent","grant");
}
async function capi(name:"PageView"|MetaEventName,id:string,params:Record<string,unknown>={}){
 if(!advertisingAllowed())return;
 try{await fetch("/api/meta/events",{method:"POST",credentials:"include",keepalive:true,headers:{"content-type":"application/json"},body:JSON.stringify({eventName:name,eventId:id,eventSourceUrl:window.location.href,advertisingConsent:true,fbp:cookie("_fbp"),fbc:cookie("_fbc"),customData:params})})}catch{}
}

export function MetaPixel(){
 const pathname=usePathname();const search=useSearchParams();const[pixelId,setPixelId]=useState("");const[enabled,setEnabled]=useState(false);const lastPage=useRef("");
 useEffect(()=>{let active=true;fetch("/api/meta/config",{cache:"no-store"}).then(r=>r.ok?r.json():null).then((x:{pixelId?:string|null}|null)=>{if(active&&x?.pixelId)setPixelId(x.pixelId)}).catch(()=>{});return()=>{active=false}},[]);
 useEffect(()=>{const sync=()=>{const allowed=advertisingAllowed();setEnabled(allowed);if(pixelId&&allowed)ensurePixel(pixelId);else window.fbq?.("consent","revoke")};sync();const onConsent=()=>sync();window.addEventListener("pa:consent-changed",onConsent);return()=>window.removeEventListener("pa:consent-changed",onConsent)},[pixelId]);
 useEffect(()=>{if(!pixelId)return;const onMeta=(event:Event)=>{if(!advertisingAllowed())return;const detail=(event as CustomEvent<MetaEventDetail>).detail;if(!detail?.name)return;ensurePixel(pixelId);const id=detail.eventId??eventId(detail.name.toLowerCase());if(detail.name==="ListingSubmitted")window.fbq?.("trackCustom",detail.name,detail.params??{},{eventID:id});else window.fbq?.("track",detail.name,detail.params??{},{eventID:id});void capi(detail.name,id,detail.params??{})};window.addEventListener("pa:meta-event",onMeta);return()=>window.removeEventListener("pa:meta-event",onMeta)},[pixelId]);
 useEffect(()=>{if(!enabled||!pixelId)return;ensurePixel(pixelId);const query=search.toString();const page=`${pathname}${query?`?${query}`:""}`;if(lastPage.current===page)return;lastPage.current=page;const id=eventId("pageview");window.fbq?.("track","PageView",{},{eventID:id});void capi("PageView",id)},[enabled,pixelId,pathname,search]);
 return null;
}
