import { createHash, randomBytes, randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireListingUser } from "./listing-auth.js";
import { activateListingLifetime, getListingLifecycles, LISTING_RENEWAL_COST_MINOR, LISTING_RENEWAL_CURRENCY } from "./listing-lifecycle.js";
import { queueAdminRoleEmail, queueTransactionalEmail } from "./transactional-email.js";
import { scheduleTrustedListingAutoApproval } from "./auto-approval.js";
import { categoryAttributeDefinitions, categoryBelongsToRootSlug } from "./category-attributes.js";
import { rejectListingAttemptForPolicy } from "./listing-content-policy.js";
import { applyWorkingCopyToOriginal, editSessionByWorkingId, finalizeEditSessionCleanup } from "./listing-edit-session.js";
import { rewardReferralAfterFirstPublishedListing } from "./referrals.js";

const idParams = z.object({ id: z.string().min(1) });
const consentSchema = z.object({
  termsAccepted: z.literal(true),
  rulesAccepted: z.literal(true),
  accuracyConfirmed: z.literal(true),
  professionalDisclosureConfirmed: z.literal(true),
});

function slugify(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 70);
}

function requestIpHash(request: FastifyRequest) {
  const ip = request.ip || "unknown";
  return createHash("sha256").update(`${process.env.IP_HASH_SALT ?? "petitannonces"}:${ip}`).digest("hex");
}

async function ensureListingQualitySnapshotSchema(){
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ListingQualitySnapshot" ("listingId" TEXT PRIMARY KEY REFERENCES "Listing"("id") ON DELETE CASCADE,"sellerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,"score" INTEGER NOT NULL,"level" TEXT NOT NULL,"issues" JSONB NOT NULL DEFAULT '[]'::jsonb,"assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ListingQualitySnapshot_score_idx" ON "ListingQualitySnapshot"("score","assessedAt" DESC)`);
}
async function saveListingQualitySnapshot(listingId:string,sellerId:string,quality:{score:number;level:string;issues:Array<Record<string,unknown>>}){
  await ensureListingQualitySnapshotSchema();
  await prisma.$executeRawUnsafe(`INSERT INTO "ListingQualitySnapshot" ("listingId","sellerId","score","level","issues","assessedAt") VALUES ($1,$2,$3,$4,$5::jsonb,CURRENT_TIMESTAMP) ON CONFLICT ("listingId") DO UPDATE SET "sellerId"=EXCLUDED."sellerId","score"=EXCLUDED."score","level"=EXCLUDED."level","issues"=EXCLUDED."issues","assessedAt"=CURRENT_TIMESTAMP`,listingId,sellerId,quality.score,quality.level,JSON.stringify(quality.issues));
}

async function ensurePublicationReceiptSchema(){
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ListingPublicationReceipt" ("requestListingId" TEXT PRIMARY KEY,"targetListingId" TEXT NOT NULL,"userId" TEXT NOT NULL,"status" TEXT NOT NULL,"slug" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ListingPublicationReceipt_user_created_idx" ON "ListingPublicationReceipt"("userId","createdAt" DESC)`);
}

function issueStep(code:string){
  if(code==="title_required")return 0;
  if(code==="ready_photo_required")return 1;
  if(["price_required","monthly_rent_required","hourly_rate_required","package_weight_required","package_dimensions_required","no_delivery_method"].includes(code))return 3;
  return 2;
}
function issueDetails(errors:string[],warnings:string[]){return {errors:errors.map(code=>({code,step:issueStep(code)})),warnings:warnings.map(code=>({code,step:issueStep(code)}))};}

