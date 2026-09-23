import { randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import { deliverUserEvent } from "./notification-delivery.js";
import { grantReferralSiteCredit, REFERRAL_SITE_CREDIT_MINOR } from "./site-credit.js";

export async function applyReferralCodeForUser(userId:string,rawCode?:string|null){
  const code=rawCode?.trim();
  if(!code)return false;
  try{
    const rows=await prisma.$queryRawUnsafe<Array<{id:string;ownerUserId:string}>>(`SELECT "id","ownerUserId" FROM "ReferralCode" WHERE UPPER("code")=UPPER($1) LIMIT 1`,code);
    const referral=rows[0];
    if(!referral||referral.ownerUserId===userId)return false;
    const inserted=await prisma.$queryRawUnsafe<Array<{id:string}>>(`INSERT INTO "Referral" ("id","referralCodeId","referredUserId","status") VALUES ($1,$2,$3,'PENDING') ON CONFLICT ("referredUserId") DO NOTHING RETURNING "id"`,randomUUID(),referral.id,userId);
    return Boolean(inserted[0]);
  }catch{return false}
}

/**
 * Email verification qualifies a referral but does not pay it.
 * The reward is granted only after the referred member's first approved
 * (PUBLISHED) listing.
 */
export async function rewardReferralAfterEmailVerification(userId:string){
  const changed=await prisma.$executeRawUnsafe(
    `UPDATE "Referral" SET "status"='QUALIFIED',"qualifiedAt"=COALESCE("qualifiedAt",CURRENT_TIMESTAMP)
     WHERE "referredUserId"=$1 AND "status"='PENDING' AND "rewardedAt" IS NULL`,
    userId,
  ).catch(()=>0);
  return {rewarded:false,qualified:Boolean(changed),reason:"awaiting_first_published_listing" as const};
}

export async function rewardReferralAfterFirstPublishedListing(userId:string){
  const rows=await prisma.$queryRawUnsafe<Array<{
    id:string;status:string;rewardedAt:Date|null;ownerUserId:string;emailVerifiedAt:Date|null;publishedListings:number;
  }>>(
    `SELECT r."id",r."status"::text,r."rewardedAt",rc."ownerUserId",u."emailVerifiedAt",
       (SELECT COUNT(*)::int FROM "Listing" l WHERE l."sellerId"=r."referredUserId" AND l."status"='PUBLISHED') AS "publishedListings"
     FROM "Referral" r
     JOIN "ReferralCode" rc ON rc."id"=r."referralCodeId"
     JOIN "User" u ON u."id"=r."referredUserId"
     WHERE r."referredUserId"=$1
     LIMIT 1`,
    userId,
  );
  const referral=rows[0];
  if(!referral)return {rewarded:false,reason:"no_referral" as const};
  if(referral.rewardedAt||referral.status==="REWARDED")return {rewarded:false,reason:"already_rewarded" as const};
  if(!referral.emailVerifiedAt)return {rewarded:false,reason:"email_not_verified" as const};
  if(referral.status==="PENDING"){
    const qualified=await prisma.$executeRawUnsafe(`UPDATE "Referral" SET "status"='QUALIFIED',"qualifiedAt"=COALESCE("qualifiedAt",CURRENT_TIMESTAMP) WHERE "id"=$1 AND "status"='PENDING' AND "rewardedAt" IS NULL`,referral.id);
    if(qualified)referral.status="QUALIFIED";
  }
  if(referral.status!=="QUALIFIED")return {rewarded:false,reason:"not_qualified" as const};
  if(Number(referral.publishedListings)<1)return {rewarded:false,reason:"no_published_listing" as const};

  const referrerCredit=await grantReferralSiteCredit(referral.ownerUserId,referral.id,"REFERRER");
  const changed=await prisma.$executeRawUnsafe(
    `UPDATE "Referral"
     SET "status"='REWARDED',"rewardedAt"=CURRENT_TIMESTAMP,"qualifiedAt"=COALESCE("qualifiedAt",CURRENT_TIMESTAMP)
     WHERE "id"=$1 AND "rewardedAt" IS NULL AND "status"='QUALIFIED'`,
    referral.id,
  );
  if(!changed)return {rewarded:false,reason:"already_rewarded" as const};

  await prisma.$executeRawUnsafe(
    `INSERT INTO "GrowthEvent" ("id","userId","eventName","channel","properties")
     VALUES ($1,$2,'REFERRAL_REWARDED','WEB',$3::jsonb)`,
    randomUUID(),
    referral.ownerUserId,
    JSON.stringify({
      referralId:referral.id,
      referredUserId:userId,
      rewardMinor:REFERRAL_SITE_CREDIT_MINOR,
      trigger:"FIRST_PUBLISHED_LISTING",
    }),
  ).catch(()=>undefined);

  await Promise.all([
    deliverUserEvent({
      userId:referral.ownerUserId,
      eventKind:"LISTING",
      notificationKind:"WALLET",
      title:"Parrainage : +5 € sur votre compte 🎉",
      body:"Votre invité a publié sa première annonce et elle vient d’être approuvée. 5,00 € de crédit Petit Annonces ont été ajoutés à votre portefeuille.",
      actionUrl:"/parrainage",
      metadata:{
        purpose:"REFERRAL_REWARD",
        referralId:referral.id,
        referredUserId:userId,
        rewardMinor:REFERRAL_SITE_CREDIT_MINOR,
        trigger:"FIRST_PUBLISHED_LISTING",
        transactional:true,
      },
      dedupeKey:`referral-reward-referrer:${referral.id}`,
      transactional:true,
      forceInApp:true,
    }),
    deliverUserEvent({
      userId,
      eventKind:"LISTING",
      notificationKind:"SYSTEM",
      title:"Votre première annonce est en ligne 🎉",
      body:"Votre première annonce a été approuvée. Votre parrainage est maintenant validé.",
      actionUrl:"/mon-compte/annonces",
      metadata:{
        purpose:"REFERRAL_FIRST_LISTING_PUBLISHED",
        referralId:referral.id,
        transactional:true,
      },
      dedupeKey:`referral-first-listing-published:${referral.id}`,
      transactional:true,
      forceInApp:true,
      suppressEmail:true,
    }),
  ]).catch(()=>undefined);

  return {rewarded:true,rewardMinor:REFERRAL_SITE_CREDIT_MINOR,referrerCredit};
}
