"use client";
import {useEffect,useRef} from "react";
export function useVisiblePolling<T>(path:string,intervalMs:number,onData:(data:T)=>void,onError:()=>void){
 const latest=useRef({onData,onError});latest.current={onData,onError};
 useEffect(()=>{let active=true;let controller:AbortController|null=null;
 async function refresh(){if(!active||document.hidden||controller)return;const current=new AbortController();controller=current;try{
 const r=await fetch(path,{credentials:"include",cache:"no-store",signal:current.signal});if(!r.ok)throw Error();const v=await r.json() as T;
 if(active&&!current.signal.aborted)latest.current.onData(v);
 }catch{if(active&&!current.signal.aborted)latest.current.onError()}finally{if(controller===current)controller=null}}
 function visibility(){if(document.hidden)controller?.abort();else void refresh()}
 void refresh();const timer=window.setInterval(refresh,intervalMs);document.addEventListener("visibilitychange",visibility);
 return()=>{active=false;controller?.abort();window.clearInterval(timer);document.removeEventListener("visibilitychange",visibility)}
 },[path,intervalMs]);
}
