"use client";

import {useEffect,useMemo,useRef,useState} from "react";
import styles from "./vacation-map.module.css";

type Item={id:string;slug:string|null;title:string|null;priceMinor:number|null;currency:string;city:string|null;imageUrl:string|null;latitude:number|null;longitude:number|null;category?:{name:string;slug:string}};
type Bounds={north:number;south:number;east:number;west:number};
type Props={items:Item[];total:number;initialBounds?:Bounds|null};

function money(v:number,c="EUR"){return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c,maximumFractionDigits:v%100===0?0:2}).format(v/100)}
function validBounds(value:Bounds|null|undefined){return value&&Number.isFinite(value.north)&&Number.isFinite(value.south)&&Number.isFinite(value.east)&&Number.isFinite(value.west)&&value.south<value.north&&value.west<value.east?value:null}

export function VacationMap({items,total,initialBounds}:Props){
 const nodeRef=useRef<HTMLDivElement|null>(null);const mapRef=useRef<any>(null);const [ready,setReady]=useState(false);const [error,setError]=useState("");const [coarse,setCoarse]=useState(false);const [mapInteraction,setMapInteraction]=useState(false);const [movedBounds,setMovedBounds]=useState<Bounds|null>(null);
 const points=useMemo(()=>items.filter((item)=>Number.isFinite(item.latitude)&&Number.isFinite(item.longitude)) as Array<Item&{latitude:number;longitude:number}>,[items]);
 useEffect(()=>{setCoarse(window.matchMedia?.("(pointer: coarse)").matches??false)},[]);
 useEffect(()=>{
  let disposed=false;let armTimer:number|undefined;
  const init=()=>{
   if(disposed||!nodeRef.current||mapRef.current)return;const L=(window as any).L;if(!L){setError("La carte n’est pas disponible pour le moment.");return}
   const isCoarse=window.matchMedia?.("(pointer: coarse)").matches??false;const node=nodeRef.current;node.style.touchAction=isCoarse?"pan-y":"auto";
   const map=L.map(node,{zoomControl:true,scrollWheelZoom:false,dragging:!isCoarse,touchZoom:true,doubleClickZoom:!isCoarse,attributionControl:true});mapRef.current=map;
   L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>'}).addTo(map);
   const supplied=validBounds(initialBounds);if(supplied)map.fitBounds([[supplied.south,supplied.west],[supplied.north,supplied.east]],{padding:[20,20],maxZoom:14});else if(points.length>1)map.fitBounds(points.map(p=>[p.latitude,p.longitude]),{padding:[45,45],maxZoom:13});else if(points.length===1)map.setView([points[0]!.latitude,points[0]!.longitude],13);else map.setView([46.603354,1.888334],6);
   for(const item of points){const label=item.priceMinor!=null?money(item.priceMinor,item.currency):"Voir";const icon=L.divIcon({className:"pa-vacation-price-pin",html:`<span>${label.replace(/[<>&]/g,"")}</span>`,iconSize:[88,34],iconAnchor:[44,17]});const marker=L.marker([item.latitude,item.longitude],{icon}).addTo(map);const popup=document.createElement("div");popup.className="pa-vacation-map-popup";if(item.imageUrl){const image=document.createElement("img");image.src=item.imageUrl;image.alt="";image.loading="lazy";popup.appendChild(image)}const body=document.createElement("div");const title=document.createElement("strong");title.textContent=item.title??item.category?.name??"Hébergement Vacances";body.appendChild(title);const location=document.createElement("span");location.textContent=item.city??"France";body.appendChild(location);const price=document.createElement("b");price.textContent=item.priceMinor!=null?`${money(item.priceMinor,item.currency)} / nuit`:"Prix sur demande";body.appendChild(price);const link=document.createElement("a");link.href=item.slug?`/annonce/${item.slug}`:"/vacances";link.textContent="Voir l’annonce →";body.appendChild(link);popup.appendChild(body);marker.bindPopup(popup,{maxWidth:270,minWidth:220})}
   let armed=false;armTimer=window.setTimeout(()=>{armed=true},500);map.on("moveend",()=>{if(!armed)return;const b=map.getBounds();setMovedBounds({north:b.getNorth(),south:b.getSouth(),east:b.getEast(),west:b.getWest()})});setReady(true);
  };
  let script=document.getElementById("pa-leaflet-js") as HTMLScriptElement|null;if(!document.getElementById("pa-leaflet-css")){const link=document.createElement("link");link.id="pa-leaflet-css";link.rel="stylesheet";link.href="/vendor/leaflet/leaflet.css";document.head.appendChild(link)}
  if((window as any).L)init();else if(script){script.addEventListener("load",init,{once:true})}else{script=document.createElement("script");script.id="pa-leaflet-js";script.src="/vendor/leaflet/leaflet.js";script.async=true;script.addEventListener("load",init,{once:true});script.addEventListener("error",()=>setError("La carte n’est pas disponible pour le moment."),{once:true});document.body.appendChild(script)}
  return()=>{disposed=true;if(armTimer)window.clearTimeout(armTimer);try{mapRef.current?.remove()}catch{}mapRef.current=null};
 },[points,initialBounds]);
 function toggleInteraction(){const map=mapRef.current;if(!map)return;const next=!mapInteraction;setMapInteraction(next);if(next){map.dragging?.enable();map.doubleClickZoom?.enable();if(nodeRef.current)nodeRef.current.style.touchAction="none"}else{map.dragging?.disable();map.doubleClickZoom?.disable();if(nodeRef.current)nodeRef.current.style.touchAction="pan-y"}}
 function searchArea(){if(!movedBounds)return;const url=new URL(window.location.href);url.searchParams.set("view","map");url.searchParams.delete("page");if(url.pathname==="/vacances")url.searchParams.delete("city");url.searchParams.set("north",movedBounds.north.toFixed(5));url.searchParams.set("south",movedBounds.south.toFixed(5));url.searchParams.set("east",movedBounds.east.toFixed(5));url.searchParams.set("west",movedBounds.west.toFixed(5));window.location.assign(`${url.pathname}?${url.searchParams.toString()}`)}
 function clearArea(){const url=new URL(window.location.href);for(const key of ["north","south","east","west","page"])url.searchParams.delete(key);url.searchParams.set("view","map");window.location.assign(`${url.pathname}?${url.searchParams.toString()}`)}
 return <div className={styles.shell}>
  <div className={styles.topNote}><div><strong>{total} hébergement{total>1?"s":""}</strong><span>{points.length} position{points.length>1?"s":""} affichée{points.length>1?"s":""} sur cette page</span></div>{validBounds(initialBounds)&&<button type="button" onClick={clearArea}>Réinitialiser la zone</button>}</div>
  <div className={styles.mapStage}>{error?<div className={styles.error}>{error}</div>:<div ref={nodeRef} className={styles.map} aria-label="Carte des hébergements Vacances"/>}{!ready&&!error&&<div className={styles.loading}>Chargement de la carte…</div>}{coarse&&ready&&<button type="button" className={styles.gesture} onClick={toggleInteraction}>{mapInteraction?"Faire défiler la page":"Déplacer la carte"}</button>}{movedBounds&&<button type="button" className={styles.searchArea} onClick={searchArea}>Rechercher dans cette zone</button>}</div>
  {!points.length&&<p className={styles.noCoords}>Les annonces affichées n’ont pas encore de coordonnées cartographiques exploitables. La liste reste disponible.</p>}
 </div>
}
