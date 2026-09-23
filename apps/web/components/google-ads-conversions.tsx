"use client";

import { useEffect, useRef } from "react";

const CONSENT_KEY="pa_cookie_consent_v1";
const ADS_ID="AW-18454504179";
const SEND_TO={
  sign_up:"AW-18454504179/YuSrCOulqfwcEPPF5d9E",
  listing_submitted:"AW-18454504179/xf06CPqzpPwcEPPF5d9E",
  purchase:"AW-18454504179/LPR5CKn1lfwcEPPF5d9E",
} as const;

type AdsEventName=keyof typeof SEND_TO;
type AnalyticsDetail={name?:string;params?:Record<string,unknown>};
declare global{interface Window{dataLayer?:unknown[];gtag?:(...args:unknown[])=>void;__paGoogleAdsInitialized?:boolean}}

function advertisingAllowed(){
 try{return Boolean(JSON.parse(localStorage.getItem(CONSENT_KEY)||"null")?.advertising)}catch{return false}
}

function ensureGtag(loadScript=false){
 window.dataLayer=window.dataLayer??[];
 window.gtag=window.gtag??function(...args:unknown[]){window.dataLayer!.push(args)};
 if(loadScript&&!document.querySelector("script[data-pa-ga]")&&!document.querySelector("script[data-pa-google-ads]")){
  const script=document.createElement("script");
  script.async=true;script.src=`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ADS_ID)}`;
  script.dataset.paGoogleAds=ADS_ID;document.head.appendChild(script);
 }
}

function grantAndConfigure(){
 if(!advertisingAllowed())return false;
 ensureGtag(true);
 window.gtag?.("consent","update",{ad_storage:"granted",ad_user_data:"granted",ad_personalization:"granted"});
 if(!window.__paGoogleAdsInitialized){
  window.gtag?.("config",ADS_ID,{send_page_view:false});
  window.__paGoogleAdsInitialized=true;
 }
 return true;
}

function revoke(){
 ensureGtag(false);
 window.gtag?.("consent","update",{ad_storage:"denied",ad_user_data:"denied",ad_personalization:"denied"});
}

function numeric(value:unknown){
 const n=typeof value==="number"?value:Number(value);
 return Number.isFinite(n)?n:undefined;
}

export function GoogleAdsConversions(){
 const sent=useRef(new Set<string>());
 useEffect(()=>{
  ensureGtag();
  if(advertisingAllowed())grantAndConfigure();else revoke();
  const onConsent=()=>{if(advertisingAllowed())grantAndConfigure();else revoke()};
  const onAnalytics=(event:Event)=>{
   if(!advertisingAllowed()||!grantAndConfigure())return;
   const detail=(event as CustomEvent<AnalyticsDetail>).detail;
   const name=detail?.name as AdsEventName|undefined;
   if(!name||!(name in SEND_TO))return;
   const p=detail.params??{};
   const transactionId=typeof p.transaction_id==="string"?p.transaction_id:"";
   const listingId=typeof p.listing_id==="string"?p.listing_id:"";
   const key=name==="purchase"?`${name}:${transactionId||"unknown"}`:name==="listing_submitted"?`${name}:${listingId||"unknown"}`:name;
   if(sent.current.has(key))return;
   sent.current.add(key);
   const payload:Record<string,unknown>={send_to:SEND_TO[name]};
   if(name==="purchase"){
    const value=numeric(p.value);if(value!==undefined)payload.value=value;
    payload.currency=typeof p.currency==="string"&&p.currency?p.currency:"EUR";
    if(transactionId)payload.transaction_id=transactionId;
   }
   window.gtag?.("event","conversion",payload);
  };
  window.addEventListener("pa:consent-changed",onConsent);
  window.addEventListener("pa:analytics-event",onAnalytics);
  return()=>{window.removeEventListener("pa:consent-changed",onConsent);window.removeEventListener("pa:analytics-event",onAnalytics)};
 },[]);
 return null;
}
