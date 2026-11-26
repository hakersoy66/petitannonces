"use client";
import {useEffect,useState} from "react";
import {AdminIcon,type AdminIconName} from "./admin-icon";
type Item=[AdminIconName,string,string];
export default function DashboardShortcuts({items}:{items:Item[]}){
 const [chosen,setChosen]=useState<string[]|null>(null),[editing,setEditing]=useState(false);
 useEffect(()=>{try{const raw=JSON.parse(localStorage.getItem("pa-admin-shortcuts-v1")??"null");if(Array.isArray(raw))setChosen(raw.filter(x=>typeof x==="string"))}catch{}},[]);
 const visible=items.filter(i=>chosen===null||chosen.includes(i[2]));
 function toggle(href:string){const current=chosen??items.map(i=>i[2]);const next=current.includes(href)?current.filter(x=>x!==href):[...current,href];setChosen(next);try{localStorage.setItem("pa-admin-shortcuts-v1",JSON.stringify(next))}catch{}}
 function reset(){setChosen(null);try{localStorage.removeItem("pa-admin-shortcuts-v1")}catch{}}
 return <section className="admin-card admin-workspace-panel"><div className="admin-workspace-heading"><div><h2>Accès rapide</h2><span>Vos rubriques favorites</span></div><button className="admin-btn" aria-expanded={editing} onClick={()=>setEditing(v=>!v)}><AdminIcon name="settings"/>Personnaliser</button></div>{editing&&<div className="admin-shortcut-settings">{items.map(([icon,label,href])=><label key={href}><input type="checkbox" checked={chosen===null||chosen.includes(href)} onChange={()=>toggle(href)}/><AdminIcon name={icon}/>{label}</label>)}<button className="admin-btn" onClick={reset}>Réinitialiser</button></div>}<div className="admin-workspace-shortcuts">{visible.map(([icon,label,href])=><a href={href} key={href}><AdminIcon name={icon}/><span>{label}</span><b>›</b></a>)}</div>{!visible.length&&<p>Aucun favori sélectionné.</p>}</section>
}
