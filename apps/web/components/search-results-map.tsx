"use client";

import {useEffect,useMemo,useRef,useState} from "react";
import styles from "./search-results-map.module.css";

const api=()=> (process.env.NEXT_PUBLIC_API_URL??"/api").replace(/\/$/,"");
type Item={id:string;slug:string|null;title:string|null;priceMinor:number|null;currency:string;city:string|null;imageUrl:string|null;latitude:number|null;longitude:number|null;category?:{name:string;slug:string}};
type Bounds={north:number;south:number;east:number;west:number};
type Props={items:Item[];total:number;initialBounds?:Bounds|null;embedded?:boolean};

function money(v:number,c="EUR"){return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c,maximumFractionDigits:v%100===0?0:2}).format(v/100)}
function validBounds(v:Bounds|null|undefined){return v&&Number.isFinite(v.north)&&Number.isFinite(v.south)&&Number.isFinite(v.east)&&Number.isFinite(v.west)&&v.south<v.north&&v.west<v.east?v:null}
function safe(v:string){return v.replace(/[<>&]/g,"")}

export function SearchResultsMap({items,total,initialBounds,embedded=false}:Props){
  const nodeRef=useRef<HTMLDivElement|null>(null);const mapRef=useRef<any>(null);const[ready,setReady]=useState(false);const[error,setError]=useState("");const[coarse,setCoarse]=useState(false);const[mapInteraction,setMapInteraction]=useState(false);const[movedBounds,setMovedBounds]=useState<Bounds|null>(null);const[saving,setSaving]=useState(false);const[saved,setSaved]=useState(false);const[saveError,setSaveError]=useState("");
  const points=useMemo(()=>items.filter(item=>Number.isFinite(item.latitude)&&Number.isFinite(item.longitude)) as Array<Item&{latitude:number;longitude:number}>,[items]);
  useEffect(()=>{setCoarse(window.matchMedia?.("(pointer: coarse)").matches??false)},[]);
  useEffect(()=>{
    let disposed=false;let armTimer:number|undefined;
    const init=()=>{
      if(disposed||!nodeRef.current||mapRef.current)return;const L=(window as any).L;if(!L){setError("La carte n’est pas disponible pour le moment.");return}
      const isCoarse=window.matchMedia?.("(pointer: coarse)").matches??false;const node=nodeRef.current;node.style.touchAction=embedded?"none":isCoarse?"pan-y":"auto";
      const map=L.map(node,{zoomControl:true,scrollWheelZoom:false,dragging:embedded||!isCoarse,touchZoom:true,doubleClickZoom:embedded||!isCoarse,attributionControl:true});mapRef.current=map;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>'}).addTo(map);
      const supplied=validBounds(initialBounds);if(supplied)map.fitBounds([[supplied.south,supplied.west],[supplied.north,supplied.east]],{padding:[18,18],maxZoom:15});else if(points.length>1)map.fitBounds(points.map(p=>[p.latitude,p.longitude]),{padding:[45,45],maxZoom:13});else if(points.length===1)map.setView([points[0]!.latitude,points[0]!.longitude],13);else map.setView([46.603354,1.888334],6);
      const markerLayer=L.layerGroup().addTo(map);
      const addListingMarker=(item:Item&{latitude:number;longitude:number})=>{
        const label=item.priceMinor!=null?money(item.priceMinor,item.currency):"Voir";const icon=L.divIcon({className:"pa-search-price-pin",html:`<span>${safe(label)}</span>`,iconSize:[88,34],iconAnchor:[44,17]});
        const marker=L.marker([item.latitude,item.longitude],{icon}).addTo(markerLayer);const popup=document.createElement("div");popup.className="pa-search-map-popup";
        if(item.imageUrl){const image=document.createElement("img");image.src=item.imageUrl;image.alt="";image.loading="lazy";popup.appendChild(image)}
        const body=document.createElement("div");const category=document.createElement("small");category.textContent=item.category?.name??"Petit Annonces";body.appendChild(category);const title=document.createElement("strong");title.textContent=item.title??item.category?.name??"Annonce";body.appendChild(title);const location=document.createElement("span");location.textContent=item.city??"France";body.appendChild(location);const price=document.createElement("b");price.textContent=item.priceMinor!=null?money(item.priceMinor,item.currency):"Prix sur demande";body.appendChild(price);const link=document.createElement("a");link.href=item.slug?`/annonce/${item.slug}`:"/recherche";link.textContent="Voir l’annonce →";body.appendChild(link);popup.appendChild(body);marker.bindPopup(popup,{maxWidth:285,minWidth:225});
      };
      const renderMarkers=()=>{
        markerLayer.clearLayers();const zoom=map.getZoom();
        if(zoom>=17){for(const item of points)addListingMarker(item);return}
        const cellSize=zoom>=15?54:zoom>=13?68:zoom>=11?82:96;const buckets=new Map<string,Array<Item&{latitude:number;longitude:number}>>();
        for(const item of points){const projected=map.project([item.latitude,item.longitude],zoom);const key=`${Math.floor(projected.x/cellSize)}:${Math.floor(projected.y/cellSize)}`;const bucket=buckets.get(key)??[];bucket.push(item);buckets.set(key,bucket)}
        for(const bucket of buckets.values()){
          if(bucket.length===1){addListingMarker(bucket[0]!);continue}
          const latitude=bucket.reduce((sum,item)=>sum+item.latitude,0)/bucket.length;const longitude=bucket.reduce((sum,item)=>sum+item.longitude,0)/bucket.length;
          const icon=L.divIcon({className:"pa-search-cluster",html:`<span><b>${bucket.length}</b><small>annonces</small></span>`,iconSize:[58,58],iconAnchor:[29,29]});
          const marker=L.marker([latitude,longitude],{icon}).addTo(markerLayer);marker.on("click",()=>{const bounds=bucket.map(item=>[item.latitude,item.longitude]);if(map.getZoom()<16)map.fitBounds(bounds,{padding:[55,55],maxZoom:Math.min(17,map.getZoom()+3)});else map.setView([latitude,longitude],17)});
        }
      };
      renderMarkers();map.on("zoomend",renderMarkers);
      let armed=false;armTimer=window.setTimeout(()=>{armed=true},500);map.on("moveend",()=>{if(!armed)return;const b=map.getBounds();setMovedBounds({north:b.getNorth(),south:b.getSouth(),east:b.getEast(),west:b.getWest()})});setReady(true);
    };
    let script=document.getElementById("pa-leaflet-js") as HTMLScriptElement|null;if(!document.getElementById("pa-leaflet-css")){const link=document.createElement("link");link.id="pa-leaflet-css";link.rel="stylesheet";link.href="/vendor/leaflet/leaflet.css";document.head.appendChild(link)}
    if((window as any).L)init();else if(script){script.addEventListener("load",init,{once:true})}else{script=document.createElement("script");script.id="pa-leaflet-js";script.src="/vendor/leaflet/leaflet.js";script.async=true;script.addEventListener("load",init,{once:true});script.addEventListener("error",()=>setError("La carte n’est pas disponible pour le moment."),{once:true});document.body.appendChild(script)}
    return()=>{disposed=true;if(armTimer)window.clearTimeout(armTimer);try{mapRef.current?.remove()}catch{}mapRef.current=null};
  },[points,initialBounds,embedded]);
  function toggleInteraction(){const map=mapRef.current;if(!map)return;const next=!mapInteraction;setMapInteraction(next);if(next){map.dragging?.enable();map.doubleClickZoom?.enable();if(nodeRef.current)nodeRef.current.style.touchAction="none"}else{map.dragging?.disable();map.doubleClickZoom?.disable();if(nodeRef.current)nodeRef.current.style.touchAction="pan-y"}}
  function searchArea(){if(!movedBounds)return;const url=new URL(window.location.href);url.searchParams.set("view","map");for(const key of ["page","city","radiusKm","near","lat","lng"])url.searchParams.delete(key);url.searchParams.set("north",movedBounds.north.toFixed(5));url.searchParams.set("south",movedBounds.south.toFixed(5));url.searchParams.set("east",movedBounds.east.toFixed(5));url.searchParams.set("west",movedBounds.west.toFixed(5));window.location.assign(`${url.pathname}?${url.searchParams.toString()}`)}
  function clearArea(){const url=new URL(window.location.href);for(const key of ["north","south","east","west","page"])url.searchParams.delete(key);url.searchParams.set("view","map");window.location.assign(`${url.pathname}?${url.searchParams.toString()}`)}
  async function saveArea(){
    const bounds=movedBounds??validBounds(initialBounds);if(!bounds){setSaveError("Déplacez la carte ou recherchez d’abord dans une zone.");return}
    setSaving(true);setSaved(false);setSaveError("");
    try{
      const url=new URL(window.location.href);const q=url.searchParams.get("q")||null,category=url.searchParams.get("category")||null,city=url.searchParams.get("city")||null;
      const priceMinor=(key:string)=>{const raw=url.searchParams.get(key);if(!raw)return null;const value=Number(raw);return Number.isFinite(value)&&value>=0?Math.round(value*100):null};
      const rounded={north:Number(bounds.north.toFixed(5)),south:Number(bounds.south.toFixed(5)),east:Number(bounds.east.toFixed(5)),west:Number(bounds.west.toFixed(5))};
      const areaKey=["map",rounded.north,rounded.south,rounded.east,rounded.west,category??"",q??"",url.searchParams.get("minPrice")??"",url.searchParams.get("maxPrice")??""].join(":");
      const label=city||category||q||"France";const body={name:`Zone carte · ${label}`.slice(0,120),query:q,categorySlug:category,city:null,postalCode:null,minPriceMinor:priceMinor("minPrice"),maxPriceMinor:priceMinor("maxPrice"),filters:{source:"MAP_AREA",areaKey,mapBounds:rounded},alertEnabled:true,frequency:"INSTANT"};
      const response=await fetch(`${api()}/account/saved-searches`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      if(response.status===401){const next=`${window.location.pathname}${window.location.search}`;window.location.assign(`/connexion?next=${encodeURIComponent(next)}`);return}
      if(response.status===409){setSaved(true);setSaveError("Cette zone est déjà enregistrée dans vos recherches.");return}
      if(!response.ok)throw new Error("save_failed");setSaved(true);
    }catch{setSaveError("Impossible d’enregistrer cette zone pour le moment.")}finally{setSaving(false)}
  }
  const saveBounds=movedBounds??validBounds(initialBounds);
  return <div className={`${styles.shell} ${embedded?styles.embedded:""}`}>
    {!embedded&&<div className={styles.topNote}><div><strong>{total.toLocaleString("fr-FR")} annonce{total>1?"s":""} cartographiée{total>1?"s":""}</strong><span>{points.length} position{points.length>1?"s":""} chargée{points.length>1?"s":""} sur cette vue</span>{saveError&&<small className={saved?styles.savedState:styles.saveError}>{saveError}</small>}{saved&&!saveError&&<small className={styles.savedState}>Zone enregistrée · alerte instantanée activée</small>}</div><div className={styles.topActions}>{saveBounds&&<button type="button" className={styles.saveZone} disabled={saving} onClick={()=>void saveArea()}>{saving?"Enregistrement…":saved?"Zone enregistrée":"Enregistrer cette zone"}</button>}{validBounds(initialBounds)&&<button type="button" onClick={clearArea}>Réinitialiser la zone</button>}</div></div>}
    <div className={styles.mapStage}>{error?<div className={styles.error}>{error}</div>:<div ref={nodeRef} className={styles.map} aria-label="Carte des annonces Petit Annonces"/>}{!ready&&!error&&<div className={styles.loading}>Chargement de la carte…</div>}{coarse&&ready&&!embedded&&<button type="button" className={styles.gesture} onClick={toggleInteraction}>{mapInteraction?"Faire défiler la page":"Déplacer la carte"}</button>}{movedBounds&&<button type="button" className={styles.searchArea} onClick={searchArea}>Rechercher dans cette zone</button>}</div>
    {!points.length&&<p className={styles.noCoords}>Aucune annonce géolocalisée ne correspond encore à ces critères. Essayez une autre ville ou élargissez la zone.</p>}
  </div>
}
