export type StoreSector={slug:string;name:string;count:number};
export type PublicStore={
 id:string;slug:string;name:string;description:string|null;logoUrl:string|null;coverUrl:string|null;city:string|null;postalCode:string|null;updatedAt?:string;activeListings:number;verified:boolean;siretVerified:boolean;nafCode:string|null;primarySector:StoreSector|null;sectors:StoreSector[];
};

export const PRO_DEFAULT_LOGO="/store-defaults/default-boutique-logo.webp";
export const PRO_DEFAULT_COVER="/store-defaults/default-boutique-cover.webp";
export const SITE_BASE="https://petitannonces.fr";

export function professionalApiBase(){return(process.env.API_INTERNAL_URL??process.env.NEXT_PUBLIC_API_URL??"http://127.0.0.1:4000").replace(/\/$/,"")}
export function proSlug(value:string){return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")}
export function safeProJsonLd(value:unknown){return JSON.stringify(value).replace(/</g,"\\u003c")}

export async function getPublicStores(revalidate=120):Promise<PublicStore[]>{
 try{const r=await fetch(`${professionalApiBase()}/public/stores`,{next:{revalidate}});if(!r.ok)return[];const d=await r.json() as{stores?:PublicStore[]};return d.stores??[]}catch{return[]}
}

export function sectorNameFromStores(stores:PublicStore[],sector:string){return stores.flatMap(store=>store.sectors??[]).find(item=>item.slug===sector)?.name??null}
export function cityNameFromStores(stores:PublicStore[],city:string){return stores.find(store=>store.city&&proSlug(store.city)===city)?.city??null}

export function storeMatchesSector(store:PublicStore,sector:string){return(store.sectors??[]).some(item=>item.slug===sector)}
export function storeMatchesCity(store:PublicStore,city:string){return Boolean(store.city)&&proSlug(store.city!)===city}
