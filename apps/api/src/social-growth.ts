import {randomUUID} from "node:crypto";
import {prisma} from "@pa/database";

export async function ensureSocialGrowthSchema(){
 await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "SocialGrowthPost" (
   "id" text PRIMARY KEY,
   "listingId" text NOT NULL UNIQUE REFERENCES "Listing"("id") ON DELETE CASCADE,
   "channel" text NOT NULL DEFAULT 'FACEBOOK',
   "status" text NOT NULL DEFAULT 'PREPARED',
   "message" text NOT NULL,
   "linkUrl" text NOT NULL,
   "imageUrl" text,
   "externalId" text,
   "error" text,
   "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
   "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
   "publishedAt" timestamptz
 )`);
 await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SocialGrowthPost_status_created_idx" ON "SocialGrowthPost" ("status","createdAt")`);
}

function priceText(priceMinor:number|null,currency:string){
 if(priceMinor==null)return "Prix à découvrir";
 return new Intl.NumberFormat("fr-FR",{style:"currency",currency:currency||"EUR",maximumFractionDigits:0}).format(priceMinor/100);
}

export async function prepareListingSocialPost(listingId:string){
 await ensureSocialGrowthSchema();
 const rows=await prisma.$queryRawUnsafe<Array<{id:string;slug:string|null;title:string|null;priceMinor:number|null;currency:string;city:string|null;imageUrl:string|null}>>(
  `SELECT l."id",l."slug",l."title",l."priceMinor",l."currency",l."city",
    (SELECT lm."publicUrl" FROM "ListingMedia" lm WHERE lm."listingId"=l."id" AND lm."status"='READY' AND lm."publicUrl" IS NOT NULL ORDER BY lm."isCover" DESC,lm."sortOrder" ASC,lm."createdAt" ASC LIMIT 1) AS "imageUrl"
   FROM "Listing" l WHERE l."id"=$1 AND l."status"='PUBLISHED' LIMIT 1`,listingId);
 const listing=rows[0];
 if(!listing?.slug||!listing.imageUrl)return{prepared:false,reason:"missing_slug_or_image" as const};
 const linkUrl=`https://petitannonces.fr/annonce/${encodeURIComponent(listing.slug)}?utm_source=facebook&utm_medium=organic_social&utm_campaign=new_listing`;
 const title=(listing.title??"Nouvelle annonce").trim();
 const place=listing.city?.trim()||"France";
 const message=`✨ Nouvelle annonce sur Petit Annonces\n\n${title}\n${priceText(listing.priceMinor,listing.currency)} · ${place}\n\n👉 Découvrir l’annonce : ${linkUrl}`;
 const id=randomUUID();
 await prisma.$executeRawUnsafe(`INSERT INTO "SocialGrowthPost" ("id","listingId","channel","status","message","linkUrl","imageUrl") VALUES ($1,$2,'FACEBOOK','PREPARED',$3,$4,$5) ON CONFLICT ("listingId") DO UPDATE SET "message"=EXCLUDED."message","linkUrl"=EXCLUDED."linkUrl","imageUrl"=EXCLUDED."imageUrl","updatedAt"=CURRENT_TIMESTAMP WHERE "SocialGrowthPost"."status"='PREPARED'`,id,listing.id,message,linkUrl,listing.imageUrl);
 return{prepared:true,listingId:listing.id,linkUrl,imageUrl:listing.imageUrl};
}

export async function listPreparedSocialPosts(limit=30){
 await ensureSocialGrowthSchema();
 return prisma.$queryRawUnsafe<Array<{id:string;listingId:string;channel:string;status:string;message:string;linkUrl:string;imageUrl:string|null;createdAt:Date}>>(`SELECT "id","listingId","channel","status","message","linkUrl","imageUrl","createdAt" FROM "SocialGrowthPost" WHERE "status"='PREPARED' ORDER BY "createdAt" ASC LIMIT $1`,Math.max(1,Math.min(100,limit)));
}