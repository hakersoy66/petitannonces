"use client";
import { useReportWebVitals } from "next/web-vitals";
function consent(){try{return Boolean(JSON.parse(localStorage.getItem("pa_cookie_consent_v1")||"null")?.analytics)}catch{return false}}
function gid(storage:Storage,key:string){const old=storage.getItem(key);if(old)return old;const v=crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2)}`;storage.setItem(key,v);return v}
const CORE_WEB_VITALS=new Set(["CLS","LCP","INP","FCP","TTFB"]);
export function WebVitalsReporter(){useReportWebVitals(metric=>{if(!consent()||!CORE_WEB_VITALS.has(metric.name))return;const visitorId=gid(localStorage,"pa_anon_id"),sessionId=gid(sessionStorage,"pa_visit_session");void fetch("/api/analytics/web-vital",{method:"POST",credentials:"include",keepalive:true,headers:{"content-type":"application/json"},body:JSON.stringify({visitorId,sessionId,path:location.pathname,name:metric.name,value:metric.value,delta:metric.delta,rating:metric.rating,navigationType:metric.navigationType})}).catch(()=>{})});return null}
