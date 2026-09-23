import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { calculateTrustScore } from "./trust-score.js";
import { getUserReputation } from "./reputation.js";
import { getProfessionalSector } from "./pro-suite.js";
async function ensureListingViewTable(){
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ListingView" ("id" text PRIMARY KEY,"listingId" text NOT NULL,"visitorHash" text NOT NULL,"viewedOn" date NOT NULL DEFAULT CURRENT_DATE,"createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "ListingView_listing_visitor_day_key"`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ListingView_listing_idx" ON "ListingView" ("listingId")`);
}


function readAttributeValue(value: { valueText: string | null; valueNumber: number | null; valueBoolean: boolean | null; valueJson: unknown }) {
  if (value.valueText !== null) return value.valueText;
  if (value.valueNumber !== null) return value.valueNumber;
  if (value.valueBoolean !== null) return value.valueBoolean;
  return value.valueJson;
}
async function ensureVehicleHistorySnapshotTable(){
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "VehicleHistorySnapshot" (
    "listingId" text PRIMARY KEY,
    "registrationPlateHash" text NOT NULL,
    "source" text NOT NULL,
    "checkedAt" timestamptz NOT NULL,
    "historyJson" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "VehicleHistorySnapshot_plate_idx" ON "VehicleHistorySnapshot" ("registrationPlateHash","checkedAt" DESC)`);
}
async function ensureVehicleOfficialReportTable(){await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "VehicleOfficialReport" ("listingId" text PRIMARY KEY,"histovecUrl" text,"createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP)`)}

