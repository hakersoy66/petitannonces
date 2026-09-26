"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

const CONSENT_KEY="pa_cookie_consent_v1";
export type SiteAnalyticsEvent=
 | "PAGE_VIEW" | "HEARTBEAT" | "PWA_INSTALLED" | "PWA_STANDALONE"
 | "PWA_ONBOARDING_STARTED" | "PWA_ONBOARDING_COMPLETED" | "PWA_INSTALL_GUIDE_OPENED"
 | "PWA_PUSH_PROMPTED" | "PWA_PUSH_ACCEPTED" | "PWA_PUSH_DECLINED"
 | "SIGN_UP_COMPLETED" | "PHONE_VERIFIED" | "LISTING_SUBMITTED" | "MESSAGE_SENT"
 | "CHECKOUT_STARTED" | "PURCHASE_COMPLETED" | "PRO_TRIAL_STARTED" | "LANDING_CTA_CLICKED"
 | "PHOTO_UPLOAD_FAILED" | "LISTING_PUBLISH_CLICKED" | "LISTING_PUBLISH_SUCCEEDED" | "LISTING_PUBLISH_FAILED" | "CHECKOUT_FAILED";
export function analyticsAllowed(){try{const raw=localStorage.getItem(CONSENT_KEY);if(!raw)return false;return Boolean(JSON.parse(raw)?.analytics)}catch{return false}}
function advertisingAllowed(){try{const raw=localStorage.getItem(CONSENT_KEY);if(!raw)return false;return Boolean(JSON.parse(raw)?.advertising)}catch{return false}}
function id(storage:Storage,key:string){const old=storage.getItem(key);if(old)return old;const v=typeof crypto!=="undefined"&&crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2)}`;storage.setItem(key,v);return v}
function standalone(){return window.matchMedia?.("(display-mode: standalone)").matches||Boolean((navigator as Navigator&{standalone?:boolean}).standalone)}
function eventId(prefix:string){return `${prefix}-${typeof crypto!=="undefined"&&crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2)}`}`}

