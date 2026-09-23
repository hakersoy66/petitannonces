"use client";

import {useEffect} from "react";

const staleBuildPattern=/ChunkLoadError|Loading chunk|Failed to load chunk|CSS_CHUNK_LOAD_FAILED|Failed to fetch dynamically imported module|Failed to find Server Action|Server Action.*not found|module factory is not available|Cannot find module.*_next\/static/i;

function textOf(value:unknown){
 if(value instanceof Error)return `${value.name} ${value.message} ${value.stack??""}`;
 if(typeof value==="string")return value;
 try{return JSON.stringify(value)}catch{return String(value??"")}
}

export function NavigationRecovery(){
 useEffect(()=>{
  let recovering=false;
  const recover=()=>{
   if(recovering)return;
   const key=`pa:stale-build-recovery:${location.pathname}`;
   const now=Date.now();
   let last=0;
   try{last=Number(sessionStorage.getItem(key)??0)}catch{}
   if(Number.isFinite(last)&&now-last<20_000)return;
   recovering=true;
   try{sessionStorage.setItem(key,String(now))}catch{}
   try{navigator.serviceWorker?.getRegistration?.().then(reg=>reg?.update().catch(()=>undefined)).catch(()=>undefined)}catch{}
   window.setTimeout(()=>location.reload(),180);
  };
  const onError=(event:Event)=>{
   const target=event.target;
   if(target instanceof HTMLScriptElement&&target.src.includes("/_next/static/")){recover();return}
   if(target instanceof HTMLLinkElement&&target.href.includes("/_next/static/")){recover();return}
   if(event instanceof ErrorEvent&&staleBuildPattern.test(textOf(event.error??event.message)))recover();
  };
  const onRejection=(event:PromiseRejectionEvent)=>{if(staleBuildPattern.test(textOf(event.reason)))recover()};
  window.addEventListener("error",onError,true);
  window.addEventListener("unhandledrejection",onRejection);
  return()=>{window.removeEventListener("error",onError,true);window.removeEventListener("unhandledrejection",onRejection)};
 },[]);
 return null;
}
