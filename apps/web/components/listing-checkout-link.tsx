"use client";
import type {ReactNode} from "react";
import {trackSiteConversion} from "./site-telemetry";
export function ListingCheckoutLink({href,className,children}:{href:string;className?:string;children:ReactNode}){
 return <a href={href} className={className} onClick={()=>trackSiteConversion("LISTING_BUY_CLICKED","listing_buy_click")}>{children}</a>;
}
