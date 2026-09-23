import { prisma } from "@pa/database";
import { deleteStoredObject } from "./storage.js";

const DEFAULT_RETENTION_HOURS=6;

export async function cleanupAbandonedListingDrafts(limit=100){
  const hours=Math.max(1,Number(process.env.ABANDONED_DRAFT_RETENTION_HOURS??DEFAULT_RETENTION_HOURS));
  const rows=await prisma.$queryRawUnsafe<Array<{id:string}>>(`
    SELECT l."id" FROM "Listing" l
    WHERE l."status"='DRAFT'
      AND l."draftSavedAt" IS NULL
      AND l."updatedAt" < CURRENT_TIMESTAMP - ($1::text || ' hours')::interval
      AND NOT EXISTS (SELECT 1 FROM "ModerationCase" mc WHERE mc."targetType"='LISTING' AND mc."targetId"=l."id")
      AND NOT EXISTS (SELECT 1 FROM "MarketplaceOrder" o WHERE o."listingId"=l."id")
    ORDER BY l."updatedAt" ASC LIMIT $2`,String(hours),limit);
  let deleted=0,objects=0;
  for(const row of rows){
    const media=await prisma.$queryRawUnsafe<Array<{objectKey:string}>>(`SELECT "objectKey" FROM "ListingMedia" WHERE "listingId"=$1`,row.id);
    const result=await prisma.listing.deleteMany({where:{id:row.id,status:"DRAFT",draftSavedAt:null}});
    if(!result.count)continue;
    deleted+=result.count;
    for(const item of media){try{await deleteStoredObject(item.objectKey);objects++}catch{}}
  }
  return{deleted,objects,retentionHours:hours};
}

export function startAbandonedDraftCleanupWorker(log?:{info:(value:unknown,message?:string)=>void;error:(value:unknown,message?:string)=>void}){
  const intervalMs=Math.max(Number(process.env.ABANDONED_DRAFT_CLEANUP_INTERVAL_MS??60*60*1000),15*60*1000);
  let running=false;
  const tick=async()=>{if(running)return;running=true;try{const result=await cleanupAbandonedListingDrafts();if(result.deleted)log?.info(result,"abandoned listing drafts cleaned")}catch(error){log?.error(error,"abandoned draft cleanup failed")}finally{running=false}};
  void tick();const timer=setInterval(()=>void tick(),intervalMs);timer.unref();return timer;
}