export async function registerPublicListingRoutes(app: FastifyInstance) {
  app.post("/public/listings/:id/view", async (request, reply) => {
    const params=z.object({id:z.string().min(1)}).safeParse(request.params);
    const body=z.object({visitorId:z.string().min(8).max(160)}).safeParse(request.body);
    if(!params.success||!body.success)return reply.code(400).send({error:"invalid_request"});
    const listing=await prisma.listing.findFirst({where:{id:params.data.id,status:{in:["PUBLISHED","SOLD","EXPIRED"]}},select:{id:true}});
    if(!listing)return reply.code(404).send({error:"listing_not_found"});
    await ensureListingViewTable();
    const visitorHash=createHash("sha256").update(`${listing.id}:${body.data.visitorId}`).digest("hex");
    await prisma.$executeRawUnsafe(`INSERT INTO "ListingView" ("id","listingId","visitorHash","viewedOn","createdAt") VALUES ($1,$2,$3,CURRENT_DATE,NOW())`,randomUUID(),listing.id,visitorHash);
    const rows=await prisma.$queryRawUnsafe<Array<{count:bigint}>>(`SELECT COUNT(*)::bigint AS "count" FROM "ListingView" WHERE "listingId"=$1`,listing.id);
    return reply.send({count:Number(rows[0]?.count??0n)});
  });

  app.get("/public/listings/:slug", async (request, reply) => {
    const params = z.object({ slug: z.string().min(1).max(180) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    const listing = await prisma.listing.findFirst({
      where: { slug: params.data.slug, status: { in: ["PUBLISHED","SOLD","EXPIRED"] } },
      include: {
        category: { include: { parent: { include: { parent: true } } } }, attributes: { include: { attribute: true } }, vehicle: true, property: true, energy: true,
        store: { select: { id:true, name:true, slug:true, logoUrl:true, isVerified:true, status:true } },
        seller: { select: { id: true, kind: true, createdAt: true, emailVerifiedAt: true, profile: { select: { displayName: true, firstName: true, avatarUrl: true } }, business: { select: { tradeName: true, legalName: true, verificationStatus: true, siret: true } }, stores: { where: { status: "ACTIVE" }, take: 1, select: { id:true, name: true, slug: true, logoUrl: true, isVerified: true } } } },
      },
    });
    if (!listing) return reply.code(404).send({ error: "listing_not_found" });
    const publicStore=listing.store?.status==="ACTIVE"?listing.store:null;
    const sellerName = publicStore?.name ?? listing.seller.business?.tradeName ?? listing.seller.profile?.displayName ?? listing.seller.profile?.firstName ?? "Annonceur Petit Annonces";
    const attributes = listing.attributes.map((item) => ({ key: item.attribute.key, label: item.attribute.label, unit: item.attribute.unit, value: readAttributeValue(item) }));
    const breadcrumb = [listing.category.parent?.parent, listing.category.parent, listing.category].filter(Boolean).map((item) => ({ name: item!.name, slug: item!.slug }));
    if(listing.vehicle){await ensureVehicleHistorySnapshotTable();await ensureVehicleOfficialReportTable();}
    const [media, commerceRows, reviewSummary, recentReviews, completedRows, sellerPaymentRows, promotions, priceHistory, vehicleHistoryRows, vehicleOfficialRows, productSafetyRows, consumerDisclosureRows] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{id:string;publicUrl:string;mimeType:string;width:number|null;height:number|null;altText:string|null;isCover:boolean;sortOrder:number}>>(`SELECT "id","publicUrl","mimeType","width","height","altText","isCover","sortOrder" FROM "ListingMedia" WHERE "listingId"=$1 AND "status"='READY' AND "publicUrl" IS NOT NULL ORDER BY "isCover" DESC, "sortOrder" ASC, "createdAt" ASC`, listing.id),
      prisma.$queryRawUnsafe<Array<{acceptsOffers:boolean;securePaymentEnabled:boolean;handDeliveryEnabled:boolean;mondialRelayEnabled:boolean;colissimoEnabled:boolean}>>(`SELECT "acceptsOffers","securePaymentEnabled","handDeliveryEnabled","mondialRelayEnabled","colissimoEnabled" FROM "ListingCommerceSettings" WHERE "listingId"=$1 LIMIT 1`, listing.id),
      prisma.$queryRawUnsafe<Array<{count:bigint;average:number|null}>>(`SELECT COUNT(*)::bigint AS "count", AVG("rating")::float AS "average" FROM "MarketplaceReview" r JOIN "MarketplaceOrder" o ON o."id"=r."orderId" AND o."status"='COMPLETED' WHERE r."revieweeId"=$1`, listing.seller.id),
      prisma.$queryRawUnsafe<Array<{id:string;rating:number;comment:string|null;createdAt:Date;reviewerName:string}>>(`SELECT r."id",r."rating",r."comment",r."createdAt",COALESCE(p."displayName",p."firstName",'Membre Petit Annonces') AS "reviewerName" FROM "MarketplaceReview" r JOIN "MarketplaceOrder" o ON o."id"=r."orderId" AND o."status"='COMPLETED' LEFT JOIN "UserProfile" p ON p."userId"=r."reviewerId" WHERE r."revieweeId"=$1 AND r."comment" IS NOT NULL AND length(trim(r."comment"))>0 ORDER BY r."createdAt" DESC LIMIT 3`,listing.seller.id),
      prisma.$queryRawUnsafe<Array<{count:bigint}>>(`SELECT COUNT(*)::bigint AS "count" FROM "MarketplaceOrder" WHERE "sellerId"=$1 AND "status"='COMPLETED'`,listing.seller.id),
      prisma.$queryRawUnsafe<Array<{onboardingStatus:string;payoutsEnabled:boolean;detailsSubmitted:boolean}>>(`SELECT "onboardingStatus","payoutsEnabled","detailsSubmitted" FROM "MarketplaceSellerAccount" WHERE "userId"=$1 LIMIT 1`,listing.seller.id),
      prisma.$queryRawUnsafe<Array<{id:string;code:string;type:string;name:string;startsAt:Date|null;endsAt:Date|null}>>(`SELECT lp."id",pp."code",pp."type"::text AS "type",pp."name",lp."startsAt",lp."endsAt" FROM "ListingPromotion" lp JOIN "PromotionProduct" pp ON pp."id"=lp."productId" WHERE lp."listingId"=$1 AND lp."status"='ACTIVE' AND (lp."startsAt" IS NULL OR lp."startsAt"<=CURRENT_TIMESTAMP) AND (lp."endsAt" IS NULL OR lp."endsAt">CURRENT_TIMESTAMP) ORDER BY lp."createdAt" DESC`,listing.id),
      prisma.$queryRawUnsafe<Array<{oldPriceMinor:number;newPriceMinor:number;currency:string;changedAt:Date}>>(`SELECT "oldPriceMinor","newPriceMinor","currency","changedAt" FROM "ListingPriceHistory" WHERE "listingId"=$1 ORDER BY "changedAt" DESC LIMIT 6`,listing.id).catch(()=>[]),
      listing.vehicle?prisma.$queryRawUnsafe<Array<{source:string;checkedAt:Date;historyJson:any}>>(`SELECT "source","checkedAt","historyJson" FROM "VehicleHistorySnapshot" WHERE "listingId"=$1 LIMIT 1`,listing.id).catch(()=>[]):Promise.resolve([]),
      listing.vehicle?prisma.$queryRawUnsafe<Array<{histovecUrl:string|null}>>(`SELECT "histovecUrl" FROM "VehicleOfficialReport" WHERE "listingId"=$1 LIMIT 1`,listing.id).catch(()=>[]):Promise.resolve([]),
      prisma.$queryRawUnsafe<Array<{manufacturerName:string|null;productIdentifier:string|null;model:string|null;ean:string|null}>>(`SELECT "manufacturerName","productIdentifier","model","ean" FROM "ListingProductSafety" WHERE "listingId"=$1 LIMIT 1`,listing.id).catch(()=>[]),
      prisma.$queryRawUnsafe<Array<{sellerIsTrader:boolean;withdrawalRightApplies:boolean|null;withdrawalPeriodDays:number|null;withdrawalExceptionCode:string|null}>>(`SELECT "sellerIsTrader","withdrawalRightApplies","withdrawalPeriodDays","withdrawalExceptionCode" FROM "TraderConsumerDisclosure" WHERE "listingId"=$1 LIMIT 1`,listing.id).catch(()=>[]),
    ]);
    await ensureListingViewTable();
    const viewRows=await prisma.$queryRawUnsafe<Array<{count:bigint}>>(`SELECT COUNT(*)::bigint AS "count" FROM "ListingView" WHERE "listingId"=$1`,listing.id);
    const viewCount=Number(viewRows[0]?.count??0n);
    const commerce = commerceRows[0];
    const shippable = !["VEHICLE","REAL_ESTATE","JOB","SERVICE"].includes(listing.category.domain);
    const siretVerified = listing.seller.business?.verificationStatus === "VERIFIED" && Boolean(listing.seller.business?.siret);
    const verified = siretVerified || publicStore?.isVerified === true;
    const reviewCount = Number(reviewSummary[0]?.count ?? 0n);
    const reviewAverage = reviewSummary[0]?.average ?? null;
    const completedSales = Number(completedRows[0]?.count ?? 0n);
    const sellerPayment = sellerPaymentRows[0];
    const paymentReady = sellerPayment?.onboardingStatus === "ACTIVE" && sellerPayment.payoutsEnabled === true && sellerPayment.detailsSubmitted === true;
    const trust = calculateTrustScore({ verified, emailVerified:Boolean(listing.seller.emailVerifiedAt), reviewCount, reviewAverage, completedSales, memberSince: listing.seller.createdAt });
    const reputation=await getUserReputation(listing.seller.id);
    const professionalSector=listing.seller.kind==="PROFESSIONNEL"?await getProfessionalSector(listing.seller.id):null;
    const appointmentBookingEnabled=professionalSector==="AUTOMOBILE"&&listing.category.domain==="VEHICLE"||professionalSector==="IMMOBILIER"&&listing.category.domain==="REAL_ESTATE";
    const publicVehicle=listing.vehicle?{
      make:listing.vehicle.make,model:listing.vehicle.model,version:listing.vehicle.version,firstRegistrationDate:listing.vehicle.firstRegistrationDate,modelYear:listing.vehicle.modelYear,
      fuel:listing.vehicle.fuel,transmission:listing.vehicle.transmission,bodyType:listing.vehicle.bodyType,powerKw:listing.vehicle.powerKw,fiscalPowerCv:listing.vehicle.fiscalPowerCv,
      co2GKm:listing.vehicle.co2GKm,euroStandard:listing.vehicle.euroStandard,seats:listing.vehicle.seats,doors:listing.vehicle.doors,color:listing.vehicle.color,mileageKm:listing.vehicle.mileageKm,
      dataVerifiedAt:listing.vehicle.dataVerifiedAt,
    }:null;
    const historyRow=vehicleHistoryRows[0]??null;const history:any=historyRow?.historyJson??{};
    const vehicleHistory=listing.vehicle?{
      checkedAt:historyRow?.checkedAt??listing.vehicle.dataVerifiedAt??null,
      firstRegistrationDate:typeof history.firstRegistrationDate==="string"?history.firstRegistrationDate:listing.vehicle.firstRegistrationDate?.toISOString()??null,
      sraClass:typeof history.sraClass==="string"?history.sraClass:null,
      theftRiskLevel:typeof history.theftRiskLevel==="string"?history.theftRiskLevel:null,
      originalNewValueEuro:typeof history.originalNewValueEuro==="number"&&Number.isFinite(history.originalNewValueEuro)?history.originalNewValueEuro:null,
      ownerChanges:Number.isInteger(history.ownerChanges)?history.ownerChanges:null,
      controlledDamageCount:Number.isInteger(history.controlledDamageCount)?history.controlledDamageCount:null,
      administrativeStatus:typeof history.administrativeStatus==="string"?history.administrativeStatus:null,
      technicalInspectionDate:typeof history.technicalInspectionDate==="string"?history.technicalInspectionDate:null,
      technicalInspectionResult:typeof history.technicalInspectionResult==="string"?history.technicalInspectionResult:null,
      mileageKm:Number.isInteger(history.mileageKm)?history.mileageKm:null,
      officialHistovecUrl:vehicleOfficialRows[0]?.histovecUrl??null,
    }:null;
    return reply.send({ listing: {
      id: listing.id, slug: listing.slug, title: listing.title, description: listing.description, priceMinor: listing.priceMinor, currency: listing.currency, status: listing.status, updatedAt: listing.updatedAt, viewCount,
      city: listing.city, postalCode: listing.postalCode, region: listing.region, latitude: listing.latitude, longitude: listing.longitude, publishedAt: listing.publishedAt,
      category: { id: listing.category.id, name: listing.category.name, slug: listing.category.slug, domain: listing.category.domain }, breadcrumb, attributes,
      media: media.map((item) => ({ id: item.id, url: item.publicUrl, mimeType: item.mimeType, width: item.width, height: item.height, altText: item.altText, isCover: item.isCover })),
      vehicle: publicVehicle, vehicleHistory, property: listing.property, energy: listing.energy, promotions,
      priceHistory: priceHistory.map(item=>({oldPriceMinor:item.oldPriceMinor,newPriceMinor:item.newPriceMinor,currency:item.currency,changedAt:item.changedAt})),
      productSafety: productSafetyRows[0]??null,
      consumerDisclosure: consumerDisclosureRows[0]??null,
      commerce: { acceptsOffers: commerce?.acceptsOffers !== false, securePaymentEnabled: commerce?.securePaymentEnabled === true, handDeliveryEnabled: commerce?.handDeliveryEnabled === true, mondialRelayEnabled: commerce?.mondialRelayEnabled === true, colissimoEnabled: commerce?.colissimoEnabled === true, shippingEnabled: shippable && (commerce?.mondialRelayEnabled === true || commerce?.colissimoEnabled === true) },
      seller: { id: listing.seller.id, kind: listing.seller.kind, name: sellerName, siretVerified, professionalSector, appointmentBookingEnabled, avatarUrl: listing.seller.profile?.avatarUrl ?? publicStore?.logoUrl ?? null, memberSince: listing.seller.createdAt, verified, phoneVerified:Boolean(reputation?.metrics.phoneVerified), paymentReady, store: publicStore?{id:publicStore.id,name:publicStore.name,slug:publicStore.slug,logoUrl:publicStore.logoUrl,isVerified:publicStore.isVerified}:null, completedSales, trust:reputation?.trust??trust, reputation, reviews: { count: reviewCount, average: reviewAverage, recent: recentReviews } },
    }});
  });
}