function normalizeDuplicateText(value:string|null|undefined){
  return (value??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("fr-FR").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");
}
function normalizePostal(value:string|null|undefined){return (value??"").replace(/\D/g,"").slice(0,5)}
function sameNullableNumber(a:number|null|undefined,b:number|null|undefined,tolerance=0){if(a==null||b==null)return a==null&&b==null;return Math.abs(Number(a)-Number(b))<=tolerance}

type DuplicateSource={
  id:string;categoryId:string;title:string|null;description:string|null;priceMinor:number|null;city:string|null;postalCode:string|null;
  category:{domain:string};
  vehicle:{make:string|null;model:string|null;modelYear:number|null;mileageKm:number|null}|null;
  property:{transactionType:string|null;propertyType:string|null;surfaceM2:number|null;rooms:number|null}|null;
};

async function findDuplicateListing(source:DuplicateSource,userId:string,excludeIds:string[]){
  const sourceTitle=normalizeDuplicateText(source.title);if(sourceTitle.length<5)return null;
  const candidates=await prisma.listing.findMany({
    where:{sellerId:userId,id:{notIn:excludeIds},categoryId:source.categoryId,status:{in:["DRAFT","PENDING","PUBLISHED","SUSPENDED"]},OR:[{status:{not:"DRAFT"}},{draftSavedAt:{not:null}}],priceMinor:source.priceMinor},
    select:{id:true,title:true,description:true,priceMinor:true,city:true,postalCode:true,status:true,slug:true,draftSavedAt:true,vehicle:{select:{make:true,model:true,modelYear:true,mileageKm:true}},property:{select:{transactionType:true,propertyType:true,surfaceM2:true,rooms:true}}},
    orderBy:{updatedAt:"desc"},take:30,
  });
  const sourceCity=normalizeDuplicateText(source.city),sourcePostal=normalizePostal(source.postalCode),sourceDescription=normalizeDuplicateText(source.description);
  for(const candidate of candidates){
    if(normalizeDuplicateText(candidate.title)!==sourceTitle)continue;
    if(normalizeDuplicateText(candidate.city)!==sourceCity||normalizePostal(candidate.postalCode)!==sourcePostal)continue;
    if(source.category.domain==="VEHICLE"){
      if(!source.vehicle||!candidate.vehicle)continue;
      if(normalizeDuplicateText(source.vehicle.make)!==normalizeDuplicateText(candidate.vehicle.make)||normalizeDuplicateText(source.vehicle.model)!==normalizeDuplicateText(candidate.vehicle.model))continue;
      if(!sameNullableNumber(source.vehicle.modelYear,candidate.vehicle.modelYear)||!sameNullableNumber(source.vehicle.mileageKm,candidate.vehicle.mileageKm))continue;
    }else if(source.category.domain==="REAL_ESTATE"){
      if(!source.property||!candidate.property)continue;
      if(source.property.transactionType!==candidate.property.transactionType||source.property.propertyType!==candidate.property.propertyType)continue;
      if(!sameNullableNumber(source.property.surfaceM2,candidate.property.surfaceM2,0.5)||!sameNullableNumber(source.property.rooms,candidate.property.rooms))continue;
    }else if(sourceDescription!==normalizeDuplicateText(candidate.description))continue;
    return candidate;
  }
  return null;
}

function duplicatePayload(candidate:{id:string;title:string|null;status:string;slug:string|null}){
  const actionUrl=candidate.status==="DRAFT"?`/deposer-une-annonce?listingId=${encodeURIComponent(candidate.id)}`:candidate.status==="PUBLISHED"&&candidate.slug?`/annonce/${encodeURIComponent(candidate.slug)}`:"/mon-compte/annonces";
  return{id:candidate.id,title:candidate.title,status:candidate.status,slug:candidate.slug,actionUrl};
}

export async function evaluateListing(listingId: string, userId: string) {
  const listing = await prisma.listing.findFirst({
    where: { id: listingId, sellerId: userId, status: "DRAFT" },
    include: {
      category: { include: { attributes: { where: { required: true } } } },
      attributes: true,
      vehicle: true,
      property: true,
      energy: true,
    },
  });
  if (!listing) return null;
  const isVacation=await categoryBelongsToRootSlug(listing.categoryId,"vacances");

  const errors: string[] = [];
  const warnings: string[] = [];
  if (!listing.title || listing.title.trim().length < 5) errors.push("title_required");
  if (!listing.description || listing.description.trim().length < 20) errors.push("description_required");
  if (!listing.city) errors.push("city_required");
  if (!listing.postalCode) errors.push("postal_code_required");
  if (listing.priceMinor === null) {
    if (listing.category.domain === "JOB") errors.push("hourly_rate_required");
    else if (listing.category.domain === "REAL_ESTATE" && listing.property?.transactionType === "RENTAL") errors.push("monthly_rent_required");
    else if (listing.category.domain !== "SERVICE") errors.push("price_required");
  }

  const setIds = new Set(listing.attributes.map((attribute) => attribute.attributeId));
  const realEstateDedicatedKeys = new Set(["propertyType","surface","rooms","bedrooms","floor","furnished","dpe","ges"]);
  const inheritedRequiredDefinitions = await categoryAttributeDefinitions(listing.categoryId,{requiredOnly:true});
  for (const attribute of inheritedRequiredDefinitions) if (!(listing.category.domain === "REAL_ESTATE" && realEstateDedicatedKeys.has(attribute.key)) && !setIds.has(attribute.id)) errors.push(`required_attribute:${attribute.key}`);

  if (listing.category.domain === "VEHICLE" && !listing.vehicle) errors.push("vehicle_details_required");
  if (listing.category.domain === "REAL_ESTATE") {
    if (!listing.property) errors.push("property_details_required");
    if (!listing.energy) errors.push("energy_performance_required");
    else if (!listing.energy.isExempt) {
      if (!listing.energy.dpeNumber) errors.push("dpe_number_required");
      if (!listing.energy.dpeDate || listing.energy.dpeDate < new Date("2021-07-01T00:00:00.000Z") || listing.energy.dpeDate > new Date()) errors.push("valid_dpe_date_required");
      if (!listing.energy.energyClass) errors.push("energy_class_required");
      if (!listing.energy.climateClass) errors.push("climate_class_required");
      if (listing.energy.annualCostMinMinor === null || listing.energy.annualCostMaxMinor === null) errors.push("annual_energy_cost_required");
      if (!listing.energy.energyPriceReferenceYears) errors.push("energy_price_reference_years_required");
      if (listing.property?.transactionType === "RENTAL" && listing.energy.energyClass === "G") warnings.push("rental_dpe_g_requires_eligibility_review");
    } else if (!listing.energy.exemptionReason) errors.push("dpe_exemption_reason_required");
  }

  const mediaRows = await prisma.$queryRawUnsafe<Array<{ count: bigint; coverUrl:string|null }>>(
    `SELECT COUNT(*)::bigint AS count,(SELECT lm2."publicUrl" FROM "ListingMedia" lm2 WHERE lm2."listingId"=$1 AND lm2."status"='READY' AND lm2."publicUrl" IS NOT NULL ORDER BY lm2."isCover" DESC,lm2."sortOrder" ASC,lm2."createdAt" ASC LIMIT 1) AS "coverUrl" FROM "ListingMedia" WHERE "listingId"=$1 AND "status"='READY'`,
    listing.id,
  );
  const mediaCount = Number(mediaRows[0]?.count ?? 0n);
  if (mediaCount === 0 && !["JOB", "SERVICE"].includes(listing.category.domain)) errors.push("ready_photo_required");

  const commerceRows = await prisma.$queryRawUnsafe<Array<{
    securePaymentEnabled: boolean;
    handDeliveryEnabled: boolean;
    mondialRelayEnabled: boolean;
    colissimoEnabled: boolean;
    packageWeightG: number | null;
    packageLengthCm: number | null;
    packageWidthCm: number | null;
    packageHeightCm: number | null;
  }>>(`SELECT * FROM "ListingCommerceSettings" WHERE "listingId"=$1 LIMIT 1`, listing.id);
  const commerce = commerceRows[0] ?? null;
  let importInfo: { sourceType: string; sourceUrl: string | null; createdAt: Date } | null = null;
  try {
    const imported = await prisma.$queryRawUnsafe<Array<{ sourceType: string; sourceUrl: string | null; createdAt: Date }>>(
      `SELECT "sourceType","sourceUrl","createdAt" FROM "ListingImportLog" WHERE "listingId"=$1 AND "userId"=$2 ORDER BY "createdAt" DESC LIMIT 1`,
      listing.id, userId,
    );
    importInfo = imported[0] ?? null;
  } catch {}
  const shippingSelected = Boolean(commerce?.mondialRelayEnabled || commerce?.colissimoEnabled);
  if (shippingSelected && !commerce?.packageWeightG) errors.push("package_weight_required");
  if (!isVacation && commerce && !commerce.handDeliveryEnabled && !commerce.mondialRelayEnabled && !commerce.colissimoEnabled && !["REAL_ESTATE", "VEHICLE", "JOB", "SERVICE"].includes(listing.category.domain)) warnings.push("no_delivery_method");

  const qualityIssues:Array<{code:string;label:string;step:number;severity:"HIGH"|"MEDIUM"|"LOW"}> = [];
  const requiredDefs=inheritedRequiredDefinitions.filter(attribute=>!(listing.category.domain === "REAL_ESTATE" && realEstateDedicatedKeys.has(attribute.key)));
  const filledRequiredCount=requiredDefs.filter(attribute=>setIds.has(attribute.id)).length;
  const requiredRatio=requiredDefs.length?filledRequiredCount/requiredDefs.length:1;
  let qualityScore=0;
  qualityScore += 10; // catégorie
  const titleLength=listing.title?.trim().length??0;
  qualityScore += titleLength>=20?15:titleLength>=10?11:titleLength>=5?6:0;
  if(titleLength<10)qualityIssues.push({code:"title_too_short",label:"Rendez le titre plus précis et descriptif.",step:0,severity:titleLength<5?"HIGH":"MEDIUM"});
  const descriptionLength=listing.description?.trim().length??0;
  qualityScore += descriptionLength>=300?20:descriptionLength>=160?17:descriptionLength>=80?13:descriptionLength>=20?7:0;
  if(descriptionLength<80)qualityIssues.push({code:"description_too_short",label:"Ajoutez davantage de détails utiles dans la description.",step:2,severity:descriptionLength<20?"HIGH":"MEDIUM"});
  qualityScore += Math.round(15*requiredRatio);
  if(requiredRatio<1)qualityIssues.push({code:"required_fields_missing",label:"Complétez toutes les caractéristiques obligatoires.",step:2,severity:"HIGH"});
  const locationReady=listing.category.domain==="REAL_ESTATE"?Boolean(listing.property):Boolean(listing.city&&listing.postalCode);
  qualityScore += locationReady?10:0;
  if(!locationReady)qualityIssues.push({code:"location_missing",label:"Complétez la localisation de l’annonce.",step:2,severity:"HIGH"});
  const priceReady=listing.priceMinor!==null||listing.category.domain==="SERVICE";
  qualityScore += priceReady?10:0;
  if(!priceReady)qualityIssues.push({code:"price_missing",label:"Renseignez un prix ou une rémunération cohérente.",step:3,severity:"HIGH"});
  if(["JOB","SERVICE"].includes(listing.category.domain)){qualityScore+=20;}else{
    qualityScore += mediaCount>=5?20:mediaCount>=3?16:mediaCount>=1?9:0;
    if(mediaCount===0)qualityIssues.push({code:"photos_missing",label:"Ajoutez au moins une photo de qualité.",step:1,severity:"HIGH"});
    else if(mediaCount<3)qualityIssues.push({code:"photos_few",label:"Ajoutez idéalement au moins 3 photos variées.",step:1,severity:"LOW"});
  }
  qualityScore=Math.max(0,Math.min(100,qualityScore));
  const qualityLevel=qualityScore>=85?"EXCELLENT":qualityScore>=70?"GOOD":qualityScore>=50?"FAIR":"WEAK";

  return {
    listing,
    ready: errors.length === 0,
    errors,
    warnings,
    quality:{score:qualityScore,level:qualityLevel,issues:qualityIssues},
    summary: {
      title: listing.title,
      description: listing.description,
      city: listing.city,
      postalCode: listing.postalCode,
      coverUrl: mediaRows[0]?.coverUrl ?? null,
      priceMinor: listing.priceMinor,
      currency: listing.currency,
      category: { name: listing.category.name, slug: listing.category.slug, domain: listing.category.domain },
      propertyTransactionType: listing.property?.transactionType ?? null,
      mediaCount,
      commerce,
      importInfo,
      isVacation,
    },
  };
}

export async function registerPublicationRoutes(app: FastifyInstance) {
  await ensureListingQualitySnapshotSchema();
  await ensurePublicationReceiptSchema();
  app.get("/listings/:id/publication-check", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    const result = await evaluateListing(params.data.id, user.id);
    if (!result) return reply.code(404).send({ error: "draft_not_found" });
    await saveListingQualitySnapshot(result.listing.id,user.id,result.quality).catch(()=>undefined);
    const phoneRows=await prisma.$queryRawUnsafe<Array<{phoneVerified:boolean}>>(`SELECT ("phoneVerifiedAt" IS NOT NULL) AS "phoneVerified" FROM "UserProfile" WHERE "userId"=$1 LIMIT 1`,user.id);
    const phoneVerified=Boolean(phoneRows[0]?.phoneVerified);
    const editSession=await editSessionByWorkingId(params.data.id,user.id);
    const duplicate=await findDuplicateListing(result.listing as unknown as DuplicateSource,user.id,[params.data.id,...(editSession?[editSession.originalListingId]:[])]);
    const fallbackComplianceId=editSession?.originalListingId??params.data.id;
    const [safetyRows,disclosureRows]=await Promise.all([
      prisma.$queryRawUnsafe<Array<{manufacturerName:string|null;manufacturerPostalAddress:string|null;manufacturerEmail:string|null;responsiblePersonName:string|null;responsiblePersonPostalAddress:string|null;responsiblePersonEmail:string|null;productIdentifier:string|null;model:string|null;ean:string|null;ceMarked:boolean|null;safetyWarning:string|null}>>(`SELECT "manufacturerName","manufacturerPostalAddress","manufacturerEmail","responsiblePersonName","responsiblePersonPostalAddress","responsiblePersonEmail","productIdentifier","model","ean","ceMarked","safetyWarning" FROM "ListingProductSafety" WHERE "listingId"=$1 OR "listingId"=$2 ORDER BY CASE WHEN "listingId"=$1 THEN 0 ELSE 1 END LIMIT 1`,params.data.id,fallbackComplianceId).catch(()=>[]),
      prisma.$queryRawUnsafe<Array<{sellerIsTrader:boolean;withdrawalRightApplies:boolean|null;withdrawalPeriodDays:number|null;withdrawalExceptionCode:string|null}>>(`SELECT "sellerIsTrader","withdrawalRightApplies","withdrawalPeriodDays","withdrawalExceptionCode" FROM "TraderConsumerDisclosure" WHERE "listingId"=$1 OR "listingId"=$2 ORDER BY CASE WHEN "listingId"=$1 THEN 0 ELSE 1 END LIMIT 1`,params.data.id,fallbackComplianceId).catch(()=>[]),
    ]);
    const lifecycleId=editSession?.originalListingId??params.data.id;
    const lifecycle=(await getListingLifecycles([lifecycleId]))[0]??null;
    const renewalRequired=Boolean(lifecycle&&lifecycle.expiresAt.getTime()<=Date.now());
    const issues=issueDetails(result.errors,result.warnings);
    return reply.send({ ready: result.ready&&!renewalRequired&&!duplicate, phoneVerified, phoneVerificationRequired:false, manualModerationRequired:!phoneVerified, sellerKind:user.kind, compliance:{productSafety:safetyRows[0]??null,consumerDisclosure:disclosureRows[0]??null}, errors: result.errors, warnings: result.warnings, issues, quality: result.quality, summary: result.summary, duplicate:duplicate?duplicatePayload(duplicate):null, renewalRequired, renewal:lifecycle?{expiresAt:lifecycle.expiresAt,freeRenewalAvailable:!lifecycle.freeRenewalUsed,costMinor:lifecycle.freeRenewalUsed?LISTING_RENEWAL_COST_MINOR:0,currency:LISTING_RENEWAL_CURRENCY}:null, edit:editSession?{isolated:true,originalListingId:editSession.originalListingId,previousStatus:editSession.previousStatus}:null });
  });

  app.post("/listings/:id/publish", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const params = idParams.safeParse(request.params);
    const body = consentSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "publication_consents_required" });
    const receiptRows=await prisma.$queryRawUnsafe<Array<{targetListingId:string;status:string;slug:string|null}>>(`SELECT "targetListingId","status","slug" FROM "ListingPublicationReceipt" WHERE "requestListingId"=$1 AND "userId"=$2 LIMIT 1`,params.data.id,user.id).catch(()=>[]);
    const receipt=receiptRows[0];
    if(receipt)return reply.send({ready:true,status:receipt.status,listing:{id:receipt.targetListingId,status:receipt.status,slug:receipt.slug},idempotent:true});
    const editSession=await editSessionByWorkingId(params.data.id,user.id);
    const policyBlock=await rejectListingAttemptForPolicy({request,userId:user.id,listingId:params.data.id});
    if(policyBlock)return reply.code(423).send({error:"listing_content_policy_violation",message:editSession?"Les modifications contiennent un contenu interdit. L’annonce active n’a pas été modifiée.":"L’annonce contient un contenu interdit ou des coordonnées directes. Elle n’a pas été publiée ni conservée comme brouillon.",reasons:policyBlock.signals,redirect:policyBlock.redirect});

    const result = await evaluateListing(params.data.id, user.id);
    if (!result) return reply.code(404).send({ error: "draft_not_found" });
    await saveListingQualitySnapshot(result.listing.id,user.id,result.quality).catch(()=>undefined);
    if (!result.ready) return reply.code(422).send({ ready: false, errors: result.errors, warnings: result.warnings, issues:issueDetails(result.errors,result.warnings) });
    const duplicate=await findDuplicateListing(result.listing as unknown as DuplicateSource,user.id,[params.data.id,...(editSession?[editSession.originalListingId]:[])]);
    if(duplicate)return reply.code(409).send({error:"duplicate_listing_exists",message:"Cette annonce existe déjà dans votre compte.",duplicate:duplicatePayload(duplicate)});
    const merchantProduct=Boolean(!result.summary.isVacation&&result.listing.priceMinor!==null&&!(["JOB","SERVICE","REAL_ESTATE","VEHICLE"] as string[]).includes(result.listing.category.domain));
    if(user.kind==="PROFESSIONNEL"&&merchantProduct){
      const fallbackComplianceId=editSession?.originalListingId??params.data.id;
      const safetyRows=await prisma.$queryRawUnsafe<Array<{manufacturerName:string|null;manufacturerPostalAddress:string|null;manufacturerEmail:string|null;productIdentifier:string|null;model:string|null;ean:string|null}>>(`SELECT "manufacturerName","manufacturerPostalAddress","manufacturerEmail","productIdentifier","model","ean" FROM "ListingProductSafety" WHERE "listingId"=$1 OR "listingId"=$2 ORDER BY CASE WHEN "listingId"=$1 THEN 0 ELSE 1 END LIMIT 1`,params.data.id,fallbackComplianceId).catch(()=>[]);
      const safety=safetyRows[0];
      const validSafety=Boolean(safety?.manufacturerName?.trim()&&safety?.manufacturerPostalAddress?.trim()&&safety?.manufacturerEmail?.trim()&&(safety?.productIdentifier?.trim()||safety?.model?.trim()||safety?.ean?.trim()));
      if(!validSafety)return reply.code(422).send({error:"product_safety_required",message:"Complétez les informations GPSR du fabricant et un identifiant produit avant publication."});
      const disclosureRows=await prisma.$queryRawUnsafe<Array<{sellerIsTrader:boolean;withdrawalRightApplies:boolean|null;withdrawalPeriodDays:number|null;withdrawalExceptionCode:string|null}>>(`SELECT "sellerIsTrader","withdrawalRightApplies","withdrawalPeriodDays","withdrawalExceptionCode" FROM "TraderConsumerDisclosure" WHERE "listingId"=$1 OR "listingId"=$2 ORDER BY CASE WHEN "listingId"=$1 THEN 0 ELSE 1 END LIMIT 1`,params.data.id,fallbackComplianceId).catch(()=>[]);
      const disclosure=disclosureRows[0];
      const validReturnPolicy=Boolean(disclosure?.sellerIsTrader&&disclosure.withdrawalRightApplies!==null&&(disclosure.withdrawalRightApplies===false?Boolean(disclosure.withdrawalExceptionCode?.trim()):Number(disclosure.withdrawalPeriodDays)>0));
      if(!validReturnPolicy)return reply.code(422).send({error:"consumer_return_policy_required",message:"Renseignez la politique de retour applicable à cette annonce professionnelle avant publication."});
    }
    const lifecycleId=editSession?.originalListingId??params.data.id;
    const lifecycle=(await getListingLifecycles([lifecycleId]))[0]??null;
    if(lifecycle&&lifecycle.expiresAt.getTime()<=Date.now())return reply.code(409).send({error:"listing_renewal_required",freeRenewalAvailable:!lifecycle.freeRenewalUsed,amountMinor:lifecycle.freeRenewalUsed?LISTING_RENEWAL_COST_MINOR:0,currency:LISTING_RENEWAL_CURRENCY,expiresAt:lifecycle.expiresAt});

    const originalForEdit=editSession?await prisma.listing.findFirst({where:{id:editSession.originalListingId,sellerId:user.id},select:{id:true,slug:true,publishedAt:true}}):null;
    if(editSession&&!originalForEdit)return reply.code(404).send({error:"edit_original_missing"});
    const targetId=editSession?.originalListingId??result.listing.id;
    const slug = originalForEdit?.slug ?? result.listing.slug ?? `${slugify(result.listing.title!)}-${randomBytes(4).toString("hex")}`;
    const consentId = randomUUID();
    const userAgent = String(request.headers["user-agent"] ?? "").slice(0, 500) || null;
    let oldMediaKeys:string[]=[];

    const listing = await prisma.$transaction(async (tx) => {
      if(editSession){const applied=await applyWorkingCopyToOriginal(tx,editSession);oldMediaKeys=applied.oldMediaKeys;}
      await tx.$executeRawUnsafe(
        `INSERT INTO "ListingPublicationConsent" ("id","listingId","userId","termsAccepted","rulesAccepted","accuracyConfirmed","professionalDisclosureConfirmed","ipHash","userAgent","createdAt") VALUES ($1,$2,$3,TRUE,TRUE,TRUE,TRUE,$4,$5,NOW())`,
        consentId, targetId, user.id, requestIpHash(request), userAgent,
      );
      // Always stage publication first. Phone-verified, low-risk listings are
      // released only by the delayed auto-approval worker; flagged listings stay pending.
      if(editSession)await tx.$executeRawUnsafe(`UPDATE "ModerationCase" SET "status"='CLOSED',"updatedAt"=CURRENT_TIMESTAMP WHERE "targetType"='LISTING' AND "targetId"=$1 AND "status" NOT IN ('RESOLVED','CLOSED')`,targetId).catch(()=>undefined);
      const pending = await tx.listing.update({ where: { id: targetId }, data: { status: "PENDING", slug, draftSavedAt:null } });
      await tx.$executeRawUnsafe(`INSERT INTO "ListingPublicationReceipt" ("requestListingId","targetListingId","userId","status","slug","createdAt") VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP) ON CONFLICT ("requestListingId") DO UPDATE SET "targetListingId"=EXCLUDED."targetListingId","userId"=EXCLUDED."userId","status"=EXCLUDED."status","slug"=EXCLUDED."slug"`,params.data.id,targetId,user.id,pending.status,pending.slug);
      await tx.$executeRawUnsafe(
        `INSERT INTO "ModerationCase" ("id","targetType","targetId","priority","riskScore")
         SELECT $1,'LISTING'::"ReportTargetType",$2,50,0
         WHERE NOT EXISTS (SELECT 1 FROM "ModerationCase" WHERE "targetType"='LISTING' AND "targetId"=$2 AND "status" NOT IN ('RESOLVED','CLOSED'))`,
        randomUUID(), targetId,
      );
      if(editSession){await tx.$executeRawUnsafe(`DELETE FROM "ListingEditSession" WHERE "workingListingId"=$1`,editSession.workingListingId);await tx.listing.delete({where:{id:editSession.workingListingId}});}
      return pending;
    });
    if(editSession)await finalizeEditSessionCleanup(editSession.workingListingId,user.id,oldMediaKeys);

    const autoApproval = listing.status === "PENDING" ? await scheduleTrustedListingAutoApproval(listing.id, user.id).catch(() => ({ scheduled:false as const, reason:"schedule_failed" })) : null;
    if(listing.status==="PENDING"){
      await queueAdminRoleEmail({
        roles:["SUPER_ADMIN","ADMIN"],
        eventKind:"ADMIN_LISTING_PENDING",
        title:"Nouvelle annonce en attente de validation",
        body:`Une nouvelle annonce « ${listing.title ?? "Sans titre"} » soumise par ${user.email} attend une validation dans la file de modération.`,
        actionUrl:"https://admin.petitannonces.fr/moderation",
        metadata:{purpose:"ADMIN_LISTING_PENDING",listingId:listing.id,sellerId:user.id,autoApprovalScheduled:Boolean(autoApproval?.scheduled)},
      }).catch(error=>request.log.warn({error,listingId:listing.id},"admin pending listing email queue failed"));
    }
    if (listing.status === "PUBLISHED") {
      await activateListingLifetime(listing.id, listing.publishedAt ?? new Date());
      if(!editSession)await rewardReferralAfterFirstPublishedListing(user.id).catch(error=>request.log.warn({error,userId:user.id},"referral reward failed after listing publication"));
    } else if (listing.status === "PENDING" && !autoApproval?.scheduled) {
      let moderators = await prisma.user.findMany({
        where: { status: "ACTIVE", roles: { some: { role: "MODERATOR" } }, NOT: { roles: { some: { role: { in: ["SUPER_ADMIN","ADMIN"] } } } } },
        select: { id: true }, take: 20,
      });
      for (const moderator of moderators) {
        await queueTransactionalEmail({
          userId: moderator.id,
          eventKind: "MODERATION_LISTING_PENDING",
          title: "Nouvelle annonce à modérer",
          body: `Une nouvelle annonce « ${listing.title ?? "Sans titre"} » attend votre vérification dans la file de modération.`,
          actionUrl: "https://admin.petitannonces.fr/moderation",
          metadata: { purpose: "MODERATION_REVIEW", listingId: listing.id },
        });
      }
    }

    return reply.send({ ready: true, status: listing.status, listing, warnings: result.warnings, moderation: { required: listing.status === "PENDING", autoApproval: autoApproval?.scheduled ? { scheduled:true, eligibleAt:autoApproval.eligibleAt, delaySeconds:autoApproval.delaySeconds } : { scheduled:false } } });
  });
}
