"use client";

import { useEffect, useState } from "react";
import { AppIcon } from "./app-icon";
import { COMPARE_EVENT, COMPARE_LIMIT_EVENT, readCompareSelections, toggleCompareSelection, type CompareSelection } from "../lib/listing-compare";
import styles from "./compare-toggle-button.module.css";

export function CompareToggleButton({item,compact=false,className=""}:{item:CompareSelection;compact?:boolean;className?:string}){
 const[selected,setSelected]=useState(false);
 useEffect(()=>{
  const sync=()=>setSelected(readCompareSelections().some(entry=>entry.id===item.id));
  sync();window.addEventListener(COMPARE_EVENT,sync);return()=>window.removeEventListener(COMPARE_EVENT,sync);
 },[item.id]);
 function toggle(){
  const result=toggleCompareSelection(item);
  if(result.status==="limit"){window.dispatchEvent(new CustomEvent(COMPARE_LIMIT_EVENT));return}
  setSelected(result.status==="added");
 }
 return <button type="button" className={`${styles.button} ${selected?styles.active:""} ${compact?styles.compact:""} ${className}`} onClick={toggle} aria-pressed={selected} aria-label={selected?"Retirer de la comparaison":"Ajouter à la comparaison"} title={selected?"Retirer de la comparaison":"Comparer"}><AppIcon name={selected?"circle-check":"list"}/><span>{selected?"Ajouté":"Comparer"}</span></button>;
}