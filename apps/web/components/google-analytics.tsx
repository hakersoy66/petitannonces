"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const CONSENT_KEY="pa_cookie_consent_v1";
type AnalyticsEvent = { name?: string; params?: Record<string, unknown> };

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    __paGaInitialized?: Record<string, boolean>;
  }
}

function analyticsAllowed(){
  try{return Boolean(JSON.parse(localStorage.getItem(CONSENT_KEY)||"null")?.analytics)}catch{return false}
}

function ensureGtag(measurementId:string){
  window.dataLayer=window.dataLayer??[];
  window.gtag=window.gtag??function(...args:unknown[]){window.dataLayer!.push(args)};
  window.__paGaInitialized=window.__paGaInitialized??{};
  window.gtag("consent","update",{analytics_storage:"granted"});
  if(!document.querySelector(`script[data-pa-ga="${measurementId}"]`)){
    const script=document.createElement("script");
    script.async=true;
    script.src=`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    script.dataset.paGa=measurementId;
    document.head.appendChild(script);
  }
  if(!window.__paGaInitialized[measurementId]){
    window.gtag("js",new Date());
    window.gtag("config",measurementId,{send_page_view:false});
    window.__paGaInitialized[measurementId]=true;
  }
}

function revokeAnalytics(){
  if(!window.gtag)return;
  window.gtag("consent","update",{analytics_storage:"denied"});
}

function sendPageView(measurementId:string,pathname:string,query:string){
  const pagePath=`${pathname}${query?`?${query}`:""}`;
  window.gtag?.("event","page_view",{send_to:measurementId,page_path:pagePath,page_location:window.location.href,page_title:document.title});
  return pagePath;
}

export function GoogleAnalytics({measurementId}:{measurementId?:string|null}){
  const pathname=usePathname();
  const searchParams=useSearchParams();
  const lastPage=useRef("");
  const id=(measurementId??"").trim();
  const query=useMemo(()=>searchParams.toString(),[searchParams]);
  const [enabled,setEnabled]=useState(false);

  useEffect(()=>{
    if(!id)return;
    const apply=()=>{
      const allowed=analyticsAllowed();
      setEnabled(allowed);
      if(allowed)ensureGtag(id);else revokeAnalytics();
    };
    apply();
    window.addEventListener("pa:consent-changed",apply);
    return()=>window.removeEventListener("pa:consent-changed",apply);
  },[id]);

  useEffect(()=>{
    if(!id||!enabled)return;
    const onAnalytics=(event:Event)=>{
      if(!analyticsAllowed())return;
      const detail=(event as CustomEvent<AnalyticsEvent>).detail;
      if(!detail?.name)return;
      ensureGtag(id);
      window.gtag?.("event",detail.name,{...(detail.params??{}),send_to:id});
    };
    window.addEventListener("pa:analytics-event",onAnalytics);
    return()=>window.removeEventListener("pa:analytics-event",onAnalytics);
  },[id,enabled]);

  useEffect(()=>{
    if(!id||!enabled||!analyticsAllowed())return;
    ensureGtag(id);
    const pagePath=`${pathname}${query?`?${query}`:""}`;
    if(lastPage.current===pagePath)return;
    lastPage.current=sendPageView(id,pathname,query);
  },[id,enabled,pathname,query]);

  return null;
}
