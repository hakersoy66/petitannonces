export const dynamic="force-dynamic";
export const revalidate=900;
import type { MetadataRoute } from "next";
import { deepCatalog } from "@pa/types";
import { PRODUCT_LONGTAILS, fetchProductLongtail } from "../lib/seo-product-longtail";

const BASE="https://petitannonces.fr";
const apiBase=()=> (process.env.API_INTERNAL_URL??process.env.NEXT_PUBLIC_API_URL??"http://127.0.0.1:4000").replace(/\/$/,"");
function flatten(nodes:any[]):any[]{return nodes.flatMap(n=>[n,...flatten(n.children??[])]);}
function citySlug(city:string){return city.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");}
const slugify=citySlug;
export default async function sitemap():Promise<MetadataRoute.Sitemap>{
  const now=new Date();
  const staticPages=[
    ["/",1,"daily"],["/blog",0.7,"weekly"],["/vendre-voiture",0.82,"weekly"],["/deposer-annonce-gratuite",0.82,"weekly"],["/ouvrir-boutique-pro",0.78,"weekly"],["/pro/automobile",0.76,"weekly"],["/pro/immobilier",0.76,"weekly"],["/pro/high-tech",0.76,"weekly"],["/pro/occasion",0.76,"weekly"],["/vacances",0.85,"daily"],["/professionnels",0.7,"weekly"],["/observatoire",0.74,"daily"],["/blog/vendre-objet-occasion",0.68,"monthly"],["/blog/vendre-entre-particuliers",0.68,"monthly"],["/blog/rediger-annonce-efficace",0.68,"monthly"],["/blog/acheter-occasion-securite",0.68,"monthly"],["/blog/rediger-annonce-immobiliere",0.68,"monthly"],["/blog/acheter-smartphone-occasion",0.68,"monthly"],["/presse",0.56,"monthly"],["/presse/petit-annonces-marketplace-francaise",0.62,"monthly"],["/qui-sommes-nous",0.58,"monthly"],["/conditions-generales",0.3,"monthly"],
    ["/confidentialite",0.3,"monthly"],["/mentions-legales",0.2,"monthly"],["/assistance",0.3,"monthly"]
  ] as const;
  const rows:MetadataRoute.Sitemap=staticPages.map(([path,priority,changeFrequency])=>({url:BASE+path,...(path==="/"?{lastModified:now}:{}),priority,changeFrequency}));
  try{
    const r=await fetch(`${apiBase()}/seo/sitemap-data`,{cache:"no-store"});
    if(r.ok){
      const d=await r.json() as {listings:Array<{slug:string|null;updatedAt:string;images?:string[]}>;stores:Array<{slug:string;updatedAt:string}>;localPairs:Array<{categorySlug:string;city:string;updatedAt:string}>;vehicleFacets:Array<{make:string;model:string|null;count:number;updatedAt:string}>;propertyFacets:Array<{transactionType:string;city:string;count:number;updatedAt:string}>;vacationFacets:Array<{city:string;slug:string;count:number;updatedAt:string}>;cityFacets:Array<{city:string;slug?:string;count:number;updatedAt:string}>;categoryFacets:Array<{slug:string;count:number;updatedAt:string}>};
      for(const x of d.listings) if(x.slug){const images=(x.images??[]).filter(url=>/^https?:\/\//i.test(url)).slice(0,8);rows.push({url:`${BASE}/annonce/${x.slug}`,lastModified:new Date(x.updatedAt),changeFrequency:"weekly",priority:0.9,...(images.length?{images}:{})});}
      for(const x of d.stores) rows.push({url:`${BASE}/boutique/${x.slug}`,lastModified:new Date(x.updatedAt),changeFrequency:"weekly",priority:0.7});
      for(const x of d.categoryFacets??[]) if(x.count>0&&x.slug!=="vacances") rows.push({url:`${BASE}/categorie/${x.slug}`,lastModified:new Date(x.updatedAt),changeFrequency:"daily",priority:0.78});
      for(const x of d.vacationFacets??[]) if(x.count>=3&&x.slug) rows.push({url:`${BASE}/vacances/${x.slug}`,lastModified:new Date(x.updatedAt),changeFrequency:"daily",priority:0.76});
      for(const x of d.localPairs){const city=citySlug(x.city);if(city)rows.push({url:`${BASE}/c/${x.categorySlug}/${city}`,lastModified:new Date(x.updatedAt),changeFrequency:"daily",priority:0.65});}
      for(const x of d.cityFacets??[]){const city=x.slug??citySlug(x.city);if(city&&x.count>=3)rows.push({url:`${BASE}/ville/${city}`,lastModified:new Date(x.updatedAt),changeFrequency:"daily",priority:0.74});}
      const vehicleMakeTotals=new Map<string,{make:string;count:number;updatedAt:string}>();
      for(const x of d.vehicleFacets??[]){const key=slugify(x.make);if(!key)continue;const current=vehicleMakeTotals.get(key);if(!current){vehicleMakeTotals.set(key,{make:x.make,count:x.count,updatedAt:x.updatedAt})}else{current.count+=x.count;if(new Date(x.updatedAt)>new Date(current.updatedAt))current.updatedAt=x.updatedAt}}
      for(const [makeSlug,info] of vehicleMakeTotals)if(info.count>=3)rows.push({url:`${BASE}/vehicules/${makeSlug}`,lastModified:new Date(info.updatedAt),changeFrequency:"daily",priority:0.72});
      for(const x of d.vehicleFacets??[]){const make=slugify(x.make),model=x.model?slugify(x.model):"";if(make&&model&&x.count>=3)rows.push({url:`${BASE}/vehicules/${make}/${model}`,lastModified:new Date(x.updatedAt),changeFrequency:"daily",priority:0.7});}
      for(const x of d.propertyFacets??[]){const city=slugify(x.city),tx=x.transactionType==="SALE"?"vente":"location";if(city&&x.count>=3)rows.push({url:`${BASE}/immobilier/${tx}/${city}`,lastModified:new Date(x.updatedAt),changeFrequency:"daily",priority:0.72});}
    }
  }catch{}
  try{
    for(const config of Object.values(PRODUCT_LONGTAILS)){
      const data=await fetchProductLongtail(config);
      if(data.total>=3)rows.push({url:`${BASE}/occasion/${config.slug}`,lastModified:now,changeFrequency:"daily",priority:0.7});
    }
  }catch{}
  try{
    const r=await fetch(`${apiBase()}/public/stores`,{next:{revalidate:900}});
    if(r.ok){
      const d=await r.json() as {stores?:Array<{city:string|null;updatedAt?:string;sectors?:Array<{slug:string;name:string;count:number}>}>};
      const seenLocal=new Set<string>(),seenCities=new Set<string>(),seenSectors=new Set<string>();
      for(const store of d.stores??[]){
        const city=store.city?citySlug(store.city):"";
        if(city&&!seenCities.has(city)){seenCities.add(city);rows.push({url:`${BASE}/professionnels/ville/${city}`,...(store.updatedAt?{lastModified:new Date(store.updatedAt)}:{}),changeFrequency:"weekly",priority:0.7})}
        for(const sector of store.sectors??[]){
          if(!sector.slug)continue;
          if(!seenSectors.has(sector.slug)){seenSectors.add(sector.slug);rows.push({url:`${BASE}/professionnels/secteur/${sector.slug}`,...(store.updatedAt?{lastModified:new Date(store.updatedAt)}:{}),changeFrequency:"weekly",priority:0.7})}
          if(!city)continue;
          const path=`/professionnels/${sector.slug}/${city}`;
          if(seenLocal.has(path))continue;
          seenLocal.add(path);
          rows.push({url:BASE+path,...(store.updatedAt?{lastModified:new Date(store.updatedAt)}:{}),changeFrequency:"weekly",priority:0.68});
        }
      }
    }
  }catch{}
  return rows;
}
