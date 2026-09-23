"use client";

import {useEffect} from "react";

export function AboutExperience(){
 useEffect(()=>{
  const items=Array.from(document.querySelectorAll<HTMLElement>("[data-about-reveal]"));
  if(!items.length)return;
  if(window.matchMedia("(prefers-reduced-motion: reduce)").matches){items.forEach(item=>item.dataset.visible="true");return;}
  const observer=new IntersectionObserver(entries=>{
   for(const entry of entries){if(entry.isIntersecting){(entry.target as HTMLElement).dataset.visible="true";observer.unobserve(entry.target)}}
  },{threshold:.14,rootMargin:"0px 0px -8% 0px"});
  items.forEach(item=>observer.observe(item));
  return()=>observer.disconnect();
 },[]);
 return null;
}
