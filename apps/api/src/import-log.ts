import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@pa/database";

const TRACKING_PARAMS=new Set(["fbclid","gclid","msclkid","mc_cid","mc_eid","ref","referrer","referral_code","tracking_id"]);

export function canonicalImportSourceUrl(raw?:string|null){
 const value=raw?.trim();if(!value)return null;
 try{
  const u=new URL(value);u.hash="";u.hostname=u.hostname.toLowerCase();
  const host=u.hostname.replace(/^www\./,"");
  const isLeboncoin=host==="leboncoin.fr"||host.endsWith(".leboncoin.fr");const isVinted=host==="vinted.fr"||host.endsWith(".vinted.fr");const isFacebook=host==="facebook.com"||host.endsWith(".facebook.com")||host==="fb.com"||host.endsWith(".fb.com");
  if(isLeboncoin){u.protocol="https:";u.hostname="www.leboncoin.fr";u.search="";}
  else if(isVinted){const item=u.pathname.match(/\/items\/(\d{5,20})/i);u.protocol="https:";u.hostname="www.vinted.fr";if(item)u.pathname=`/items/${item[1]}`;u.search="";}
  else if(isFacebook){const item=u.pathname.match(/\/marketplace\/item\/([0-9]+)/i);u.protocol="https:";u.hostname="www.facebook.com";if(item)u.pathname=`/marketplace/item/${item[1]}`;u.search="";}
  else{
   for(const key of [...u.searchParams.keys()])if(key.toLowerCase().startsWith("utm_")||TRACKING_PARAMS.has(key.toLowerCase()))u.searchParams.delete(key);
   u.searchParams.sort();
  }
  if(u.pathname.length>1)u.pathname=u.pathname.replace(/\/+$/g,"");
  return u.toString();
 }catch{return value;}
}

export async function ensureImportLogTable(){
 await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ListingImportLog" ("id" text PRIMARY KEY,"userId" text NOT NULL,"listingId" text NOT NULL,"sourceType" text NOT NULL,"sourceUrl" text,"fingerprint" text NOT NULL,"sourceCanonical" text,"createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
 await prisma.$executeRawUnsafe(`ALTER TABLE "ListingImportLog" ADD COLUMN IF NOT EXISTS "sourceCanonical" text`);
 await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "ListingImportLog_user_fingerprint_key" ON "ListingImportLog" ("userId","fingerprint")`);
 await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "ListingImportLog_user_source_canonical_key" ON "ListingImportLog" ("userId","sourceCanonical") WHERE "sourceCanonical" IS NOT NULL`);
 await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ListingImportLog_user_created_idx" ON "ListingImportLog" ("userId","createdAt" DESC)`);
 // ListingImportLog predates a database FK. Keep it self-healing so deleted
 // listings never leave stale import fingerprints/history behind.
 await prisma.$executeRawUnsafe(`DELETE FROM "ListingImportLog" i WHERE NOT EXISTS (SELECT 1 FROM "Listing" l WHERE l."id"=i."listingId")`);
 const pending=await prisma.$queryRawUnsafe<Array<{id:string;userId:string;sourceUrl:string|null}>>(`SELECT "id","userId","sourceUrl" FROM "ListingImportLog" WHERE "sourceCanonical" IS NULL AND "sourceUrl" IS NOT NULL LIMIT 500`);
 for(const row of pending){const canonical=canonicalImportSourceUrl(row.sourceUrl);if(!canonical)continue;await prisma.$executeRawUnsafe(`UPDATE "ListingImportLog" SET "sourceCanonical"=$2 WHERE "id"=$1 AND NOT EXISTS (SELECT 1 FROM "ListingImportLog" x WHERE x."userId"=$3 AND x."sourceCanonical"=$2 AND x."id"<>$1)`,row.id,canonical,row.userId).catch(()=>undefined)}
}

