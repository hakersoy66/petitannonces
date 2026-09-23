import type { Metadata } from "next";
import { MaintenanceScreen } from "../../components/maintenance-screen";

export const metadata:Metadata={title:"Aperçu maintenance",robots:{index:false,follow:false}};

async function previewSite(){
 const fallback={siteName:"Petit Annonces",logoUrl:null as string|null,accentColor:"#5b4cf0"};
 const internal=process.env.API_INTERNAL_URL?.replace(/\/$/,"");
 const urls=[internal?`${internal}/public/site-config`:null,"https://petitannonces.fr/api/public/site-config"].filter((value):value is string=>Boolean(value));
 for(const url of urls){
  try{const r=await fetch(url,{cache:"no-store",signal:AbortSignal.timeout(1500)});if(!r.ok)continue;const p=await r.json() as{site?:Partial<typeof fallback>};if(p.site)return{...fallback,...p.site}}catch{}
 }
 return fallback;
}

export default async function MaintenancePreviewPage(){
 const site=await previewSite();
 return <MaintenanceScreen site={site} preview/>;
}