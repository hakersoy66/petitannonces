"use client";
import { useEffect, useRef, useState } from "react";
import { AppIcon } from "./app-icon";
import { ListingCategoryPlaceholder } from "./listing-category-placeholder";

type Media={id:string;url:string;altText:string|null;isCover:boolean;width?:number|null;height?:number|null};
type Classes=Record<string,string>;
type Category={name?:string|null;slug?:string|null;domain?:string|null};
export function ListingGallery({media,title,classes,category}:{media:Media[];title:string;classes:Classes;category:Category}){
 const initial=Math.max(0,media.findIndex(item=>item.isCover));const[active,setActive]=useState(initial);const touchStart=useRef<{x:number;y:number}|null>(null);
 useEffect(()=>{setActive(Math.max(0,media.findIndex(item=>item.isCover)))},[media]);
 if(!media.length)return <div className={classes.galleryEmpty}><ListingCategoryPlaceholder category={category} variant="hero"/></div>;
 const current=media[active]??media[0]!;const visible=media.slice(0,5);
 const previous=()=>setActive(v=>(v-1+media.length)%media.length);const next=()=>setActive(v=>(v+1)%media.length);
 return <div className={classes.galleryWrap}><div className={classes.heroImage} onTouchStart={e=>{const t=e.touches[0];if(t)touchStart.current={x:t.clientX,y:t.clientY}}} onTouchEnd={e=>{const start=touchStart.current;touchStart.current=null;const t=e.changedTouches[0];if(!start||!t||media.length<2)return;const dx=t.clientX-start.x,dy=t.clientY-start.y;if(Math.abs(dx)<45||Math.abs(dx)<Math.abs(dy)*1.2)return;if(dx<0)next();else previous()}}>
  <div className={classes.heroBackdrop} style={{backgroundImage:`url(${current.url})`}} aria-hidden="true"/>
  <div className={classes.heroShade} aria-hidden="true"/>
  <img className={classes.heroMainImage} src={current.url} alt={current.altText??`${title} — photo ${active+1}`} width={current.width??1200} height={current.height??900} loading={active===initial?"eager":"lazy"} fetchPriority={active===initial?"high":"auto"}/>
  <div className={classes.watermark} aria-hidden="true"><span>PA</span><strong>petitannonces.fr</strong></div>
  {media.length>1&&<><button type="button" className={`${classes.galleryArrow} ${classes.galleryPrev}`} onClick={previous} aria-label="Photo précédente"><AppIcon name="chevron-left"/></button><button type="button" className={`${classes.galleryArrow} ${classes.galleryNext}`} onClick={next} aria-label="Photo suivante"><AppIcon name="chevron-right"/></button></>}
  <span className={classes.photoBadge}><AppIcon name="camera"/> {active+1} / {media.length}</span>
 </div><div className={classes.thumbs}>{visible.map((item,index)=><button type="button" key={item.id} className={`${classes.thumb} ${index===active?classes.thumbActive:""}`} onClick={()=>setActive(index)} aria-label={`Afficher la photo ${index+1}`}><img src={item.url} alt={item.altText??`${title} — miniature ${index+1}`} loading="lazy" decoding="async"/></button>)}{media.length>5&&<button type="button" className={`${classes.thumb} ${classes.moreThumb}`} onClick={()=>setActive(5)}>+{media.length-5}</button>}</div></div>;
}
