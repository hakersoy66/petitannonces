"use client";
import {useEffect} from "react";
import {trackSiteConversionOnce} from "./site-telemetry";

export function OAuthSignupTracker(){
 useEffect(()=>{
   const url=new URL(window.location.href);
   const provider=url.searchParams.get("oauth_signup");
   if(provider!=="google"&&provider!=="apple")return;
   trackSiteConversionOnce("SIGN_UP_COMPLETED","sign_up",`oauth:${provider}`,{method:provider.toUpperCase(),verification_required:false});
   url.searchParams.delete("oauth_signup");
   window.history.replaceState(null,"",`${url.pathname}${url.search}${url.hash}`);
 },[]);
 return null;
}
