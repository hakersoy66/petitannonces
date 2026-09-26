"use client";
import { useEffect, useRef, useState } from "react";
import { AppIcon } from "./app-icon";
import { ListingCategoryPlaceholder } from "./listing-category-placeholder";

type Media={id:string;url:string;altText:string|null;isCover:boolean;width?:number|null;height?:number|null};
type Classes=Record<string,string>;
type Category={name?:string|null;slug?:string|null;domain?:string|null};

export function ListingGallery({media,title,classes,category}:{media:Media[];title:string;classes:Classes;category:Category}){
 const initial=Math.max(0,media.findIndex(item=>item.isCover));
 const[active,setActive]=useState(initial);
 const[lightboxOpen,setLightboxOpen]=useState(false);
 const touchStart=useRef<{x:number;y:number}|null>(null);

 useEffect(()=>{setActive(Math.max(0,media.findIndex(item=>item.isCover)))},[media]);
 useEffect(()=>{
  if(!lightboxOpen)return;
  const previous=()=>setActive(v=>(v-1+media.length)%media.length);
  const next=()=>setActive(v=>(v+1)%media.length);
  const onKey=(event:KeyboardEvent)=>{if(event.key==="Escape")setLightboxOpen(false);else if(event.key==="ArrowLeft")previous();else if(event.key==="ArrowRight")next()};
  const previousOverflow=document.body.style.overflow;document.body.style.overflow="hidden";
  window.addEventListener("keydown",onKey);
  return()=>{window.removeEventListener("keydown",onKey);document.body.style.overflow=previousOverflow};
 },[lightboxOpen,media.length]);

 if(!media.length)return <div className={classes.galleryEmpty}><ListingCategoryPlaceholder category={category} variant="hero"/></div>;
 const current=media[active]??media[0]!;
 const visible=media.slice(0,5);
 const previous=()=>setActive(v=>(v-1+media.length)%media.length);
 const next=()=>setActive(v=>(v+1)%media.length);
 const swipe=(endX:number,endY:number)=>{const start=touchStart.current;touchStart.current=null;if(!start||media.length<2)return;const dx=endX-start.x,dy=endY-start.y;if(Math.abs(dx)<45||Math.abs(dx)<Math.abs(dy)*1.2)return;if(dx<0)next();else previous()};
 const startTouch=(x:number,y:number)=>{touchStart.current={x,y}};

 return <div className={classes.galleryWrap}>
  <div className={classes.heroImage} onTouchStart={e=>{const t=e.touches[0];if(t)startTouch(t.clientX,t.clientY)}} onTouchEnd={e=>{const t=e.changedTouches[0];if(t)swipe(t.clientX,t.clientY)}}>
   <div className={classes.heroBackdrop} style={{backgroundImage:`url(${current.url})`}} aria-hidden="true"/>
   <div className={classes.heroShade} aria-hidden="true"/>
   <img className={classes.heroMainImage} src={current.url} alt={current.altText??`${title} — photo ${active+1}`} width={current.width??1200} height={current.height??900} loading={active===initial?"eager":"lazy"} fetchPriority={active===initial?"high":"auto"} onClick={()=>setLightboxOpen(true)}/>
   {media.length>1&&<><button type="button" className={`${classes.galleryArrow} ${classes.galleryPrev}`} onClick={previous} aria-label="Photo précédente"><AppIcon name="chevron-left"/></button><button type="button" className={`${classes.galleryArrow} ${classes.galleryNext}`} onClick={next} aria-label="Photo suivante"><AppIcon name="chevron-right"/></button></>}
   <span className={classes.photoBadge}><AppIcon name="camera"/> {active+1} / {media.length}</span>
  </div>
  <div className={classes.thumbs}>
   {visible.map((item,index)=><button type="button" key={item.id} className={`${classes.thumb} ${index===active?classes.thumbActive:""}`} onClick={()=>setActive(index)} aria-label={`Afficher la photo ${index+1}`}><img src={item.url} alt={item.altText??`${title} — miniature ${index+1}`} loading="lazy" decoding="async"/></button>)}
   {media.length>5&&<button type="button" className={`${classes.thumb} ${classes.moreThumb}`} onClick={()=>{setActive(5);setLightboxOpen(true)}}>+{media.length-5}</button>}
  </div>
  {lightboxOpen&&<div className={classes.lightbox} role="dialog" aria-modal="true" aria-label={`Galerie photo de ${title}`} onClick={()=>setLightboxOpen(false)}>
   <button type="button" className={classes.lightboxClose} onClick={e=>{e.stopPropagation();setLightboxOpen(false)}} aria-label="Fermer la galerie"><AppIcon name="xmark"/></button>
   <div className={classes.lightboxCounter}>{active+1} / {media.length}</div>
   <div className={classes.lightboxStage} onClick={e=>e.stopPropagation()} onTouchStart={e=>{const t=e.touches[0];if(t)startTouch(t.clientX,t.clientY)}} onTouchEnd={e=>{const t=e.changedTouches[0];if(t)swipe(t.clientX,t.clientY)}}>
    <img className={classes.lightboxImage} src={current.url} alt={current.altText??`${title} — photo ${active+1}`}/>
    {media.length>1&&<><button type="button" className={`${classes.lightboxArrow} ${classes.lightboxPrev}`} onClick={previous} aria-label="Photo précédente"><AppIcon name="chevron-left"/></button><button type="button" className={`${classes.lightboxArrow} ${classes.lightboxNext}`} onClick={next} aria-label="Photo suivante"><AppIcon name="chevron-right"/></button></>}
   </div>
   {media.length>1&&<div className={classes.lightboxThumbs} onClick={e=>e.stopPropagation()}>{media.map((item,index)=><button type="button" key={item.id} className={`${classes.lightboxThumb} ${index===active?classes.lightboxThumbActive:""}`} onClick={()=>setActive(index)} aria-label={`Afficher la photo ${index+1}`}><img src={item.url} alt="" loading="lazy"/></button>)}</div>}
  </div>}
 </div>;
}
