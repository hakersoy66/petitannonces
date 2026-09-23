"use client";

import type { MouseEvent, ReactNode } from "react";
import { trackSiteConversion } from "./site-telemetry";

type Props={href:string;className?:string;children:ReactNode;cta:string;landing:string;campaign?:string};

export function CampaignLink({href,className,children,cta,landing,campaign}:Props){
 function track(_event:MouseEvent<HTMLAnchorElement>){
  trackSiteConversion("LANDING_CTA_CLICKED","landing_cta_click",{cta_name:cta,landing_page:landing,campaign:campaign??"organic"});
 }
 return <a href={href} className={className} onClick={track}>{children}</a>;
}