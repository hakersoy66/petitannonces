"use client";
import {useState} from "react";
import {LiveVisitorsPanel} from "./live-visitors-panel";
import {UserAttentionPanel} from "./user-attention-panel";
export default function LazyDashboardDetails({attention,presence}:{attention:boolean;presence:boolean}){
 const [attentionOpen,setAttentionOpen]=useState(false),[presenceOpen,setPresenceOpen]=useState(false);
 return <>{attention&&<details className="admin-card admin-home-details" onToggle={e=>setAttentionOpen(e.currentTarget.open)}><summary>Suivi des utilisateurs · détails</summary>{attentionOpen&&<UserAttentionPanel initialData={null}/>}</details>}{presence&&<details className="admin-card admin-home-details" onToggle={e=>setPresenceOpen(e.currentTarget.open)}><summary>Visiteurs en direct · détails</summary>{presenceOpen&&<LiveVisitorsPanel initialData={null}/>}</details>}</>
}
