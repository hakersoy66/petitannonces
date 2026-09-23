import { prisma } from "@pa/database";

const HOST="petitannonces.fr";
const BASE=`https://${HOST}`;
export const INDEXNOW_KEY="1ae4a0b4154a2f97e89aa8c6eabefb5f";

function slugify(value:string){return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")}

export async function submitIndexNow(urls:string[]){
 const unique=[...new Set(urls.filter(url=>url.startsWith(`${BASE}/`)))].slice(0,10000);
 if(!unique.length)return {submitted:false,count:0,status:null as number|null};
 try{
  const response=await fetch("https://api.indexnow.org/indexnow",{method:"POST",headers:{"content-type":"application/json; charset=utf-8"},body:JSON.stringify({host:HOST,key:INDEXNOW_KEY,keyLocation:`${BASE}/${INDEXNOW_KEY}.txt`,urlList:unique}),signal:AbortSignal.timeout(6000)});
  return{submitted:response.ok||response.status===202,count:unique.length,status:response.status};
 }catch{return{submitted:false,count:unique.length,status:null as number|null}}
}

async function storeIndexUrls(storeId:string){
 const store=await prisma.store.findFirst({
  where:{id:storeId,status:"ACTIVE"},
  select:{
   slug:true,city:true,
   listings:{where:{status:"PUBLISHED"},select:{category:{select:{slug:true,name:true,parent:{select:{slug:true,name:true,parent:{select:{slug:true,name:true}}}}}}},take:100}
  }
 });
 if(!store)return[] as string[];
 const urls=[`${BASE}/boutique/${encodeURIComponent(store.slug)}`,`${BASE}/professionnels`,`${BASE}/sitemap.xml`];
 const city=store.city?slugify(store.city):"";
 if(city)urls.push(`${BASE}/professionnels/ville/${city}`);
 const sectors=new Set<string>();
 for(const listing of store.listings){
  const category=listing.category;
  const root=category.parent?.parent??category.parent??category;
  if(root.slug)sectors.add(root.slug);
 }
 for(const sector of sectors){
  urls.push(`${BASE}/professionnels/secteur/${encodeURIComponent(sector)}`);
  if(city)urls.push(`${BASE}/professionnels/${encodeURIComponent(sector)}/${city}`);
 }
 return urls;
}

export async function notifyStoreIndexNow(storeId:string){
 return submitIndexNow(await storeIndexUrls(storeId));
}

type ListingIndexRow={slug:string|null;city:string|null;categorySlugs:string[];vehicleMake:string|null;vehicleModel:string|null;transactionType:string|null;storeId:string|null};

async function listingIndexRow(listingId:string,includeNonPublished=false){
 const rows=await prisma.$queryRawUnsafe<ListingIndexRow[]>(
  `WITH RECURSIVE category_chain AS (
     SELECT c."id",c."slug",c."parentId"
     FROM "Listing" l JOIN "Category" c ON c."id"=l."categoryId"
     WHERE l."id"=$1
     UNION ALL
     SELECT p."id",p."slug",p."parentId"
     FROM "Category" p JOIN category_chain child ON child."parentId"=p."id"
   )
   SELECT l."slug",l."city",l."storeId",
          COALESCE((SELECT ARRAY_AGG(DISTINCT cc."slug") FROM category_chain cc WHERE cc."slug" IS NOT NULL),ARRAY[]::text[]) AS "categorySlugs",
          v."make" AS "vehicleMake",NULLIF(BTRIM(v."model"),'') AS "vehicleModel",p."transactionType"::text AS "transactionType"
   FROM "Listing" l
   LEFT JOIN "VehicleDetails" v ON v."listingId"=l."id"
   LEFT JOIN "PropertyDetails" p ON p."listingId"=l."id"
   WHERE l."id"=$1 ${includeNonPublished?"":"AND l.\"status\"='PUBLISHED'"} LIMIT 1`,listingId);
 return rows[0]??null;
}

export async function listingIndexUrls(listingId:string,includeNonPublished=false){
 const listing=await listingIndexRow(listingId,includeNonPublished);
 if(!listing?.slug)return[] as string[];
 const urls=[`${BASE}/annonce/${encodeURIComponent(listing.slug)}`,BASE+"/sitemap.xml"];
 const categorySlugs=[...new Set((listing.categorySlugs??[]).filter(Boolean))];
 for(const categorySlug of categorySlugs)urls.push(`${BASE}/categorie/${encodeURIComponent(categorySlug)}`);
 const city=listing.city?slugify(listing.city):"";
 if(city){
  urls.push(`${BASE}/ville/${city}`);
  for(const categorySlug of categorySlugs)urls.push(`${BASE}/c/${encodeURIComponent(categorySlug)}/${city}`);
 }
 const make=listing.vehicleMake?slugify(listing.vehicleMake):"";const model=listing.vehicleModel?slugify(listing.vehicleModel):"";
 if(make){urls.push(`${BASE}/vehicules/${make}`);if(model)urls.push(`${BASE}/vehicules/${make}/${model}`)}
 if(city&&listing.transactionType){const tx=listing.transactionType==="SALE"?"vente":listing.transactionType==="RENTAL"?"location":"";if(tx)urls.push(`${BASE}/immobilier/${tx}/${city}`)}
 if(listing.storeId)urls.push(...await storeIndexUrls(listing.storeId));
 return [...new Set(urls)];
}

export async function notifyListingIndexNow(listingId:string,includeNonPublished=false){
 return submitIndexNow(await listingIndexUrls(listingId,includeNonPublished));
}