type CampaignAttribution={source?:string;medium?:string;campaign?:string;attributionPath?:string;capturedAt?:number};
type TrafficAttribution={source:string;medium:string;campaign?:string};
function normalizedSource(value:string){const v=value.trim().toLowerCase();if(/^(fb|facebook|instagram|ig|meta)$/.test(v))return"meta";if(v.includes("google"))return"google";if(v.includes("bing")||v.includes("microsoft"))return"bing";if(v.includes("tiktok"))return"tiktok";if(v.includes("linkedin"))return"linkedin";return v||"direct"}
function trafficAttribution():TrafficAttribution{
 const key="pa_session_traffic_source_v1";
 try{const existing=sessionStorage.getItem(key);if(existing)return JSON.parse(existing) as TrafficAttribution;const q=new URLSearchParams(window.location.search);const utmSource=q.get("utm_source")?.trim()||"",utmMedium=q.get("utm_medium")?.trim()||"",utmCampaign=q.get("utm_campaign")?.trim()||"";let value:TrafficAttribution;
  if(utmSource)value={source:normalizedSource(utmSource),medium:utmMedium||"campaign",campaign:utmCampaign||undefined};
  else if(q.get("fbclid"))value={source:"meta",medium:"paid_social",campaign:utmCampaign||undefined};
  else if(q.get("gclid")||q.get("gbraid")||q.get("wbraid"))value={source:"google",medium:"cpc",campaign:utmCampaign||undefined};
  else if(q.get("msclkid"))value={source:"bing",medium:"cpc",campaign:utmCampaign||undefined};
  else{let host="";try{host=document.referrer?new URL(document.referrer).hostname.toLowerCase():""}catch{}if(!host)value={source:"direct",medium:"none"};else if(/(^|\.)facebook\.com$|(^|\.)instagram\.com$|(^|\.)fb\.com$/.test(host))value={source:"meta",medium:"social"};else if(host.includes("google."))value={source:"google",medium:"organic"};else if(host.includes("bing.com"))value={source:"bing",medium:"organic"};else if(host.includes("tiktok.com"))value={source:"tiktok",medium:"social"};else if(host.includes("linkedin.com"))value={source:"linkedin",medium:"social"};else if(host.endsWith("petitannonces.fr"))value={source:"direct",medium:"internal"};else value={source:"referral",medium:"referral",campaign:host}}
  sessionStorage.setItem(key,JSON.stringify(value));return value;
 }catch{return{source:"direct",medium:"none"}}
}
function attribution():CampaignAttribution{
 const key="pa_campaign_attribution_v2",ttl=30*24*60*60*1000;
 try{
  const q=new URLSearchParams(window.location.search);let source=q.get("utm_source")?.trim()||"",medium=q.get("utm_medium")?.trim()||"",campaign=q.get("utm_campaign")?.trim()||"";
  if(!source&&q.get("fbclid")){source="meta";medium="paid_social";campaign=campaign||"meta-unspecified"}
  else if(!source&&(q.get("gclid")||q.get("gbraid")||q.get("wbraid"))){source="google";medium="cpc";campaign=campaign||"google-unspecified"}
  else if(!source&&q.get("msclkid")){source="bing";medium="cpc";campaign=campaign||"bing-unspecified"}
  if(source||medium||campaign){const value:CampaignAttribution={source:normalizedSource(source)||undefined,medium:medium||undefined,campaign:campaign||undefined,attributionPath:window.location.pathname,capturedAt:Date.now()};localStorage.setItem(key,JSON.stringify(value));return value}
  const raw=localStorage.getItem(key);if(!raw)return{};const value=JSON.parse(raw) as CampaignAttribution;if(!value.capturedAt||Date.now()-value.capturedAt>ttl){localStorage.removeItem(key);return{}}return value;
 }catch{return {}}
}
export async function sendSiteAnalyticsEvent(event:SiteAnalyticsEvent,path?:string){const visitorId=id(localStorage,"pa_anon_id"),sessionId=id(sessionStorage,"pa_visit_session");const currentPath=path??`${window.location.pathname}${window.location.search}`;const campaign=attribution();const traffic=trafficAttribution();try{await fetch("/api/analytics/event",{method:"POST",credentials:"include",keepalive:true,headers:{"content-type":"application/json"},body:JSON.stringify({visitorId,sessionId,event,path:currentPath,referrer:document.referrer||undefined,pwaMode:standalone(),source:campaign.source,medium:campaign.medium,campaign:campaign.campaign,attributionPath:campaign.attributionPath,trafficSource:traffic.source,trafficMedium:traffic.medium,trafficCampaign:traffic.campaign})})}catch{}}
type MetaConversionName="CompleteRegistration"|"ListingSubmitted"|"InitiateCheckout"|"Purchase"|"StartTrial";
function metaConversionName(event:SiteAnalyticsEvent):MetaConversionName|null{if(event==="SIGN_UP_COMPLETED")return"CompleteRegistration";if(event==="LISTING_SUBMITTED")return"ListingSubmitted";if(event==="CHECKOUT_STARTED")return"InitiateCheckout";if(event==="PURCHASE_COMPLETED")return"Purchase";if(event==="PRO_TRIAL_STARTED")return"StartTrial";return null}
function dispatchAnalytics(event:SiteAnalyticsEvent,gaEvent:string,params:Record<string,unknown>){void sendSiteAnalyticsEvent(event);try{window.dispatchEvent(new CustomEvent("pa:analytics-event",{detail:{name:gaEvent,params}}))}catch{}}
function dispatchAdvertising(event:SiteAnalyticsEvent,params:Record<string,unknown>){const name=metaConversionName(event);if(!name)return;try{window.dispatchEvent(new CustomEvent("pa:meta-event",{detail:{name,eventId:eventId(name.toLowerCase()),params}}))}catch{}}
export function trackSiteConversion(event:SiteAnalyticsEvent,gaEvent:string,params:Record<string,unknown>={}){dispatchAnalytics(event,gaEvent,params);if(advertisingAllowed())dispatchAdvertising(event,params)}
export function trackSiteConversionOnce(event:SiteAnalyticsEvent,gaEvent:string,dedupeKey:string,params:Record<string,unknown>={}){const safe=dedupeKey.replace(/[^a-zA-Z0-9:_-]/g,"_").slice(0,180);const key=`pa_conversion_once_analytics:${event}:${safe}`;if(!localStorage.getItem(key)){dispatchAnalytics(event,gaEvent,params);localStorage.setItem(key,String(Date.now()))}if(advertisingAllowed()){const adKey=`pa_conversion_once_ads:${event}:${safe}`;if(!localStorage.getItem(adKey)){dispatchAdvertising(event,params);localStorage.setItem(adKey,String(Date.now()))}}}
export function SiteTelemetry(){
 const pathname=usePathname();const standaloneSent=useRef(false);
 useEffect(()=>{void sendSiteAnalyticsEvent("PAGE_VIEW",pathname||"/")},[pathname]);
 useEffect(()=>{const path=()=>window.location.pathname+window.location.search;if(standalone()&&!standaloneSent.current){standaloneSent.current=true;void sendSiteAnalyticsEvent("PWA_STANDALONE",path())}const onInstalled=()=>void sendSiteAnalyticsEvent("PWA_INSTALLED",path());window.addEventListener("appinstalled",onInstalled);const timer=window.setInterval(()=>{if(document.visibilityState==="visible")void sendSiteAnalyticsEvent("HEARTBEAT",path())},60_000);void sendSiteAnalyticsEvent("HEARTBEAT",path());return()=>{window.removeEventListener("appinstalled",onInstalled);window.clearInterval(timer)}},[]);
 return null;
}
