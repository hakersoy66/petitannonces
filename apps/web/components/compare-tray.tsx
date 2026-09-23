"use client";

import { useEffect, useState } from "react";
import { AppIcon } from "./app-icon";
import { clearCompareSelections, compareHref, COMPARE_EVENT, COMPARE_LIMIT_EVENT, readCompareSelections, removeCompareSelection, type CompareSelection } from "../lib/listing-compare";
import styles from "./compare-tray.module.css";

export function CompareTray(){
 const[items,setItems]=useState<CompareSelection[]>([]),[notice,setNotice]=useState("");
 useEffect(()=>{
  const sync=()=>setItems(readCompareSelections());
  const limit=()=>{setNotice("Vous pouvez comparer jusqu’à 4 annonces.");window.setTimeout(()=>setNotice(""),2600)};
  sync();window.addEventListener(COMPARE_EVENT,sync);window.addEventListener(COMPARE_LIMIT_EVENT,limit);
  return()=>{window.removeEventListener(COMPARE_EVENT,sync);window.removeEventListener(COMPARE_LIMIT_EVENT,limit)};
 },[]);
 if(!items.length)return null;
 return <aside className={styles.tray} aria-label="Comparateur d’annonces">
  <div className={styles.intro}><span><AppIcon name="list"/></span><div><strong>Comparateur</strong><small>{items.length}/4 annonce{items.length>1?"s":""}</small></div></div>
  <div className={styles.items}>{items.map(item=><div className={styles.item} key={item.id}>{item.imageUrl?<img src={item.imageUrl} alt=""/>:<span><AppIcon name="image"/></span>}<div><strong>{item.title??item.category.name}</strong><small>{item.city??"France"}</small></div><button type="button" onClick={()=>setItems(removeCompareSelection(item.id))} aria-label={`Retirer ${item.title??"cette annonce"}`}>×</button></div>)}</div>
  <div className={styles.actions}>{notice&&<small className={styles.notice}>{notice}</small>}<button type="button" className={styles.clear} onClick={()=>{clearCompareSelections();setItems([])}}>Vider</button>{items.length>=2?<a href={compareHref(items)}>Comparer {items.length} annonces <AppIcon name="arrow-right"/></a>:<span className={styles.disabled}>Ajoutez encore 1 annonce</span>}</div>
 </aside>;
}