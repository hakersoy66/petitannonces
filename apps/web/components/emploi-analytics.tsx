"use client";

import { analyticsAllowed, trackSiteConversion } from "./site-telemetry";
import type { ReactNode, FormEvent } from "react";

type Kind="application"|"event"|"labonneboite"|"market"|"career"|"official_jobs";
type Props={href:string;kind:Kind;label:string;className?:string;children:ReactNode;external?:boolean};
export function EmploiTrackedLink({href,kind,label,className,children,external}:Props){
 function onClick(){
  if(!analyticsAllowed())return;
  if(kind==="application")trackSiteConversion("JOB_APPLY_CLICKED","job_apply_click",{platform:"france_travail",job_id:label.slice(0,20)});
  else trackSiteConversion("JOB_RESOURCE_CLICKED","job_resource_click",{resource:kind,reference:label.slice(0,50)});
 }
 return <a href={href} className={className} onClick={onClick} target={external?"_blank":undefined} rel={external?"noopener noreferrer":undefined}>{children}</a>;
}
export function EmploiSearchTrack({children}:{children:ReactNode}){
 function onSubmit(_event:FormEvent<HTMLFormElement>){
  if(!analyticsAllowed())return;
  const form=_event.currentTarget;
  const q=(form.elements.namedItem("ft_q") as HTMLInputElement|null)?.value??"";
  const dept=(form.elements.namedItem("ft_dept") as HTMLInputElement|null)?.value??"";
  const contract=(form.elements.namedItem("ft_contract") as HTMLSelectElement|null)?.value??"";
  trackSiteConversion("JOB_SEARCHED","job_search",{has_keyword:q.trim().length>=2,department:dept.trim().toUpperCase().slice(0,3),contract_type:contract});
 }
 return <form action="/categorie/emploi" method="GET" onSubmit={onSubmit}>{children}</form>;
}
