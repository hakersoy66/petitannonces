"use client";
import {useEffect} from "react";

export function ListingViewTracker({listingId}:{listingId:string}){
 useEffect(()=>{
  let cancelled=false;
  let timeoutId:number|undefined;
  let idleId:number|undefined;
  const send=()=>{
   if(cancelled)return;
   try{
    const key="pa_view_session_id";let visitorId=sessionStorage.getItem(key);if(!visitorId){visitorId=crypto.randomUUID();sessionStorage.setItem(key,visitorId)}
    void fetch(`/api/public/listings/${encodeURIComponent(listingId)}/view`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({visitorId}),keepalive:true}).catch(()=>{});
   }catch{}
  };
  const win=window as Window&{requestIdleCallback?:(callback:IdleRequestCallback,options?:IdleRequestOptions)=>number;cancelIdleCallback?:(handle:number)=>void};
  if(typeof win.requestIdleCallback==="function")idleId=win.requestIdleCallback(send,{timeout:1800});
  else timeoutId=window.setTimeout(send,900);
  return()=>{cancelled=true;if(idleId!==undefined&&typeof win.cancelIdleCallback==="function")win.cancelIdleCallback(idleId);if(timeoutId!==undefined)window.clearTimeout(timeoutId)};
 },[listingId]);
 return null;
}