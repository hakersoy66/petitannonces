"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

const api=()=> (process.env.NEXT_PUBLIC_API_URL??"/api").replace(/\/$/,"");

export function SecurityHoldGuard(){
  const pathname=usePathname();
  useEffect(()=>{
    if(pathname.startsWith("/compte-suspendu")||pathname.startsWith("/connexion")||pathname.startsWith("/inscription")||pathname.startsWith("/mot-de-passe-oublie")||pathname.startsWith("/reinitialiser-mot-de-passe")||pathname.startsWith("/verifier-email")||pathname.startsWith("/verifiez-votre-email"))return;
    let cancelled=false;
    void fetch(`${api()}/security/access-state`,{credentials:"include",cache:"no-store"})
      .then(async response=>response.ok?response.json():null)
      .then(payload=>{if(!cancelled&&payload?.blocked)window.location.replace("/compte-suspendu")})
      .catch(()=>undefined);
    return()=>{cancelled=true};
  },[pathname]);
  return null;
}
