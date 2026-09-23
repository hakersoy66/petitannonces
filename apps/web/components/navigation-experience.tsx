"use client";

import { type CSSProperties, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { healStaleBodyScrollLock } from "../lib/body-scroll-lock";

function sameOriginTarget(anchor: HTMLAnchorElement) {
  const href=anchor.getAttribute("href")??"";
  if(!href||href.startsWith("#")||href.startsWith("mailto:")||href.startsWith("tel:")||href.startsWith("javascript:"))return null;
  try{
    const url=new URL(anchor.href,window.location.href);
    if(url.origin!==window.location.origin)return null;
    return url;
  }catch{return null}
}

function standaloneMode(){
  return window.matchMedia("(display-mode: standalone)").matches||Boolean((navigator as Navigator&{standalone?:boolean}).standalone);
}

export function NavigationExperience(){
  const router=useRouter();
  const pathname=usePathname();
  const [navigating,setNavigating]=useState(false);
  const [pullProgress,setPullProgress]=useState(0);
  const [refreshing,setRefreshing]=useState(false);
  const navTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const prefetchTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const prefetched=useRef<Set<string>>(new Set());
  const lastPath=useRef(pathname);
  const startY=useRef(0);
  const pulling=useRef(false);
  const pullProgressRef=useRef(0);

  useEffect(()=>{
    healStaleBodyScrollLock();
    if(lastPath.current!==pathname){
      lastPath.current=pathname;
      const done=window.setTimeout(()=>setNavigating(false),140);
      return()=>window.clearTimeout(done);
    }
  },[pathname]);

  useEffect(()=>{
    const isCatalogPath=pathname.startsWith("/categorie/")||pathname.startsWith("/c/")||pathname.startsWith("/vehicules/")||pathname.startsWith("/immobilier/")||pathname.startsWith("/vacances");
    if(!isCatalogPath||prefetched.current.has("/"))return;
    const timer=window.setTimeout(()=>{
      prefetched.current.add("/");
      router.prefetch("/");
    },80);
    return()=>window.clearTimeout(timer);
  },[pathname,router]);

  useEffect(()=>{
    const normalizeTopViewport=()=>{
      if(!standaloneMode()||window.scrollY>2)return;
      window.scrollTo({top:0,left:0,behavior:"auto"});
      document.documentElement.scrollTop=0;
      document.body.scrollTop=0;
    };
    const resetNavigationState=()=>{
      if(navTimer.current)clearTimeout(navTimer.current);
      healStaleBodyScrollLock();
      normalizeTopViewport();
      window.requestAnimationFrame(normalizeTopViewport);
      setNavigating(false);
      setPullProgress(0);
      setRefreshing(false);
      pulling.current=false;
      pullProgressRef.current=0;
    };
    const onVisibility=()=>{if(document.visibilityState==="visible")resetNavigationState()};
    window.addEventListener("pageshow",resetNavigationState);
    window.addEventListener("popstate",resetNavigationState);
    window.addEventListener("focus",resetNavigationState);
    document.addEventListener("visibilitychange",onVisibility);
    return()=>{window.removeEventListener("pageshow",resetNavigationState);window.removeEventListener("popstate",resetNavigationState);window.removeEventListener("focus",resetNavigationState);document.removeEventListener("visibilitychange",onVisibility)};
  },[]);

  useEffect(()=>{
    function completeSoon(){
      if(navTimer.current)clearTimeout(navTimer.current);
      navTimer.current=setTimeout(()=>setNavigating(false),1400);
    }
    function onClick(event:MouseEvent){
      if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
      const target=event.target instanceof Element?event.target.closest("a"):null;
      if(!(target instanceof HTMLAnchorElement))return;
      if(target.hasAttribute("download")||(target.target&&target.target!=="_self")||target.dataset.nativeNavigation==="true")return;
      const url=sameOriginTarget(target);if(!url)return;
      const current=`${window.location.pathname}${window.location.search}${window.location.hash}`;
      const next=`${url.pathname}${url.search}${url.hash}`;
      if(url.hash&&url.pathname===window.location.pathname&&url.search===window.location.search)return;
      if(next===current||(!url.search&&!url.hash&&url.pathname===window.location.pathname))return;
      healStaleBodyScrollLock();
      setNavigating(true);completeSoon();
      // Do not hijack the click. Next <Link> handles its own client navigation,
      // while ordinary <a> links keep the browser\'s reliable full navigation.
      // This is especially important in installed PWAs after a new deployment.
    }
    function onPointerOver(event:PointerEvent){
      if(event.pointerType==="touch")return;
      const target=event.target instanceof Element?event.target.closest("a"):null;
      if(!(target instanceof HTMLAnchorElement))return;
      const url=sameOriginTarget(target);if(!url||url.hash)return;
      const href=`${url.pathname}${url.search}`;
      if(prefetched.current.has(href))return;
      if(prefetchTimer.current)clearTimeout(prefetchTimer.current);
      prefetchTimer.current=setTimeout(()=>{prefetched.current.add(href);router.prefetch(href)},140);
    }
    function onPointerOut(event:PointerEvent){
      const target=event.target instanceof Element?event.target.closest("a"):null;
      if(!(target instanceof HTMLAnchorElement))return;
      const related=event.relatedTarget instanceof Node?event.relatedTarget:null;
      if(related&&target.contains(related))return;
      if(prefetchTimer.current){clearTimeout(prefetchTimer.current);prefetchTimer.current=null;}
    }
    const onPopState=()=>{setNavigating(true);completeSoon()};
    document.addEventListener("click",onClick,true);
    document.addEventListener("pointerover",onPointerOver,true);
    document.addEventListener("pointerout",onPointerOut,true);
    window.addEventListener("popstate",onPopState);
    return()=>{document.removeEventListener("click",onClick,true);document.removeEventListener("pointerover",onPointerOver,true);document.removeEventListener("pointerout",onPointerOut,true);window.removeEventListener("popstate",onPopState);if(navTimer.current)clearTimeout(navTimer.current);if(prefetchTimer.current)clearTimeout(prefetchTimer.current)};
  },[router]);

  useEffect(()=>{
    if(!standaloneMode())return;
    const threshold=84;
    function onStart(event:TouchEvent){
      healStaleBodyScrollLock();
      if(refreshing||window.scrollY>1||event.touches.length!==1)return;
      const el=event.target instanceof Element?event.target:null;
      if(el?.closest("input,textarea,select,[contenteditable='true'],[data-no-pull-refresh]"))return;
      startY.current=event.touches[0]?.clientY??0;
      pulling.current=true;
      pullProgressRef.current=0;
      setPullProgress(0);
    }
    function onMove(event:TouchEvent){
      if(!pulling.current||refreshing||window.scrollY>1)return;
      const delta=(event.touches[0]?.clientY??0)-startY.current;
      if(delta<=0){pullProgressRef.current=0;setPullProgress(0);return;}
      const progress=Math.max(0,Math.min(1,delta/threshold));
      pullProgressRef.current=progress;
      setPullProgress(progress);
    }
    function finish(){
      if(!pulling.current)return;
      pulling.current=false;
      if(pullProgressRef.current>=1){
        setRefreshing(true);setPullProgress(1);
        window.scrollTo({top:0,left:0,behavior:"auto"});
        document.documentElement.scrollTop=0;
        document.body.scrollTop=0;
        window.requestAnimationFrame(()=>window.setTimeout(()=>window.location.reload(),120));
      }else setPullProgress(0);
    }
    window.addEventListener("touchstart",onStart,{passive:true});
    window.addEventListener("touchmove",onMove,{passive:true});
    window.addEventListener("touchend",finish,{passive:true});
    window.addEventListener("touchcancel",finish,{passive:true});
    return()=>{window.removeEventListener("touchstart",onStart);window.removeEventListener("touchmove",onMove);window.removeEventListener("touchend",finish);window.removeEventListener("touchcancel",finish)};
  },[refreshing]);

  return <>
    {navigating&&<div className="pa-route-progress" aria-hidden="true"><i/></div>}
    {(pullProgress>0||refreshing)&&<div className={`pa-pull-refresh${refreshing?" is-refreshing":""}`} style={{"--pa-pull":String(pullProgress)} as CSSProperties} aria-hidden="true"><span/></div>}
  </>;
}
