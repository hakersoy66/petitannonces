"use client";
import {useEffect,useState} from "react";
import {AdminIcon} from "../../components/admin-icon";
type Dashboard={kpis:{usersTotal:number;usersToday:number}};
const n=(v:number)=>Number(v??0).toLocaleString("fr-FR");
export function DashboardUserKpi({initialTotal,initialToday}:{initialTotal:number;initialToday:number}){
 const [v,setV]=useState({total:initialTotal,today:initialToday});
 useEffect(()=>{let active=true;const refresh=async()=>{try{const r=await fetch("/api/admin/dashboard",{credentials:"include",cache:"no-store"});if(r.ok){const d=await r.json() as Dashboard;if(active)setV({total:d.kpis?.usersTotal??0,today:d.kpis?.usersToday??0})}}catch{}};void refresh();const t=window.setInterval(()=>void refresh(),30000);return()=>{active=false;window.clearInterval(t)}},[]);
 return <article className="admin-card admin-kpi admin-home-kpi"><div className="admin-kpi-top"><small>Utilisateurs</small><span className="admin-kpi-icon"><AdminIcon name="users"/></span></div><strong>{n(v.total)}</strong><p>+{n(v.today)} aujourd’hui</p></article>;
}
