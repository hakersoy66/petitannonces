import type { LongtailData } from "./seo-longtail";

const seoApi=()=> (process.env.API_INTERNAL_URL??process.env.NEXT_PUBLIC_API_URL??"http://127.0.0.1:4000").replace(/\/$/,"");

export type ProductLongtailConfig={
  slug:string;
  title:string;
  metaTitle:string;
  description:string;
  eyebrow:string;
  queries:string[];
  backHref:string;
  backLabel:string;
  related:Array<{href:string;label:string}>;
  matches:(title:string)=>boolean;
};

export const PRODUCT_LONGTAILS:Record<string,ProductLongtailConfig>={
  ps5:{
    slug:"ps5",
    title:"PS5 d’occasion : petites annonces",
    metaTitle:"PS5 d’occasion : petites annonces en France | Petit Annonces",
    description:"Trouvez des PS5 d’occasion, consoles PlayStation 5, modèles Slim, Digital et accessoires associés selon les annonces disponibles en France.",
    eyebrow:"PlayStation 5",
    queries:["ps5","playstation 5"],
    backHref:"/categorie/high-tech",
    backLabel:"High-tech",
    related:[
      {href:"/categorie/jeux-video",label:"Jeux vidéo"},
      {href:"/categorie/consoles",label:"Consoles"},
      {href:"/categorie/jeux-video-consoles",label:"Jeux vidéo & consoles"},
    ],
    matches:(title)=>/(^|\W)ps5(\W|$)|playstation\s*5/i.test(title),
  },
  xbox:{
    slug:"xbox",
    title:"Xbox d’occasion : petites annonces",
    metaTitle:"Xbox d’occasion : consoles et jeux | Petit Annonces",
    description:"Trouvez des consoles Xbox, Xbox Series, Xbox One, manettes et accessoires selon les petites annonces actuellement disponibles en France.",
    eyebrow:"Xbox",
    queries:["xbox"],
    backHref:"/categorie/high-tech",
    backLabel:"High-tech",
    related:[
      {href:"/categorie/consoles",label:"Consoles"},
      {href:"/categorie/jeux-video",label:"Jeux vidéo"},
    ],
    matches:(title)=>/(^|\W)xbox(\W|$)/i.test(title),
  },
  "samsung-galaxy":{
    slug:"samsung-galaxy",
    title:"Samsung Galaxy : petites annonces",
    metaTitle:"Samsung Galaxy d’occasion : petites annonces | Petit Annonces",
    description:"Découvrez les petites annonces Samsung Galaxy en France : smartphones, montres, écouteurs et accessoires Galaxy selon les offres actuellement publiées.",
    eyebrow:"Samsung Galaxy",
    queries:["samsung galaxy"],
    backHref:"/categorie/high-tech",
    backLabel:"High-tech",
    related:[
      {href:"/categorie/samsung-galaxy",label:"Smartphones Samsung Galaxy"},
      {href:"/categorie/montres-bijoux",label:"Montres & bijoux"},
      {href:"/categorie/photo-video",label:"Photo, audio & vidéo"},
    ],
    matches:(title)=>/samsung[\s\S]{0,45}galaxy|galaxy[\s\S]{0,45}samsung/i.test(title),
  },
};

type SearchPayload={total?:number;items?:LongtailData["items"]};

export async function fetchProductLongtail(config:ProductLongtailConfig):Promise<LongtailData>{
  const responses=await Promise.all(config.queries.map(async query=>{
    try{
      const qs=new URLSearchParams({q:query,limit:"50",sort:"recent"});
      const r=await fetch(`${seoApi()}/search?${qs.toString()}`,{next:{revalidate:120}});
      if(!r.ok)return[] as LongtailData["items"];
      const payload=await r.json() as SearchPayload;
      return (payload.items??[]).filter(item=>config.matches(String(item.title??"")));
    }catch{return[] as LongtailData["items"]}
  }));
  const seen=new Set<string>();
  const items=responses.flat().filter(item=>{if(seen.has(item.id))return false;seen.add(item.id);return true});
  return{total:items.length,items};
}
