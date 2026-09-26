import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { getStripeBillingRuntime } from "./admin-control.js";
import { consumeSiteCredit, getSiteCredit, REFERRAL_SITE_CREDIT_MINOR } from "./site-credit.js";
import { nativeExternalDigitalBillingEnabled } from "./native-billing-policy.js";
import { ensureImportLogTable } from "./import-log.js";
import { ensureSocialGrowthSchema } from "./social-growth.js";
import { evaluateListing } from "./publication.js";
import { rejectListingAttemptForPolicy } from "./listing-content-policy.js";
import { scheduleTrustedListingAutoApproval } from "./auto-approval.js";
import { queueAdminRoleEmail, queueTransactionalEmail } from "./transactional-email.js";

const SESSION_COOKIE="pa_session";
const GROWTH_ROLES=new Set(["SUPER_ADMIN","ADMIN","MARKETING","FINANCE"]);
function sha256(v:string){return createHash("sha256").update(v).digest("hex")}
function bearerToken(request:FastifyRequest){const value=request.headers.authorization;if(typeof value!=="string")return null;const match=/^Bearer\s+(.+)$/i.exec(value.trim());return match?.[1]?.trim()||null}
async function currentUser(request:FastifyRequest){const token=bearerToken(request)??request.cookies[SESSION_COOKIE];if(!token)return null;const session=await prisma.session.findUnique({where:{tokenHash:sha256(token)},include:{user:{include:{roles:true}}}});if(!session||session.revokedAt||session.expiresAt<=new Date()||session.user.status!=="ACTIVE")return null;return session.user}
async function requireUser(request:FastifyRequest,reply:FastifyReply){const user=await currentUser(request);if(!user){reply.code(401).send({error:"unauthorized"});return null}return user}
async function requireGrowthAdmin(request:FastifyRequest,reply:FastifyReply){const user=await requireUser(request,reply);if(!user)return null;if(!user.roles.some((r:{role:string})=>GROWTH_ROLES.has(r.role))){reply.code(403).send({error:"forbidden"});return null}return user}
async function stripeRequest(path:string,params:URLSearchParams,idempotencyKey?:string){const c=await getStripeBillingRuntime();if(!c?.apiKey)throw new Error("stripe_billing_not_configured");const headers:Record<string,string>={authorization:`Bearer ${c.apiKey}`,"content-type":"application/x-www-form-urlencoded"};if(idempotencyKey)headers["idempotency-key"]=idempotencyKey;const res=await fetch(`https://api.stripe.com${path}`,{method:"POST",headers,body:params.toString()});const j=await res.json().catch(()=>({})) as any;if(!res.ok)throw new Error(`stripe_${res.status}_${j?.error?.type??"error"}`);return j}
function referralCode(userId:string){return`PA${createHash("sha256").update(userId).digest("hex").slice(0,8).toUpperCase()}`}
function maskReferralEmail(value:string|null|undefined){const email=String(value??"").trim();const at=email.indexOf("@");if(at<=0)return"";const local=email.slice(0,at),domain=email.slice(at+1);const shown=local.slice(0,Math.min(2,local.length));return`${shown}${"*".repeat(Math.max(2,Math.min(6,local.length-shown.length)))}@${domain}`}

