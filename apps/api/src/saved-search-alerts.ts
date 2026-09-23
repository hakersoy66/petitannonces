import { prisma } from "@pa/database";
import { deliverUserEvent } from "./notification-delivery.js";

type MapBounds={north:number;south:number;east:number;west:number};
type InstantSavedSearch={
  id:string;
  userId:string;
  name:string;
  query:string|null;
  categorySlug:string|null;
  city:string|null;
  postalCode:string|null;
  minPriceMinor:number|null;
  maxPriceMinor:number|null;
  filters:unknown;
};

function mapBounds(filters:unknown):MapBounds|null{
  if(!filters||typeof filters!=="object"||Array.isArray(filters))return null;
  const raw=(filters as Record<string,unknown>).mapBounds;
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return null;
  const value=raw as Record<string,unknown>;
  const north=Number(value.north),south=Number(value.south),east=Number(value.east),west=Number(value.west);
  if(![north,south,east,west].every(Number.isFinite)||south>=north||west>=east||north>90||south< -90||east>180||west< -180)return null;
  return{north,south,east,west};
}

function sameText(a:string|null|undefined,b:string|null|undefined){
  if(!b)return true;
  return (a??"").localeCompare(b,"fr",{sensitivity:"base"})===0;
}

function inBounds(latitude:number|null,longitude:number|null,bounds:MapBounds|null){
  if(!bounds)return true;
  if(latitude==null||longitude==null)return false;
  return latitude<=bounds.north&&latitude>=bounds.south&&longitude<=bounds.east&&longitude>=bounds.west;
}

export async function notifyInstantSavedSearchesForListing(listingId:string){
  const listing=await prisma.listing.findFirst({
    where:{id:listingId,status:"PUBLISHED"},
    select:{id:true,title:true,description:true,slug:true,sellerId:true,priceMinor:true,city:true,postalCode:true,latitude:true,longitude:true,category:{select:{slug:true}}},
  });
  if(!listing)return{matched:0};

  const searches=await prisma.$queryRawUnsafe<InstantSavedSearch[]>(`
    SELECT "id","userId","name","query","categorySlug","city","postalCode","minPriceMinor","maxPriceMinor","filters"
    FROM "SavedSearch"
    WHERE "alertEnabled"=TRUE AND "frequency"='INSTANT' AND "userId"<>$1
    ORDER BY "createdAt" ASC
    LIMIT 2000`,listing.sellerId);

  const haystack=`${listing.title??""}\n${listing.description??""}`.toLocaleLowerCase("fr");
  let matched=0;
  for(const search of searches){
    const query=(search.query??"").trim().toLocaleLowerCase("fr");
    if(query&&!haystack.includes(query))continue;
    if(search.categorySlug&&search.categorySlug!==listing.category.slug)continue;
    if(!sameText(listing.city,search.city))continue;
    if(search.postalCode&&listing.postalCode!==search.postalCode)continue;
    if(search.minPriceMinor!=null&&(listing.priceMinor==null||listing.priceMinor<search.minPriceMinor))continue;
    if(search.maxPriceMinor!=null&&(listing.priceMinor==null||listing.priceMinor>search.maxPriceMinor))continue;
    if(!inBounds(listing.latitude,listing.longitude,mapBounds(search.filters)))continue;

    await deliverUserEvent({
      userId:search.userId,
      eventKind:"LISTING",
      notificationKind:"SEARCH",
      title:`Nouvelle annonce pour « ${search.name} »`,
      body:`${listing.title??"Une nouvelle annonce"}${listing.city?` · ${listing.city}`:""}`,
      actionUrl:listing.slug?`/annonce/${encodeURIComponent(listing.slug)}`:"/mon-compte/recherches",
      metadata:{savedSearchId:search.id,listingId:listing.id,listingIds:[listing.id],matchCount:1,source:"SAVED_SEARCH_INSTANT"},
      dedupeKey:`saved-search:${search.id}:listing:${listing.id}`,
    });
    matched++;
  }
  return{matched};
}
