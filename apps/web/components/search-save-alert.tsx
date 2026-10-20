"use client";

import {useState} from "react";
import {AppIcon} from "./app-icon";

type Props={query:string;category:string;city:string;minPrice:string;maxPrice:string};
type Saved={query?:string|null;categorySlug?:string|null;city?:string|null;minPriceMinor?:number|null;maxPriceMinor?:number|null};
const api=()=> (process.env.NEXT_PUBLIC_API_URL??"/api").replace(/\/$/,"");
const minor=(v:string)=>{if(!v.trim())return null;const n=Number(v);return Number.isFinite(n)&&n>=0?Math.round(n*100):null};

export function SearchSaveAlert({query,category,city,minPrice,maxPrice}:Props){
 const[busy,setBusy]=useState(false);
 const[status,setStatus]=useState<"idle"|"saved"|"already"|"error">("idle");
 const hasCriteria=Boolean(query.trim()||category.trim()||city.trim()||minPrice.trim()||maxPrice.trim());
 if(!hasCriteria)return null;
 const body={
   name:["Alerte",query||category||city||"prix"].filter(Boolean).join(" · ").slice(0,120),
   query:query||null,categorySlug:category||null,city:city||null,postalCode:null,
   minPriceMinor:minor(minPrice),maxPriceMinor:minor(maxPrice),
   filters:{source:"SEARCH_RESULTS"},alertEnabled:true,frequency:"DAILY"
 };
 const same=(s:Saved)=> (s.query??"")===query&&(s.categorySlug??"")===category&&(s.city??"")===city&&
    (s.minPriceMinor??null)===body.minPriceMinor&&(s.maxPriceMinor??null)===body.maxPriceMinor;
 async function save(){
   if(busy||status==="saved"||status==="already")return;
   setBusy(true);setStatus("idle");
   try{
     const existing=await fetch(api()+"/account/saved-searches",{credentials:"include",cache:"no-store"});
     if(existing.status===401){
       const next=window.location.pathname+window.location.search;
       window.location.assign("/connexion?next="+encodeURIComponent(next));return;
     }
     if(!existing.ok)throw new Error("cannot_load_searches");
     const saved=(await existing.json()) as {searches?:Saved[]};
     if(saved.searches?.some(same)){setStatus("already");return}
     const res=await fetch(api()+"/account/saved-searches",{
       method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify(body)
     });
     if(res.status===401){
       const next=window.location.pathname+window.location.search;
       window.location.assign("/connexion?next="+encodeURIComponent(next));return;
     }
     if(!res.ok)throw new Error("save_failed");
     setStatus("saved");
   }catch{setStatus("error")}finally{setBusy(false)}
 }
 return <div style={{display:"flex",flexWrap:"wrap",justifyContent:"space-between",alignItems:"center",gap:12,padding:"12px 16px",margin:"0 0 14px",borderRadius:14,border:"1px solid #d9d3ff",background:"#f5f3ff"}}>
   <div style={{display:"grid",gap:3}}>
     <strong style={{color:"#342487",fontSize:14}}>Recevez les nouvelles annonces qui vous intéressent</strong>
     <span style={{fontSize:12,color:"#625c7c"}}>Alerte quotidienne sur les mots-clés, la catégorie, la ville et les prix sélectionnés. Désactivable à tout moment.</span>
   </div>
   <button type="button" onClick={()=>void save()} disabled={busy||status==="saved"||status==="already"}
     style={{display:"inline-flex",alignItems:"center",justifyContent:"center",gap:7,border:0,borderRadius:10,padding:"12px 16px",background:status==="saved"||status==="already"?"#047857":"#5b4cf0",color:"#fff",fontWeight:800,cursor:busy?"wait":"pointer"}}>
     <AppIcon name={status==="saved"||status==="already"?"check":"bell"}/>
     {busy?"Enregistrement…":status==="saved"?"Alerte activée":status==="already"?"Alerte déjà créée":"Créer mon alerte gratuite"}
   </button>
   {status==="error"&&<span role="status" style={{color:"#a11a1a",fontSize:12}}>Enregistrement impossible pour le moment. Réessayez.</span>}
 </div>;
}
