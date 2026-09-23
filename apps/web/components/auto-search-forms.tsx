"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppIcon } from "./app-icon";
import { navigateApp } from "../lib/app-navigation";

const MIN_AUTO_SEARCH_CHARS=3;
const AUTO_SEARCH_DELAY_MS=500;

function emitSearch(term:string,source:string){
 if(typeof window==="undefined")return;
 window.dispatchEvent(new CustomEvent("pa:analytics-event",{detail:{name:"search",params:{search_term:term,search_source:source}}}));
}

function searchHref(query:string,city?:string){
 const params=new URLSearchParams();
 if(query.trim())params.set("q",query.trim());
 if(city?.trim())params.set("city",city.trim());
 return `/recherche${params.size?`?${params.toString()}`:""}`;
}

export function HomeAutoSearchForm({placeholder}:{placeholder:string}){
 const router=useRouter();
 const [query,setQuery]=useState("");
 const lastAuto=useRef("");
 useEffect(()=>{
  const value=query.trim();
  if(value.length<MIN_AUTO_SEARCH_CHARS){lastAuto.current="";return;}
  const timer=window.setTimeout(()=>{
   if(lastAuto.current===value)return;
   lastAuto.current=value;
   emitSearch(value,"home_auto");
   router.replace(searchHref(value));
  },AUTO_SEARCH_DELAY_MS);
  return()=>window.clearTimeout(timer);
 },[query,router]);
 function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const value=query.trim();emitSearch(value,"home_submit");navigateApp(router,searchHref(value));}
 return <form action="/recherche" method="get" role="search" onSubmit={submit}><input name="q" type="search" value={query} onChange={event=>setQuery(event.target.value)} aria-label="Décrivez ce que vous recherchez" placeholder={placeholder} autoComplete="off"/><button type="submit" aria-label="Rechercher"><AppIcon name="arrow-right"/></button></form>;
}

export function SearchPageAutoForm({initialQuery,initialCity,className,fieldClassName}:{initialQuery:string;initialCity:string;className?:string;fieldClassName?:string}){
 const router=useRouter();
 const [query,setQuery]=useState(initialQuery);
 const [city,setCity]=useState(initialCity);
 const initialQueryRef=useRef(initialQuery.trim());
 const lastAuto=useRef(initialQuery.trim());
 useEffect(()=>{
  const value=query.trim();
  if(value===initialQueryRef.current||value.length<MIN_AUTO_SEARCH_CHARS)return;
  const timer=window.setTimeout(()=>{
   if(lastAuto.current===value)return;
   lastAuto.current=value;
   emitSearch(value,"results_auto");
   router.replace(searchHref(value,city));
  },AUTO_SEARCH_DELAY_MS);
  return()=>window.clearTimeout(timer);
 },[query,city,router]);
 function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const value=query.trim();emitSearch(value,"results_submit");navigateApp(router,searchHref(value,city));}
 return <form action="/recherche" method="get" className={className} onSubmit={submit}>
  <label className={fieldClassName}><AppIcon name="search"/><input name="q" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Que recherchez-vous ?" aria-label="Recherche" autoComplete="off"/></label>
  <label className={fieldClassName}><AppIcon name="location"/><input name="city" value={city} onChange={event=>setCity(event.target.value)} placeholder="Ville ou code postal" aria-label="Ville"/></label>
  <button type="submit"><AppIcon name="search"/>Rechercher</button>
 </form>;
}
