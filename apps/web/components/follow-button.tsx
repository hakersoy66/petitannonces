"use client";

import { useEffect, useState } from "react";
import { AppIcon } from "./app-icon";
import styles from "./follow-button.module.css";

const apiBase=()=> (process.env.NEXT_PUBLIC_API_URL??"/api").replace(/\/$/,"");
type TargetType="USER"|"STORE";
type StatusPayload={following:boolean;followerCount:number;ownTarget:boolean;target?:{type:TargetType;id:string;name:string}};

function safeReturnPath(){const path=`${window.location.pathname}${window.location.search}${window.location.hash}`;return path.startsWith("/")&&!path.startsWith("//")?path:"/"}

export function FollowButton({targetType,targetId,sourceListingId,label,followingLabel,fullWidth=false,className=""}:{targetType:TargetType;targetId:string;sourceListingId?:string;label?:string;followingLabel?:string;fullWidth?:boolean;className?:string}){
 const [following,setFollowing]=useState(false),[count,setCount]=useState<number|null>(null),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[authenticated,setAuthenticated]=useState(true),[ownTarget,setOwnTarget]=useState(false);
 useEffect(()=>{
  let active=true;
  const url=`${apiBase()}/account/follows/status?targetType=${encodeURIComponent(targetType)}&targetId=${encodeURIComponent(targetId)}`;
  void fetch(url,{credentials:"include",cache:"no-store"}).then(async r=>{
   if(!active)return;if(r.status===401||r.status===403){setAuthenticated(false);setReady(true);return}if(!r.ok){setReady(true);return}
   const p=await r.json() as StatusPayload;if(!active)return;setFollowing(Boolean(p.following));setCount(Number.isFinite(p.followerCount)?p.followerCount:0);setOwnTarget(Boolean(p.ownTarget));setReady(true);
  }).catch(()=>{if(active)setReady(true)});
  const sync=(event:Event)=>{const d=(event as CustomEvent<{targetType:TargetType;targetId:string;following:boolean;followerCount:number}>).detail;if(d?.targetType===targetType&&d?.targetId===targetId){setFollowing(d.following);setCount(d.followerCount)}};
  window.addEventListener("pa:follows-changed",sync);return()=>{active=false;window.removeEventListener("pa:follows-changed",sync)};
 },[targetType,targetId]);
 if(ownTarget)return null;
 async function toggle(){if(busy)return;if(!authenticated){window.location.href=`/connexion?next=${encodeURIComponent(safeReturnPath())}`;return}setBusy(true);try{
  const r=await fetch(`${apiBase()}/account/follows`,{method:following?"DELETE":"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({targetType,targetId,...(!following&&sourceListingId?{sourceListingId}:{})})});
  if(r.status===401||r.status===403){window.location.href=`/connexion?next=${encodeURIComponent(safeReturnPath())}`;return}
  if(!r.ok)return;
  const p=await r.json() as {following:boolean;followerCount:number};setFollowing(Boolean(p.following));setCount(Number(p.followerCount)||0);window.dispatchEvent(new CustomEvent("pa:follows-changed",{detail:{targetType,targetId,following:Boolean(p.following),followerCount:Number(p.followerCount)||0}}));
 }finally{setBusy(false)}}
 const normal=label??(targetType==="STORE"?"Suivre la boutique":"Suivre le vendeur");
 const activeLabel=followingLabel??(targetType==="STORE"?"Boutique suivie":"Vendeur suivi");
 return <button type="button" className={`${styles.button} ${fullWidth?styles.full:""} ${following?styles.active:""} ${className}`.trim()} onClick={()=>void toggle()} disabled={busy} aria-pressed={following} title={following?"Ne plus suivre":normal}><AppIcon name={following?"circle-check":"bell"}/><span>{ready?(following?activeLabel:normal):"Suivre"}</span>{ready&&count!==null&&count>0&&<b>{count}</b>}</button>;
}