export function importFingerprint(input:{sourceUrl?:string|null;category?:string|null;title?:string|null;priceMinor?:number|null;city?:string|null;postalCode?:string|null}){
 const source=canonicalImportSourceUrl(input.sourceUrl);
 const raw=source?`url:${source}`:`row:${[input.category,input.title,input.priceMinor??"",input.city,input.postalCode].map(x=>String(x??"").trim().toLowerCase()).join("|")}`;
 return createHash("sha256").update(raw).digest("hex");
}

export async function existingImport(userId:string,fingerprint:string,sourceUrl?:string|null){
 await ensureImportLogTable();const canonical=canonicalImportSourceUrl(sourceUrl);
 await prisma.$executeRawUnsafe(`DELETE FROM "ListingImportLog" i WHERE i."userId"=$1 AND (i."fingerprint"=$2 OR ($3::text IS NOT NULL AND i."sourceCanonical"=$3)) AND NOT EXISTS (SELECT 1 FROM "Listing" l WHERE l."id"=i."listingId" AND l."sellerId"=$1)`,userId,fingerprint,canonical);
 const rows=await prisma.$queryRawUnsafe<Array<{listingId:string;createdAt:Date}>>(`SELECT i."listingId",i."createdAt" FROM "ListingImportLog" i JOIN "Listing" l ON l."id"=i."listingId" AND l."sellerId"=$1 WHERE i."userId"=$1 AND (i."fingerprint"=$2 OR ($3::text IS NOT NULL AND i."sourceCanonical"=$3)) ORDER BY i."createdAt" DESC LIMIT 1`,userId,fingerprint,canonical);return rows[0]??null;
}

export async function recordImport(userId:string,listingId:string,sourceType:string,sourceUrl:string|null,fingerprint:string){
 await ensureImportLogTable();const canonical=canonicalImportSourceUrl(sourceUrl);
 const rows=await prisma.$queryRawUnsafe<Array<{id:string}>>(`INSERT INTO "ListingImportLog" ("id","userId","listingId","sourceType","sourceUrl","fingerprint","sourceCanonical") VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING "id"`,randomUUID(),userId,listingId,sourceType,sourceUrl,fingerprint,canonical);
 return rows.length>0;
}

export async function importHistory(userId:string){await ensureImportLogTable();const rows=await prisma.$queryRawUnsafe<Array<{id:string;listingId:string;sourceType:string;sourceUrl:string|null;createdAt:Date;title:string|null;description:string|null;priceMinor:number|null;city:string|null;postalCode:string|null;status:string;slug:string|null;mediaCount:bigint}>>(`SELECT i."id",i."listingId",i."sourceType",i."sourceUrl",i."createdAt",l."title",l."description",l."priceMinor",l."city",l."postalCode",l."status"::text,l."slug",(SELECT COUNT(*)::bigint FROM "ListingMedia" m WHERE m."listingId"=l."id" AND m."status"='READY') AS "mediaCount" FROM "ListingImportLog" i JOIN "Listing" l ON l."id"=i."listingId" WHERE i."userId"=$1 ORDER BY i."createdAt" DESC LIMIT 100`,userId);return rows.map(r=>{const issues:string[]=[];let score=0;if((r.title??"").trim().length>=10)score+=20;else issues.push("Titre à compléter");if((r.description??"").trim().length>=80)score+=25;else issues.push("Description à enrichir");if(r.priceMinor!==null)score+=20;else issues.push("Prix manquant");if((r.city??"").trim()&&(r.postalCode??"").trim())score+=15;else issues.push("Localisation incomplète");const mediaCount=Number(r.mediaCount??0n);if(mediaCount>=3)score+=20;else if(mediaCount>=1){score+=10;issues.push("Ajoutez davantage de photos")}else issues.push("Photo manquante");const resumeStep=mediaCount<1?1:((r.description??"").trim().length<20||!(r.city??"").trim()||!(r.postalCode??"").trim()?2:(r.priceMinor===null?3:4));return{...r,mediaCount,qualityScore:score,qualityIssues:issues,resumeStep,resumeUrl:`/deposer-une-annonce?listingId=${encodeURIComponent(r.listingId)}&resumeStep=${resumeStep}`}})}
