"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export type RegistrationAttribution={
  source:string;
  medium:string;
  campaign?:string;
  landingPath:string;
};

const KEY="pa_registration_attribution_v1";

function normalizeSource(value:string){
  const v=value.trim().toLowerCase();
  if(/^(fb|facebook|instagram|ig|meta)$/.test(v))return"meta";
  if(v.includes("google"))return"google";
  if(v.includes("bing")||v.includes("microsoft"))return"bing";
  if(v.includes("tiktok"))return"tiktok";
  if(v.includes("linkedin"))return"linkedin";
  if(v==="outreach")return"outreach";
  return v.replace(/[^a-z0-9_-]/g,"-").slice(0,40)||"direct";
}

function externalReferrer(){
  try{
    if(!document.referrer)return null;
    const url=new URL(document.referrer);
    if(url.hostname.endsWith("petitannonces.fr"))return null;
    return url.hostname.toLowerCase();
  }catch{return null}
}

function classifyCurrentPage():RegistrationAttribution|null{
  const q=new URLSearchParams(window.location.search);
  const utmSource=(q.get("utm_source")??"").trim();
  const utmMedium=(q.get("utm_medium")??"").trim().toLowerCase();
  const utmCampaign=(q.get("utm_campaign")??"").trim().slice(0,160);
  const landingPath=window.location.pathname.slice(0,300)||"/";
  if(utmSource)return{source:normalizeSource(utmSource),medium:(utmMedium||"campaign").slice(0,40),campaign:utmCampaign||undefined,landingPath};
  if(q.has("gclid")||q.has("gbraid")||q.has("wbraid"))return{source:"google",medium:"cpc",campaign:utmCampaign||undefined,landingPath};
  if(q.has("msclkid"))return{source:"bing",medium:"cpc",campaign:utmCampaign||undefined,landingPath};
  if(q.has("fbclid"))return{source:"meta",medium:utmMedium||"social",campaign:utmCampaign||undefined,landingPath};
  const host=externalReferrer();
  if(!host)return null;
  if(host.includes("google."))return{source:"google",medium:"organic",landingPath};
  if(host.includes("bing.com"))return{source:"bing",medium:"organic",landingPath};
  if(host.includes("facebook.com")||host.includes("instagram.com")||host.includes("fb.com"))return{source:"meta",medium:"social",landingPath};
  if(host.includes("tiktok.com"))return{source:"tiktok",medium:"social",landingPath};
  if(host.includes("linkedin.com"))return{source:"linkedin",medium:"social",landingPath};
  return{source:"referral",medium:"referral",campaign:host.slice(0,160),landingPath};
}

export function getRegistrationAttribution():RegistrationAttribution{
  try{
    const current=classifyCurrentPage();
    if(current){sessionStorage.setItem(KEY,JSON.stringify(current));return current}
    const raw=sessionStorage.getItem(KEY);
    if(raw){const parsed=JSON.parse(raw) as RegistrationAttribution;if(parsed?.source&&parsed?.medium)return parsed}
  }catch{}
  return{source:"direct",medium:"none",landingPath:typeof window!=="undefined"?window.location.pathname.slice(0,300)||"/":"/"};
}

export function RegistrationAttributionCapture(){
  const pathname=usePathname();
  useEffect(()=>{try{const current=classifyCurrentPage();if(current)sessionStorage.setItem(KEY,JSON.stringify(current));else if(!sessionStorage.getItem(KEY))sessionStorage.setItem(KEY,JSON.stringify({source:"direct",medium:"none",landingPath:window.location.pathname.slice(0,300)||"/"} satisfies RegistrationAttribution))}catch{}},[pathname]);
  return null;
}