async function productByCode(code:string){const rows=await prisma.$queryRawUnsafe<Array<any>>(`SELECT * FROM "PromotionProduct" WHERE "code"=$1 AND "isActive"=TRUE LIMIT 1`,code);return rows[0]??null}
async function preparePromotionPurchase(userId:string,listingId:string,product:any,couponCode?:string){
  const promotionId=randomUUID();
  return prisma.$transaction(async(tx:any)=>{
    let coupon:any=null;let discountMinor=0;
    if(couponCode){
      const rows=await tx.$queryRawUnsafe(`SELECT * FROM "Coupon" WHERE UPPER("code")=UPPER($1) LIMIT 1 FOR UPDATE`,couponCode) as Array<any>;
      coupon=rows[0];const now=Date.now();
      if(!coupon||!coupon.isActive||!["PERCENT","FIXED"].includes(String(coupon.type))||(coupon.startsAt&&new Date(coupon.startsAt).getTime()>now)||(coupon.endsAt&&new Date(coupon.endsAt).getTime()<=now))throw new Error("invalid_coupon");
      if(coupon.type==="FIXED"&&String(coupon.currency??"EUR").toUpperCase()!==String(product.currency??"EUR").toUpperCase())throw new Error("invalid_coupon");
      const markerLike=`coupon:${coupon.id}:%`;
      await tx.$executeRawUnsafe(`UPDATE "ListingPromotion" SET "status"='CANCELED',"updatedAt"=CURRENT_TIMESTAMP WHERE "status"='PENDING' AND "externalPaymentReference" LIKE $1 AND "createdAt"<CURRENT_TIMESTAMP-INTERVAL '35 minutes'`,markerLike);
      const used=await tx.$queryRawUnsafe(`SELECT "id" FROM "CouponRedemption" WHERE "couponId"=$1 AND "userId"=$2 LIMIT 1`,coupon.id,userId) as Array<{id:string}>;if(used[0])throw new Error("coupon_already_used");
      const pendingForUser=await tx.$queryRawUnsafe(`SELECT "id" FROM "ListingPromotion" WHERE "userId"=$1 AND "status"='PENDING' AND "externalPaymentReference" LIKE $2 LIMIT 1`,userId,markerLike) as Array<{id:string}>;if(pendingForUser[0])throw new Error("coupon_checkout_pending");
      if(coupon.maxRedemptions!=null){const pending=await tx.$queryRawUnsafe(`SELECT COUNT(*)::bigint AS count FROM "ListingPromotion" WHERE "status"='PENDING' AND "externalPaymentReference" LIKE $1`,markerLike) as Array<{count:bigint}>;if(Number(coupon.redemptions)+Number(pending[0]?.count??0n)>=Number(coupon.maxRedemptions))throw new Error("invalid_coupon")}
      discountMinor=coupon.type==="PERCENT"?Math.min(Number(product.priceMinor),Math.round(Number(product.priceMinor)*Math.min(100,Number(coupon.value))/100)):Math.min(Number(product.priceMinor),Number(coupon.value));
    }
    const payableMinor=Math.max(0,Number(product.priceMinor)-discountMinor);const marker=coupon?`coupon:${coupon.id}:${discountMinor}`:null;
    await tx.$executeRawUnsafe(`INSERT INTO "ListingPromotion" ("id","listingId","userId","productId","status","source","externalPaymentReference") VALUES ($1,$2,$3,$4,'PENDING',$5,$6)`,promotionId,listingId,userId,product.id,payableMinor===0?"COUPON":"PAYMENT",marker);
    return{promotionId,coupon,discountMinor,payableMinor};
  });
}
async function redeemCoupon(tx:any,couponId:string|null,userId:string,promotionId:string,discountMinor:number){
  if(!couponId)return true;
  const inserted=await tx.$queryRawUnsafe(`INSERT INTO "CouponRedemption" ("id","couponId","userId","promotionId","discountMinor","creditsGranted") VALUES ($1,$2,$3,$4,$5,0) ON CONFLICT ("couponId","userId") DO NOTHING RETURNING "id"`,randomUUID(),couponId,userId,promotionId,discountMinor) as Array<{id:string}>;
  if(!inserted.length)return false;
  await tx.$executeRawUnsafe(`UPDATE "Coupon" SET "redemptions"="redemptions"+1 WHERE "id"=$1`,couponId);
  return true;
}
async function activatePromotion(promotionId:string,expectedUserId:string,expectedAmountMinor:number,externalRef:string|null){return prisma.$transaction(async(tx:any)=>{const rows=await tx.$queryRawUnsafe(`SELECT lp."id",lp."listingId",lp."userId",lp."productId",lp."status"::text,lp."source",lp."externalPaymentReference",pp."code",pp."type"::text AS "type",pp."name",pp."durationHours",pp."priceMinor" FROM "ListingPromotion" lp JOIN "PromotionProduct" pp ON pp."id"=lp."productId" WHERE lp."id"=$1 FOR UPDATE`,promotionId) as Array<any>;const p=rows[0];if(!p||p.userId!==expectedUserId)return false;if(p.status==="ACTIVE")return true;if(p.status!=="PENDING")return false;const couponInfo=String(p.externalPaymentReference??"").startsWith("coupon:")?String(p.externalPaymentReference).split(":"):null;const couponId=couponInfo?.[1]||null;const discountMinor=Number(couponInfo?.[2]||0);const payable=Math.max(0,Number(p.priceMinor)-discountMinor);if(payable!==expectedAmountMinor)return false;const prior=await tx.$queryRawUnsafe(`SELECT MAX("endsAt") AS "endsAt" FROM "ListingPromotion" WHERE "listingId"=$1 AND "productId"=$2 AND "status"='ACTIVE' AND "endsAt">CURRENT_TIMESTAMP`,p.listingId,p.productId) as Array<{endsAt:Date|null}>;const now=new Date();const startsAt=prior[0]?.endsAt&&new Date(prior[0].endsAt)>now?new Date(prior[0].endsAt):now;const endsAt=p.durationHours?new Date(startsAt.getTime()+Number(p.durationHours)*3600_000):null;const couponRedeemed=await redeemCoupon(tx,couponId,p.userId,p.id,discountMinor);if(!couponRedeemed)return false;const source=payable===0?"COUPON":String(externalRef??"").startsWith("site-credit:")?"SITE_CREDIT":"PAYMENT";await tx.$executeRawUnsafe(`UPDATE "ListingPromotion" SET "status"='ACTIVE',"startsAt"=$2,"endsAt"=$3,"source"=$4,"externalPaymentReference"=$5,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,p.id,startsAt,endsAt,source,externalRef);await tx.$executeRawUnsafe(`INSERT INTO "GrowthEvent" ("id","userId","eventName","channel","properties") VALUES ($1,$2,'PROMOTION_ACTIVATED','WEB',$3::jsonb)`,randomUUID(),p.userId,JSON.stringify({listingId:p.listingId,productCode:p.code,amountMinor:payable,currency:"EUR"}));return true})}

async function submitPromotionDraftToModeration(listingId:string,userId:string){
  const current=await prisma.listing.findFirst({where:{id:listingId,sellerId:userId},select:{id:true,status:true,title:true,slug:true}});
  if(!current)return false;
  if(current.status==="PENDING"||current.status==="PUBLISHED")return true;
  if(current.status!=="DRAFT")return false;
  const evaluated=await evaluateListing(listingId,userId);
  if(!evaluated?.ready)return false;
  const slug=current.slug??((evaluated.listing.title??"annonce").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"").slice(0,70)+"-"+randomUUID().slice(0,8));
  const listing=await prisma.$transaction(async tx=>{
    const pending=await tx.listing.update({where:{id:listingId},data:{status:"PENDING",slug,draftSavedAt:null}});
    await tx.$executeRawUnsafe("INSERT INTO \"ModerationCase\" (\"id\",\"targetType\",\"targetId\",\"priority\",\"riskScore\") SELECT $1,'LISTING'::\"ReportTargetType\",$2,50,0 WHERE NOT EXISTS (SELECT 1 FROM \"ModerationCase\" WHERE \"targetType\"='LISTING' AND \"targetId\"=$2 AND \"status\" NOT IN ('RESOLVED','CLOSED'))",randomUUID(),listingId);
    return pending;
  });
  const autoApproval=await scheduleTrustedListingAutoApproval(listing.id,userId).catch(()=>({scheduled:false as const,reason:"schedule_failed"}));
  await queueAdminRoleEmail({roles:["SUPER_ADMIN","ADMIN"],eventKind:"ADMIN_LISTING_PENDING",title:"Nouvelle annonce sponsorisée en attente de validation",body:"Une nouvelle annonce « "+(listing.title??"Sans titre")+" » avec une option de visibilité active attend une validation.",actionUrl:"https://admin.petitannonces.fr/moderation",metadata:{purpose:"ADMIN_LISTING_PENDING",listingId:listing.id,sellerId:userId,promotionPaid:true,autoApprovalScheduled:Boolean(autoApproval?.scheduled)}}).catch(()=>undefined);
  if(!autoApproval?.scheduled){
    const moderators=await prisma.user.findMany({where:{status:"ACTIVE",roles:{some:{role:"MODERATOR"}},NOT:{roles:{some:{role:{in:["SUPER_ADMIN","ADMIN"]}}}}},select:{id:true},take:20});
    for(const moderator of moderators)await queueTransactionalEmail({userId:moderator.id,eventKind:"MODERATION_LISTING_PENDING",title:"Nouvelle annonce sponsorisée à modérer",body:"Une annonce avec une option de visibilité active attend votre vérification : « "+(listing.title??"Sans titre")+" ».",actionUrl:"https://admin.petitannonces.fr/moderation",metadata:{purpose:"MODERATION_REVIEW",listingId:listing.id,promotionPaid:true}}).catch(()=>undefined);
  }
  return true;
}

export async function handlePromotionStripeEvent(type:string,session:Record<string,unknown>){
  const m=session.metadata as Record<string,unknown>|undefined;
  if(m?.pa_promotion_purchase!=="true")return false;
  const promotionId=typeof m.pa_promotion_id==="string"?m.pa_promotion_id:"";
  const userId=typeof m.pa_user_id==="string"?m.pa_user_id:"";
  if(!promotionId||!userId)return true;
  if(type==="checkout.session.expired"||type==="checkout.session.async_payment_failed"){
    await prisma.$executeRawUnsafe(`UPDATE "ListingPromotion" SET "status"='CANCELED',"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "userId"=$2 AND "status"='PENDING'`,promotionId,userId);
    return true;
  }
  if(type!=="checkout.session.completed"&&type!=="checkout.session.async_payment_succeeded")return false;
  const expected=Number(m.pa_amount_minor);const paymentStatus=String(session.payment_status??"");const amountTotal=Number(session.amount_total);const sessionId=typeof session.id==="string"?session.id:null;
  if(!Number.isFinite(expected)||paymentStatus!=="paid"||amountTotal!==expected)return true;
  const activated=await activatePromotion(promotionId,userId,expected,sessionId);
  if(!activated)throw new Error("promotion_activation_failed");
  if(m.pa_publish_after_payment==="true"&&typeof m.pa_listing_id==="string"){
    const submitted=await submitPromotionDraftToModeration(m.pa_listing_id,userId);
    if(!submitted)throw new Error("promotion_paid_listing_submission_failed");
  }
  return true;
}

export async function registerGrowthRoutes(app:FastifyInstance){
 app.get("/promotions/products",async(_request,reply)=>{const rows=await prisma.$queryRawUnsafe<Array<Record<string,unknown>>>(`SELECT "id","code","type","name","description","priceMinor","currency","durationHours" FROM "PromotionProduct" WHERE "isActive"=TRUE ORDER BY "priceMinor" ASC`);return reply.send({products:rows})});
 app.get("/promotions/wallet",async(request,reply)=>{const user=await requireUser(request,reply);if(!user)return;return reply.send(await getSiteCredit(user.id))});
 app.post("/listings/:id/promotions",async(request,reply)=>{const user=await requireUser(request,reply);if(!user)return;const params=z.object({id:z.string().min(1)}).safeParse(request.params);const body=z.object({productCode:z.string().min(2).max(60),couponCode:z.string().trim().max(60).optional(),returnMode:z.enum(["WEB","NATIVE"]).optional(),appScheme:z.enum(["petitannonces","petitannonces-development","petitannonces-preview"]).optional().default("petitannonces"),publishAfterPayment:z.boolean().optional().default(false),publicationConsents:z.object({termsAccepted:z.literal(true),rulesAccepted:z.literal(true),accuracyConfirmed:z.literal(true),professionalDisclosureConfirmed:z.literal(true)}).optional()}).safeParse(request.body);if(!params.success||!body.success)return reply.code(400).send({error:"invalid_request"});if(body.data.returnMode==="NATIVE"&&!nativeExternalDigitalBillingEnabled())return reply.code(403).send({error:"native_external_digital_billing_disabled"});const requestedStatus=body.data.publishAfterPayment?"DRAFT":"PUBLISHED";
   const listing=await prisma.listing.findFirst({where:{id:params.data.id,sellerId:user.id,status:requestedStatus},select:{id:true,title:true}});
   if(!listing)return reply.code(404).send({error:"listing_not_found"});
   if(body.data.publishAfterPayment){
     if(!body.data.publicationConsents)return reply.code(400).send({error:"publication_consents_required"});
     const edits=await prisma.$queryRawUnsafe<Array<{id:string}>>("SELECT \"id\" FROM \"ListingEditSession\" WHERE \"workingListingId\"=$1 LIMIT 1",listing.id).catch(()=>[]);
     if(edits[0])return reply.code(409).send({error:"promotion_checkout_edit_unsupported"});
     const policyBlock=await rejectListingAttemptForPolicy({request,userId:user.id,listingId:listing.id});
     if(policyBlock)return reply.code(423).send({error:"listing_content_policy_violation",message:"Cette annonce contient un contenu interdit ou des coordonnées directes.",reasons:policyBlock.signals,redirect:policyBlock.redirect});
     const evaluated=await evaluateListing(listing.id,user.id);
     if(!evaluated)return reply.code(404).send({error:"draft_not_found"});
     if(!evaluated.ready)return reply.code(422).send({error:"listing_not_ready",errors:evaluated.errors,warnings:evaluated.warnings});
     const duplicate=await prisma.listing.findFirst({where:{sellerId:user.id,id:{not:listing.id},status:{in:["PENDING","PUBLISHED","SUSPENDED"]},categoryId:evaluated.listing.categoryId,title:evaluated.listing.title,priceMinor:evaluated.listing.priceMinor,city:evaluated.listing.city,postalCode:evaluated.listing.postalCode},select:{id:true,title:true,status:true,slug:true}});
     if(duplicate)return reply.code(409).send({error:"duplicate_listing_exists",message:"Cette annonce existe déjà dans votre compte.",duplicate});
     const merchantProduct=Boolean(!evaluated.summary.isVacation&&evaluated.listing.priceMinor!==null&&!(["JOB","SERVICE","REAL_ESTATE","VEHICLE"] as string[]).includes(evaluated.listing.category.domain));
     if(user.kind==="PROFESSIONNEL"&&merchantProduct){
       const safetyRows=await prisma.$queryRawUnsafe<Array<{manufacturerName:string|null;manufacturerPostalAddress:string|null;manufacturerEmail:string|null;productIdentifier:string|null;model:string|null;ean:string|null}>>("SELECT \"manufacturerName\",\"manufacturerPostalAddress\",\"manufacturerEmail\",\"productIdentifier\",\"model\",\"ean\" FROM \"ListingProductSafety\" WHERE \"listingId\"=$1 LIMIT 1",listing.id).catch(()=>[]);
       const safety=safetyRows[0];const validSafety=Boolean(safety?.manufacturerName?.trim()&&safety?.manufacturerPostalAddress?.trim()&&safety?.manufacturerEmail?.trim()&&(safety?.productIdentifier?.trim()||safety?.model?.trim()||safety?.ean?.trim()));
       if(!validSafety)return reply.code(422).send({error:"product_safety_required"});
       const disclosureRows=await prisma.$queryRawUnsafe<Array<{sellerIsTrader:boolean;withdrawalRightApplies:boolean|null;withdrawalPeriodDays:number|null;withdrawalExceptionCode:string|null}>>("SELECT \"sellerIsTrader\",\"withdrawalRightApplies\",\"withdrawalPeriodDays\",\"withdrawalExceptionCode\" FROM \"TraderConsumerDisclosure\" WHERE \"listingId\"=$1 LIMIT 1",listing.id).catch(()=>[]);
       const disclosure=disclosureRows[0];const valid=Boolean(disclosure?.sellerIsTrader&&disclosure.withdrawalRightApplies!==null&&(disclosure.withdrawalRightApplies===false?Boolean(disclosure.withdrawalExceptionCode?.trim()):Number(disclosure.withdrawalPeriodDays)>0));
       if(!valid)return reply.code(422).send({error:"consumer_return_policy_required"});
     }
     const existingConsent=await prisma.$queryRawUnsafe<Array<{id:string}>>("SELECT \"id\" FROM \"ListingPublicationConsent\" WHERE \"listingId\"=$1 AND \"userId\"=$2 ORDER BY \"createdAt\" DESC LIMIT 1",listing.id,user.id).catch(()=>[]);
     if(!existingConsent[0])await prisma.$executeRawUnsafe("INSERT INTO \"ListingPublicationConsent\" (\"id\",\"listingId\",\"userId\",\"termsAccepted\",\"rulesAccepted\",\"accuracyConfirmed\",\"professionalDisclosureConfirmed\",\"ipHash\",\"userAgent\",\"createdAt\") VALUES ($1,$2,$3,TRUE,TRUE,TRUE,TRUE,$4,$5,NOW())",randomUUID(),listing.id,user.id,sha256((process.env.IP_HASH_SALT??"petitannonces")+":"+request.ip),String(request.headers["user-agent"]??"").slice(0,500)||null);
     await prisma.listing.update({where:{id:listing.id},data:{draftSavedAt:new Date()}});
   }
   const product=await productByCode(body.data.productCode);if(!product)return reply.code(404).send({error:"promotion_product_not_found"});let promotionId="",payableMinor=0;try{const prepared=await preparePromotionPurchase(user.id,listing.id,product,body.data.couponCode);promotionId=prepared.promotionId;payableMinor=prepared.payableMinor}catch(e){const c=e instanceof Error?e.message:"invalid_coupon";return reply.code(c==="coupon_already_used"||c==="coupon_checkout_pending"?409:400).send({error:c})}
   if(payableMinor===0){await activatePromotion(promotionId,user.id,0,null);if(body.data.publishAfterPayment){const submitted=await submitPromotionDraftToModeration(listing.id,user.id);if(!submitted)return reply.code(409).send({error:"listing_submission_failed_after_promotion"})}return reply.code(201).send({activated:true,promotionId,amountMinor:0,currency:product.currency,submitted:body.data.publishAfterPayment})}
   const credit=await consumeSiteCredit(user.id,payableMinor,"LISTING_PROMOTION",promotionId,{listingId:listing.id,productCode:product.code});
   if(credit.consumed){await activatePromotion(promotionId,user.id,payableMinor,`site-credit:${promotionId}`);if(body.data.publishAfterPayment){const submitted=await submitPromotionDraftToModeration(listing.id,user.id);if(!submitted)return reply.code(409).send({error:"listing_submission_failed_after_promotion"})}return reply.code(201).send({activated:true,promotionId,amountMinor:payableMinor,currency:product.currency,paidWith:"SITE_CREDIT",creditBalanceMinor:credit.balanceMinor,submitted:body.data.publishAfterPayment})}
   try{const sp=new URLSearchParams();sp.set("mode","payment");sp.set("expires_at",String(Math.floor(Date.now()/1000)+1800));sp.set("client_reference_id",user.id);sp.set("customer_email",user.email);const nativeReturn=body.data.returnMode==="NATIVE";const webVisibilityPath=user.kind==="PROFESSIONNEL"?"/espace-pro/visibilite":"/mon-compte/visibilite";const wizardSuccess=`https://petitannonces.fr/annonce-ajoutee?status=PENDING&promotion=success&listingId=${encodeURIComponent(listing.id)}`;const wizardCancel=`https://petitannonces.fr/deposer-une-annonce?listingId=${encodeURIComponent(listing.id)}&resumeStep=4&promotion=cancelled`;sp.set("success_url",body.data.publishAfterPayment?wizardSuccess:(nativeReturn?`https://petitannonces.fr/app/promotion?result=success&listingId=${encodeURIComponent(listing.id)}&scheme=${encodeURIComponent(body.data.appScheme)}`:`https://petitannonces.fr${webVisibilityPath}?promotion=success&listingId=${encodeURIComponent(listing.id)}`));sp.set("cancel_url",body.data.publishAfterPayment?wizardCancel:(nativeReturn?`https://petitannonces.fr/app/promotion?result=cancel&listingId=${encodeURIComponent(listing.id)}&scheme=${encodeURIComponent(body.data.appScheme)}`:`https://petitannonces.fr${webVisibilityPath}?promotion=cancelled&listingId=${encodeURIComponent(listing.id)}`));sp.set("line_items[0][quantity]","1");sp.set("line_items[0][price_data][currency]",String(product.currency??"EUR").toLowerCase());sp.set("line_items[0][price_data][unit_amount]",String(payableMinor));sp.set("line_items[0][price_data][product_data][name]",`${product.name} · ${listing.title??"Annonce"}`.slice(0,120));sp.set("metadata[pa_promotion_purchase]","true");sp.set("metadata[pa_promotion_id]",promotionId);sp.set("metadata[pa_user_id]",user.id);sp.set("metadata[pa_listing_id]",listing.id);sp.set("metadata[pa_product_code]",product.code);sp.set("metadata[pa_amount_minor]",String(payableMinor));if(body.data.publishAfterPayment)sp.set("metadata[pa_publish_after_payment]","true");const checkout=await stripeRequest("/v1/checkout/sessions",sp,`promotion-${promotionId}`);if(!checkout.url)throw new Error("stripe_checkout_url_missing");return reply.send({url:String(checkout.url),promotionId,amountMinor:payableMinor,currency:product.currency})}catch(error){request.log.error({error,promotionId},"promotion checkout failed");await prisma.$executeRawUnsafe(`UPDATE "ListingPromotion" SET "status"='CANCELED',"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "status"='PENDING'`,promotionId);return reply.code(503).send({error:"promotion_checkout_unavailable"})}
 });
 app.get("/listings/:id/promotions",async(request,reply)=>{const parsed=z.object({id:z.string().min(1)}).safeParse(request.params);if(!parsed.success)return reply.code(400).send({error:"invalid_listing"});const rows=await prisma.$queryRawUnsafe<Array<Record<string,unknown>>>(`SELECT lp."id",pp."code",pp."type",pp."name",lp."status",lp."startsAt",lp."endsAt" FROM "ListingPromotion" lp JOIN "PromotionProduct" pp ON pp."id"=lp."productId" WHERE lp."listingId"=$1 AND lp."status"='ACTIVE' AND (lp."startsAt" IS NULL OR lp."startsAt"<=CURRENT_TIMESTAMP) AND (lp."endsAt" IS NULL OR lp."endsAt">CURRENT_TIMESTAMP) ORDER BY lp."createdAt" DESC`,parsed.data.id);return reply.send({promotions:rows})});
 app.get("/referrals/me",async(request,reply)=>{const user=await requireUser(request,reply);if(!user)return;const code=referralCode(user.id);await prisma.$executeRawUnsafe(`INSERT INTO "ReferralCode" ("id","ownerUserId","code","rewardCredits") VALUES ($1,$2,$3,$4) ON CONFLICT ("ownerUserId") DO UPDATE SET "rewardCredits"=EXCLUDED."rewardCredits"`,randomUUID(),user.id,code,REFERRAL_SITE_CREDIT_MINOR);const rows=await prisma.$queryRawUnsafe<Array<any>>(`SELECT * FROM "ReferralCode" WHERE "ownerUserId"=$1 LIMIT 1`,user.id);const raw=await prisma.$queryRawUnsafe<Array<any>>(`SELECT r."id",r."status"::text AS "status",r."createdAt",r."qualifiedAt",r."rewardedAt",u."email",u."emailVerifiedAt",COALESCE(up."displayName",up."firstName",u."email") AS "displayName" FROM "Referral" r JOIN "User" u ON u."id"=r."referredUserId" LEFT JOIN "UserProfile" up ON up."userId"=u."id" WHERE r."referralCodeId"=$1 ORDER BY r."createdAt" DESC`,rows[0].id);const referrals=raw.map(item=>({id:item.id,status:item.status,createdAt:item.createdAt,qualifiedAt:item.qualifiedAt,rewardedAt:item.rewardedAt,displayName:String(item.displayName??"Membre invité"),maskedEmail:maskReferralEmail(item.email),emailVerifiedAt:item.emailVerifiedAt,rewardMinor:item.rewardedAt||item.status==="REWARDED"?REFERRAL_SITE_CREDIT_MINOR:0}));const rewarded=referrals.filter(item=>item.rewardMinor>0).length;const verified=referrals.filter(item=>Boolean(item.emailVerifiedAt)).length;const awaitingFirstListing=referrals.filter(item=>item.status==="QUALIFIED").length;const pendingVerification=referrals.filter(item=>item.status==="PENDING").length;return reply.send({referralCode:{...rows[0],rewardCredits:REFERRAL_SITE_CREDIT_MINOR},referrals,rewardsEnabled:true,rewardRule:"FIRST_PUBLISHED_LISTING",stats:{total:referrals.length,verified,rewarded,pending:pendingVerification,awaitingFirstListing,earnedMinor:rewarded*REFERRAL_SITE_CREDIT_MINOR,currency:"EUR"}})});
 app.post("/referrals/apply",async(request,reply)=>{const user=await requireUser(request,reply);if(!user)return;const parsed=z.object({code:z.string().min(4).max(40)}).safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:"invalid_request"});const codes=await prisma.$queryRawUnsafe<Array<any>>(`SELECT * FROM "ReferralCode" WHERE UPPER("code")=UPPER($1) LIMIT 1`,parsed.data.code);const code=codes[0];if(!code||code.ownerUserId===user.id)return reply.code(400).send({error:"invalid_referral"});try{await prisma.$executeRawUnsafe(`INSERT INTO "Referral" ("id","referralCodeId","referredUserId","status") VALUES ($1,$2,$3,'PENDING')`,randomUUID(),code.id,user.id)}catch{return reply.code(409).send({error:"referral_already_applied"})}return reply.code(201).send({applied:true})});
 app.post("/growth/events",async(request,reply)=>{const user=await currentUser(request);const parsed=z.object({eventName:z.string().min(2).max(100),channel:z.string().max(40).optional(),campaign:z.string().max(120).optional(),source:z.string().max(120).optional(),medium:z.string().max(120).optional(),properties:z.record(z.string(),z.unknown()).optional()}).safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:"invalid_request"});const d=parsed.data;await prisma.$executeRawUnsafe(`INSERT INTO "GrowthEvent" ("id","userId","eventName","channel","campaign","source","medium","properties") VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,randomUUID(),user?.id??null,d.eventName,d.channel??null,d.campaign??null,d.source??null,d.medium??null,JSON.stringify(d.properties??{}));return reply.code(202).send({accepted:true})});
 app.get("/admin/growth/summary",async(request,reply)=>{const admin=await requireGrowthAdmin(request,reply);if(!admin)return;await ensureImportLogTable();const[promotions,revenue,events,referrals,coupons,recentPromotions]=await Promise.all([prisma.$queryRawUnsafe<Array<{active:bigint;total:bigint}>>(`SELECT COUNT(*) FILTER (WHERE "status"='ACTIVE' AND ("endsAt" IS NULL OR "endsAt">CURRENT_TIMESTAMP))::bigint AS active,COUNT(*)::bigint AS total FROM "ListingPromotion"`),prisma.$queryRawUnsafe<Array<{revenue:bigint}>>(`SELECT COALESCE(SUM(GREATEST(0,pp."priceMinor"-COALESCE(cr."discountMinor",0))),0)::bigint AS revenue FROM "ListingPromotion" lp JOIN "PromotionProduct" pp ON pp."id"=lp."productId" LEFT JOIN "CouponRedemption" cr ON cr."promotionId"=lp."id" WHERE lp."source"='PAYMENT' AND lp."status"='ACTIVE'`),prisma.$queryRawUnsafe<Array<Record<string,unknown>>>(`SELECT "eventName",COUNT(*)::bigint AS count FROM "GrowthEvent" WHERE "occurredAt">=CURRENT_TIMESTAMP-INTERVAL '30 days' GROUP BY "eventName" ORDER BY count DESC LIMIT 20`),prisma.$queryRawUnsafe<Array<Record<string,unknown>>>(`SELECT "status",COUNT(*)::bigint AS count FROM "Referral" GROUP BY "status"`),prisma.$queryRawUnsafe<Array<{active:bigint;total:bigint}>>(`SELECT COUNT(*) FILTER (WHERE "isActive"=TRUE AND "type" IN ('PERCENT','FIXED') AND ("startsAt" IS NULL OR "startsAt"<=CURRENT_TIMESTAMP) AND ("endsAt" IS NULL OR "endsAt">CURRENT_TIMESTAMP))::bigint AS active,COUNT(*) FILTER (WHERE "type" IN ('PERCENT','FIXED'))::bigint AS total FROM "Coupon"`),prisma.$queryRawUnsafe<Array<Record<string,unknown>>>(`SELECT lp."id",lp."listingId",l."title",u."email",COALESCE(up."displayName",up."firstName",u."email") AS "sellerName",pp."name",pp."type"::text AS "type",GREATEST(0,pp."priceMinor"-COALESCE(cr."discountMinor",0)) AS "priceMinor",pp."currency",lp."status"::text AS "status",lp."source",lp."startsAt",lp."endsAt",lp."createdAt" FROM "ListingPromotion" lp JOIN "PromotionProduct" pp ON pp."id"=lp."productId" JOIN "Listing" l ON l."id"=lp."listingId" JOIN "User" u ON u."id"=lp."userId" LEFT JOIN "UserProfile" up ON up."userId"=u."id" LEFT JOIN "CouponRedemption" cr ON cr."promotionId"=lp."id" ORDER BY lp."createdAt" DESC LIMIT 50`)]);const [launchBase,launchEvents,acquisition,campaignPerformance,landingPerformance,proSectorPerformance]=await Promise.all([
  prisma.$queryRawUnsafe<Array<{visitors:number}>>(`SELECT COUNT(DISTINCT "visitorId")::int AS visitors FROM "SiteAnalyticsSession" WHERE "startedAt">=CURRENT_TIMESTAMP-INTERVAL '7 days'`),
  prisma.$queryRawUnsafe<Array<{event:string;visitors:number;events:number}>>(`SELECT "event",COUNT(DISTINCT "visitorId")::int AS visitors,COUNT(*)::int AS events FROM "SiteAnalyticsEvent" WHERE "createdAt">=CURRENT_TIMESTAMP-INTERVAL '7 days' AND "event" IN ('SIGN_UP_COMPLETED','PHONE_VERIFIED','LISTING_SUBMITTED','MESSAGE_SENT','PRO_TRIAL_STARTED','CHECKOUT_STARTED','PURCHASE_COMPLETED','LANDING_CTA_CLICKED') GROUP BY "event"`),
  prisma.$queryRawUnsafe<Array<{source:string|null;medium:string|null;campaign:string|null;visitors:number;sessions:number}>>(`SELECT "source","medium","campaign",COUNT(DISTINCT "visitorId")::int AS visitors,COUNT(*)::int AS sessions FROM "SiteAnalyticsSession" WHERE "startedAt">=CURRENT_TIMESTAMP-INTERVAL '30 days' GROUP BY "source","medium","campaign" ORDER BY sessions DESC LIMIT 20`),
  prisma.$queryRawUnsafe<Array<{source:string;medium:string;campaign:string;visitors:number;sessions:number;ctaClicks:number;signups:number;proTrials:number;phoneVerified:number;listingsSubmitted:number;checkoutStarts:number;purchases:number;messageSenders:number}>>(`
    WITH attributed AS (
      SELECT "sessionId","visitorId",COALESCE(NULLIF("source",''),'direct') AS source,COALESCE(NULLIF("medium",''),'none') AS medium,COALESCE(NULLIF("campaign",''),'—') AS campaign
      FROM "SiteAnalyticsSession"
      WHERE "startedAt">=CURRENT_TIMESTAMP-INTERVAL '30 days' AND ("source" IS NOT NULL OR "medium" IS NOT NULL OR "campaign" IS NOT NULL)
    ), conversions AS (
      SELECT "sessionId","visitorId","event" FROM "SiteAnalyticsEvent"
      WHERE "createdAt">=CURRENT_TIMESTAMP-INTERVAL '30 days' AND "event" IN ('LANDING_CTA_CLICKED','SIGN_UP_COMPLETED','PRO_TRIAL_STARTED','PHONE_VERIFIED','LISTING_SUBMITTED','CHECKOUT_STARTED','PURCHASE_COMPLETED','MESSAGE_SENT')
    )
    SELECT a.source,a.medium,a.campaign,COUNT(DISTINCT a."visitorId")::int AS visitors,COUNT(DISTINCT a."sessionId")::int AS sessions,
      COUNT(DISTINCT c."visitorId") FILTER (WHERE c."event"='LANDING_CTA_CLICKED')::int AS "ctaClicks",
      COUNT(DISTINCT c."visitorId") FILTER (WHERE c."event"='SIGN_UP_COMPLETED')::int AS "signups",
      COUNT(DISTINCT c."visitorId") FILTER (WHERE c."event"='PRO_TRIAL_STARTED')::int AS "proTrials",
      COUNT(DISTINCT c."visitorId") FILTER (WHERE c."event"='PHONE_VERIFIED')::int AS "phoneVerified",
      COUNT(DISTINCT c."visitorId") FILTER (WHERE c."event"='LISTING_SUBMITTED')::int AS "listingsSubmitted",
      COUNT(DISTINCT c."visitorId") FILTER (WHERE c."event"='CHECKOUT_STARTED')::int AS "checkoutStarts",
      COUNT(DISTINCT c."visitorId") FILTER (WHERE c."event"='PURCHASE_COMPLETED')::int AS "purchases",
      COUNT(DISTINCT c."visitorId") FILTER (WHERE c."event"='MESSAGE_SENT')::int AS "messageSenders"
    FROM attributed a LEFT JOIN conversions c ON c."sessionId"=a."sessionId"
    GROUP BY a.source,a.medium,a.campaign
    ORDER BY "listingsSubmitted" DESC,"signups" DESC,visitors DESC LIMIT 30`),
  prisma.$queryRawUnsafe<Array<{landing:string;visitors:number;sessions:number;ctaClicks:number;signups:number;proTrials:number;phoneVerified:number;listingsSubmitted:number;checkoutStarts:number;purchases:number;messageSenders:number}>>(`
    WITH attributed AS (
      SELECT "sessionId","visitorId",COALESCE(NULLIF("attributionPath",''),split_part("landingPath",'?',1)) AS landing
      FROM "SiteAnalyticsSession"
      WHERE "startedAt">=CURRENT_TIMESTAMP-INTERVAL '30 days'
    ), conversions AS (
      SELECT "sessionId","visitorId","event" FROM "SiteAnalyticsEvent"
      WHERE "createdAt">=CURRENT_TIMESTAMP-INTERVAL '30 days' AND "event" IN ('LANDING_CTA_CLICKED','SIGN_UP_COMPLETED','PRO_TRIAL_STARTED','PHONE_VERIFIED','LISTING_SUBMITTED','CHECKOUT_STARTED','PURCHASE_COMPLETED','MESSAGE_SENT')
    )
    SELECT a.landing,COUNT(DISTINCT a."visitorId")::int AS visitors,COUNT(DISTINCT a."sessionId")::int AS sessions,
      COUNT(DISTINCT c."visitorId") FILTER (WHERE c."event"='LANDING_CTA_CLICKED')::int AS "ctaClicks",
      COUNT(DISTINCT c."visitorId") FILTER (WHERE c."event"='SIGN_UP_COMPLETED')::int AS "signups",
      COUNT(DISTINCT c."visitorId") FILTER (WHERE c."event"='PRO_TRIAL_STARTED')::int AS "proTrials",
      COUNT(DISTINCT c."visitorId") FILTER (WHERE c."event"='PHONE_VERIFIED')::int AS "phoneVerified",
      COUNT(DISTINCT c."visitorId") FILTER (WHERE c."event"='LISTING_SUBMITTED')::int AS "listingsSubmitted",
      COUNT(DISTINCT c."visitorId") FILTER (WHERE c."event"='CHECKOUT_STARTED')::int AS "checkoutStarts",
      COUNT(DISTINCT c."visitorId") FILTER (WHERE c."event"='PURCHASE_COMPLETED')::int AS "purchases",
      COUNT(DISTINCT c."visitorId") FILTER (WHERE c."event"='MESSAGE_SENT')::int AS "messageSenders"
    FROM attributed a LEFT JOIN conversions c ON c."sessionId"=a."sessionId"
    WHERE a.landing IN ('/deposer-annonce-gratuite','/vendre-voiture','/ouvrir-boutique-pro','/pro/automobile','/pro/immobilier','/pro/high-tech','/pro/occasion')
    GROUP BY a.landing ORDER BY "listingsSubmitted" DESC,"signups" DESC,visitors DESC`),
  prisma.$queryRawUnsafe<Array<{sector:string;signups:number;trials:number;importedListings:number;publishedImportedListings:number;publishedListings:number;publishers:number}>>(`
    WITH acquired AS (
      SELECT DISTINCT ON ("userId") "userId",COALESCE(NULLIF("properties"->>'sector',''),'general') AS sector,"occurredAt"
      FROM "GrowthEvent"
      WHERE "eventName"='PRO_ACQUISITION_REGISTERED' AND "occurredAt">=CURRENT_TIMESTAMP-INTERVAL '30 days' AND "userId" IS NOT NULL
      ORDER BY "userId","occurredAt" ASC
    )
    SELECT a.sector,
      COUNT(DISTINCT a."userId")::int AS signups,
      COUNT(DISTINCT a."userId") FILTER (WHERE EXISTS (SELECT 1 FROM "GrowthEvent" t WHERE t."userId"=a."userId" AND t."eventName"='PRO_TRIAL_STARTED' AND t."occurredAt">=a."occurredAt"))::int AS trials,
      COUNT(DISTINCT i."listingId")::int AS "importedListings",
      COUNT(DISTINCT i."listingId") FILTER (WHERE il."status"='PUBLISHED')::int AS "publishedImportedListings",
      COUNT(DISTINCT l."id") FILTER (WHERE l."status"='PUBLISHED')::int AS "publishedListings",
      COUNT(DISTINCT l."sellerId") FILTER (WHERE l."status"='PUBLISHED')::int AS publishers
    FROM acquired a
    LEFT JOIN "ListingImportLog" i ON i."userId"=a."userId" AND i."createdAt">=a."occurredAt"
    LEFT JOIN "Listing" il ON il."id"=i."listingId"
    LEFT JOIN "Listing" l ON l."sellerId"=a."userId" AND l."createdAt">=a."occurredAt"
    GROUP BY a.sector
    ORDER BY "publishedListings" DESC,"importedListings" DESC,signups DESC`)
]);
await ensureSocialGrowthSchema();
const socialRows=await prisma.$queryRawUnsafe<Array<{prepared:bigint;total:bigint}>>(`SELECT COUNT(*) FILTER (WHERE "status"='PREPARED')::bigint AS prepared,COUNT(*)::bigint AS total FROM "SocialGrowthPost"`);
const socialQueue={prepared:Number(socialRows[0]?.prepared??0n),total:Number(socialRows[0]?.total??0n)};
const funnelMap=Object.fromEntries(launchEvents.map(row=>[row.event,{visitors:Number(row.visitors),events:Number(row.events)}]));
return reply.send({socialQueue,promotions:{active:Number(promotions[0]?.active??0),total:Number(promotions[0]?.total??0)},promotionRevenueMinor:Number(revenue[0]?.revenue??0),coupons:{active:Number(coupons[0]?.active??0),total:Number(coupons[0]?.total??0)},events:events.map(row=>({...row,count:Number(row.count??0)})),referrals:referrals.map(row=>({...row,count:Number(row.count??0)})),recentPromotions,launchFunnel:{windowDays:7,visitors:Number(launchBase[0]?.visitors??0),landingCtaClicks:funnelMap.LANDING_CTA_CLICKED?.visitors??0,signups:funnelMap.SIGN_UP_COMPLETED?.visitors??0,proTrials:funnelMap.PRO_TRIAL_STARTED?.visitors??0,phoneVerified:funnelMap.PHONE_VERIFIED?.visitors??0,listingsSubmitted:funnelMap.LISTING_SUBMITTED?.visitors??0,checkoutStarts:funnelMap.CHECKOUT_STARTED?.visitors??0,purchases:funnelMap.PURCHASE_COMPLETED?.visitors??0,messageSenders:funnelMap.MESSAGE_SENT?.visitors??0},acquisition:acquisition.map(row=>({...row,source:row.source??"direct",medium:row.medium??"none",campaign:row.campaign??"—",visitors:Number(row.visitors),sessions:Number(row.sessions)})),campaignPerformance:campaignPerformance.map(row=>({...row,visitors:Number(row.visitors),sessions:Number(row.sessions),ctaClicks:Number(row.ctaClicks),signups:Number(row.signups),proTrials:Number(row.proTrials),phoneVerified:Number(row.phoneVerified),listingsSubmitted:Number(row.listingsSubmitted),checkoutStarts:Number(row.checkoutStarts),purchases:Number(row.purchases),messageSenders:Number(row.messageSenders)})),landingPerformance:landingPerformance.map(row=>({...row,visitors:Number(row.visitors),sessions:Number(row.sessions),ctaClicks:Number(row.ctaClicks),signups:Number(row.signups),proTrials:Number(row.proTrials),phoneVerified:Number(row.phoneVerified),listingsSubmitted:Number(row.listingsSubmitted),checkoutStarts:Number(row.checkoutStarts),purchases:Number(row.purchases),messageSenders:Number(row.messageSenders)})),proSectorPerformance:proSectorPerformance.map(row=>({...row,signups:Number(row.signups),trials:Number(row.trials),importedListings:Number(row.importedListings),publishedImportedListings:Number(row.publishedImportedListings),publishedListings:Number(row.publishedListings),publishers:Number(row.publishers)}))})});
 app.post("/admin/growth/credits/grant",async(_request,reply)=>reply.code(410).send({error:"pa_credits_disabled"}));
}
