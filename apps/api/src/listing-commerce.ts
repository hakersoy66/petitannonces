import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireListingUser } from "./listing-auth.js";
import { getSellerPayoutReadiness } from "./marketplace-payout-provider.js";
import { MARKETPLACE_COMMISSION_RATE_BPS, marketplaceQuote, type CommissionPayer } from "./marketplace-fees.js";
import { categoryBelongsToRootSlug } from "./category-attributes.js";

const paramsSchema = z.object({ id: z.string().min(1) });
const priceInsightQuerySchema = z.object({ priceMinor: z.coerce.number().int().nonnegative().max(100_000_000).optional() });

const MARKET_STOP_WORDS = new Set(["avec","dans","pour","sur","une","des","les","le","la","un","du","de","et","en","a","au","aux","très","tres","bon","bonne","etat","état","vend","vente","neuf","neuve"]);
function marketTokens(value:string|null|undefined){return new Set((value??"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").split(" ").map(x=>x.trim()).filter(x=>x.length>=3&&!MARKET_STOP_WORDS.has(x)))}
function tokenSimilarity(a:string|null|undefined,b:string|null|undefined){const left=marketTokens(a),right=marketTokens(b);if(!left.size||!right.size)return 0;let common=0;for(const token of left)if(right.has(token))common++;return common/Math.max(left.size,right.size)}
function textEq(a:string|null|undefined,b:string|null|undefined){return Boolean(a&&b&&a.trim().toLowerCase()===b.trim().toLowerCase())}
function numericNear(a:number|null|undefined,b:number|null|undefined,tolerance:number){if(a==null||b==null||a<=0||b<=0)return false;return Math.abs(a-b)/Math.max(a,b)<=tolerance}
function quantile(values:number[],q:number){if(!values.length)return 0;const pos=(values.length-1)*q;const base=Math.floor(pos),rest=pos-base;const next=values[Math.min(values.length-1,base+1)]!;return Math.round(values[base]!+(next-values[base]!)*rest)}
function roundMarketMinor(value:number){const step=value>=10_000_000?100_000:value>=1_000_000?10_000:value>=100_000?1_000:100;return Math.max(step,Math.round(value/step)*step)}

const settingsSchema = z.object({
  priceMinor: z.number().int().nonnegative().max(100_000_000).nullable(),
  acceptsOffers: z.boolean(),
  securePaymentEnabled: z.boolean(),
  commissionPayer: z.enum(["SELLER", "BUYER"]),
  handDeliveryEnabled: z.boolean(),
  mondialRelayEnabled: z.boolean(),
  colissimoEnabled: z.boolean(),
  packageWeightG: z.number().int().positive().max(30_000).nullish(),
  packageLengthCm: z.number().int().positive().max(150).nullish(),
  packageWidthCm: z.number().int().positive().max(150).nullish(),
  packageHeightCm: z.number().int().positive().max(150).nullish(),
});


async function sellerPaymentReady(userId:string){
  try{const readiness=await getSellerPayoutReadiness(userId);return readiness.sellerReady&&readiness.providerOperational}catch{return false}
}
type CommerceRow = {
  listingId: string;
  acceptsOffers: boolean;
  securePaymentEnabled: boolean;
  commissionPayer: CommissionPayer;
  handDeliveryEnabled: boolean;
  mondialRelayEnabled: boolean;
  colissimoEnabled: boolean;
  packageWeightG: number | null;
  packageLengthCm: number | null;
  packageWidthCm: number | null;
  packageHeightCm: number | null;
};

export async function registerListingCommerceRoutes(app: FastifyInstance) {
  app.get("/listings/:id/commerce-settings", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });

    const listing = await prisma.listing.findFirst({
      where: { id: params.data.id, sellerId: user.id },
      select: { id: true, priceMinor: true, currency: true, categoryId:true, category: { select: { domain: true } }, property: { select: { transactionType: true } } },
    });
    if (!listing) return reply.code(404).send({ error: "listing_not_found" });
    const isVacation=await categoryBelongsToRootSlug(listing.categoryId,"vacances");

    const rows = await prisma.$queryRawUnsafe<CommerceRow[]>(
      `SELECT * FROM "ListingCommerceSettings" WHERE "listingId"=$1 LIMIT 1`,
      listing.id,
    );
    const securePaymentAllowed = !isVacation && !["VEHICLE", "REAL_ESTATE"].includes(listing.category.domain);
    const storedSettings = rows[0] ?? {
      listingId: listing.id,
      acceptsOffers: !isVacation,
      securePaymentEnabled: securePaymentAllowed,
      commissionPayer: "SELLER" as CommissionPayer,
      handDeliveryEnabled: !isVacation,
      mondialRelayEnabled: false,
      colissimoEnabled: false,
      packageWeightG: null,
      packageLengthCm: null,
      packageWidthCm: null,
      packageHeightCm: null,
    };
    const settings: CommerceRow = { ...storedSettings, acceptsOffers: !isVacation && storedSettings.acceptsOffers, securePaymentEnabled: securePaymentAllowed && storedSettings.securePaymentEnabled, handDeliveryEnabled: !isVacation && storedSettings.handDeliveryEnabled, mondialRelayEnabled: !isVacation && storedSettings.mondialRelayEnabled, colissimoEnabled: !isVacation && storedSettings.colissimoEnabled };

    let importInfo: { sourceType: string; sourceUrl: string | null; createdAt: Date } | null = null;
    try {
      const rows = await prisma.$queryRawUnsafe<Array<{ sourceType: string; sourceUrl: string | null; createdAt: Date }>>(
        `SELECT "sourceType","sourceUrl","createdAt" FROM "ListingImportLog" WHERE "listingId"=$1 AND "userId"=$2 ORDER BY "createdAt" DESC LIMIT 1`,
        listing.id, user.id,
      );
      importInfo = rows[0] ?? null;
    } catch {}

    const feePreview=listing.priceMinor!=null&&listing.priceMinor>0?marketplaceQuote(listing.priceMinor,0,settings.commissionPayer):null;
    return reply.send({ listing: { priceMinor: listing.priceMinor, currency: listing.currency, domain: listing.category.domain, transactionType: listing.property?.transactionType ?? null, isVacation }, settings, configured:Boolean(rows[0]), importInfo, sellerPaymentReady: await sellerPaymentReady(user.id), commission:{rateBps:MARKETPLACE_COMMISSION_RATE_BPS,ratePercent:MARKETPLACE_COMMISSION_RATE_BPS/100,preview:feePreview} });
  });

  app.get("/listings/:id/price-insight", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const params = paramsSchema.safeParse(request.params);
    const query = priceInsightQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) return reply.code(400).send({ error: "invalid_request" });

    const listing = await prisma.listing.findFirst({
      where: { id: params.data.id, sellerId: user.id },
      select: {
        id:true,title:true,priceMinor:true,categoryId:true,city:true,
        category:{select:{domain:true,name:true}},
        vehicle:{select:{make:true,model:true,modelYear:true,mileageKm:true}},
        property:{select:{transactionType:true,propertyType:true,surfaceM2:true,rooms:true}},
      },
    });
    if (!listing) return reply.code(404).send({ error: "listing_not_found" });

    const candidates = await prisma.listing.findMany({
      where: {
        id:{not:listing.id}, sellerId:{not:user.id}, categoryId:listing.categoryId,
        status:"PUBLISHED", currency:"EUR", priceMinor:{gt:0},
      },
      orderBy:[{publishedAt:"desc"},{createdAt:"desc"}],
      take:120,
      select:{
        id:true,title:true,priceMinor:true,city:true,
        vehicle:{select:{make:true,model:true,modelYear:true,mileageKm:true}},
        property:{select:{transactionType:true,propertyType:true,surfaceM2:true,rooms:true}},
      },
    });

    if (candidates.length < 3) return reply.send({ available:false, sampleSize:candidates.length, reason:"not_enough_comparables" });

    const ranked = candidates.map(candidate=>{
      let score=2 + tokenSimilarity(listing.title,candidate.title)*6;
      if (listing.city && candidate.city && textEq(listing.city,candidate.city)) score+=0.5;
      if (listing.category.domain==="VEHICLE" && listing.vehicle){
        if (listing.vehicle.make && candidate.vehicle?.make) score+=textEq(listing.vehicle.make,candidate.vehicle.make)?5:-2;
        if (listing.vehicle.model && candidate.vehicle?.model) score+=textEq(listing.vehicle.model,candidate.vehicle.model)?7:-2;
        if (listing.vehicle.modelYear && candidate.vehicle?.modelYear && Math.abs(listing.vehicle.modelYear-candidate.vehicle.modelYear)<=2) score+=1.5;
        if (numericNear(listing.vehicle.mileageKm,candidate.vehicle?.mileageKm,0.35)) score+=1;
      }
      if (listing.category.domain==="REAL_ESTATE" && listing.property){
        if (candidate.property?.transactionType) score+=candidate.property.transactionType===listing.property.transactionType?6:-8;
        if (candidate.property?.propertyType) score+=textEq(listing.property.propertyType,candidate.property.propertyType)?4:-3;
        if (numericNear(listing.property.surfaceM2,candidate.property?.surfaceM2,0.35)) score+=2;
        if (listing.property.rooms!=null && candidate.property?.rooms===listing.property.rooms) score+=1;
      }
      return {candidate,score};
    }).sort((a,b)=>b.score-a.score);

    let selected=ranked;
    let basis:"vehicle_model"|"vehicle_make"|"property_similar"|"title_similar"|"category"="category";
    if (listing.category.domain==="VEHICLE" && listing.vehicle){
      const sameModel=ranked.filter(x=>textEq(listing.vehicle?.make,x.candidate.vehicle?.make)&&textEq(listing.vehicle?.model,x.candidate.vehicle?.model));
      const sameMake=ranked.filter(x=>textEq(listing.vehicle?.make,x.candidate.vehicle?.make));
      if (sameModel.length>=3){selected=sameModel;basis="vehicle_model"}
      else if (sameMake.length>=3){selected=sameMake;basis="vehicle_make"}
    } else if (listing.category.domain==="REAL_ESTATE" && listing.property){
      const propertyMatches=ranked.filter(x=>x.candidate.property?.transactionType===listing.property?.transactionType&&textEq(listing.property?.propertyType,x.candidate.property?.propertyType)&&numericNear(listing.property?.surfaceM2,x.candidate.property?.surfaceM2,0.45));
      const propertyTypeMatches=ranked.filter(x=>x.candidate.property?.transactionType===listing.property?.transactionType&&textEq(listing.property?.propertyType,x.candidate.property?.propertyType));
      if (propertyMatches.length>=3){selected=propertyMatches;basis="property_similar"}
      else if (propertyTypeMatches.length>=3){selected=propertyTypeMatches;basis="property_similar"}
    } else {
      const titleMatches=ranked.filter(x=>tokenSimilarity(listing.title,x.candidate.title)>=0.2);
      if (titleMatches.length>=3){selected=titleMatches;basis="title_similar"}
    }

    selected=selected.slice(0,30);
    const prices=selected.map(x=>x.candidate.priceMinor).filter((x):x is number=>typeof x==="number"&&x>0).sort((a,b)=>a-b);
    if (prices.length<3) return reply.send({available:false,sampleSize:prices.length,reason:"not_enough_comparables"});
    const trimmed=prices.length>=8?prices.filter((value)=>value>=quantile(prices,0.1)&&value<=quantile(prices,0.9)):prices;
    const medianRaw=quantile(trimmed,0.5);
    let lowRaw=quantile(trimmed,0.25),highRaw=quantile(trimmed,0.75);
    if (lowRaw>=highRaw){lowRaw=Math.round(medianRaw*0.9);highRaw=Math.round(medianRaw*1.1)}
    const medianMinor=roundMarketMinor(medianRaw),rangeLowMinor=roundMarketMinor(lowRaw),rangeHighMinor=roundMarketMinor(highRaw);
    const enteredPriceMinor=query.data.priceMinor??listing.priceMinor??null;
    let position:"unknown"|"very_low"|"low"|"fair"|"high"|"very_high"="unknown";
    let differencePercent:number|null=null;
    if (enteredPriceMinor!=null&&enteredPriceMinor>0&&medianMinor>0){
      differencePercent=Math.round(((enteredPriceMinor-medianMinor)/medianMinor)*100);
      if (enteredPriceMinor<medianMinor*0.65)position="very_low";
      else if (enteredPriceMinor<rangeLowMinor)position="low";
      else if (enteredPriceMinor>medianMinor*1.35)position="very_high";
      else if (enteredPriceMinor>rangeHighMinor)position="high";
      else position="fair";
    }
    const messages={
      unknown:"Comparez votre prix avec les annonces similaires publiées sur Petit Annonces.",
      very_low:"Votre prix est nettement plus bas que les annonces comparables. Vérifiez le montant pour éviter de sous-évaluer votre annonce.",
      low:"Votre prix est sous la fourchette habituelle des annonces comparables.",
      fair:"Votre prix se situe dans la fourchette observée des annonces comparables.",
      high:"Votre prix est au-dessus de la fourchette habituelle des annonces comparables.",
      very_high:"Votre prix est nettement plus élevé que les annonces comparables. Un prix plus proche du marché peut améliorer vos chances de contact.",
    } as const;
    const basisLabels={vehicle_model:"Même marque et modèle",vehicle_make:"Même marque",property_similar:"Biens immobiliers similaires",title_similar:"Titres et catégorie similaires",category:"Même catégorie"} as const;
    const confidence=(basis==="vehicle_model"||basis==="property_similar")&&prices.length>=5?"high":basis!=="category"&&prices.length>=5?"medium":"low";
    return reply.send({
      available:true,sampleSize:prices.length,basis,basisLabel:basisLabels[basis],confidence,
      medianMinor,rangeLowMinor,rangeHighMinor,enteredPriceMinor,position,differencePercent,message:messages[position],
    });
  });

  app.put("/listings/:id/commerce-settings", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const params = paramsSchema.safeParse(request.params);
    const body = settingsSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request", details: body.success ? undefined : body.error.flatten() });

    const listing = await prisma.listing.findFirst({
      where: { id: params.data.id, sellerId: user.id, status: { in: ["DRAFT", "PENDING", "PUBLISHED"] } },
      select: { id: true, categoryId:true, category: { select: { domain: true } } },
    });
    if (!listing) return reply.code(404).send({ error: "listing_not_found" });
    const isVacation=await categoryBelongsToRootSlug(listing.categoryId,"vacances");
    if (body.data.priceMinor === null && listing.category.domain !== "SERVICE") return reply.code(400).send({ error: "price_required" });
    const securePaymentAllowed = !isVacation && !["VEHICLE", "REAL_ESTATE"].includes(listing.category.domain);
    const securePaymentEnabled = securePaymentAllowed && body.data.securePaymentEnabled;
    if (body.data.priceMinor === null && securePaymentEnabled) return reply.code(400).send({ error: "secure_payment_requires_price" });

    const isShippable = !isVacation && !["VEHICLE", "REAL_ESTATE", "JOB", "SERVICE"].includes(listing.category.domain);
    if (!isShippable && (body.data.mondialRelayEnabled || body.data.colissimoEnabled)) {
      return reply.code(400).send({ error: "shipping_not_supported_for_category" });
    }
    if (isShippable && (body.data.mondialRelayEnabled || body.data.colissimoEnabled)) {
      if (body.data.packageWeightG == null) return reply.code(400).send({ error: "package_weight_required" });
    }
    if (!body.data.handDeliveryEnabled && !body.data.mondialRelayEnabled && !body.data.colissimoEnabled && securePaymentEnabled) {
      return reply.code(400).send({ error: "fulfillment_method_required" });
    }

    await prisma.$transaction(async (tx) => {
      await tx.listing.update({ where: { id: listing.id }, data: { priceMinor: body.data.priceMinor, currency: "EUR" } });
      await tx.$executeRawUnsafe(
        `INSERT INTO "ListingCommerceSettings" (
          "listingId","acceptsOffers","securePaymentEnabled","commissionPayer","handDeliveryEnabled","mondialRelayEnabled","colissimoEnabled",
          "packageWeightG","packageLengthCm","packageWidthCm","packageHeightCm","createdAt","updatedAt"
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())
        ON CONFLICT ("listingId") DO UPDATE SET
          "acceptsOffers"=EXCLUDED."acceptsOffers",
          "securePaymentEnabled"=EXCLUDED."securePaymentEnabled",
          "commissionPayer"=EXCLUDED."commissionPayer",
          "handDeliveryEnabled"=EXCLUDED."handDeliveryEnabled",
          "mondialRelayEnabled"=EXCLUDED."mondialRelayEnabled",
          "colissimoEnabled"=EXCLUDED."colissimoEnabled",
          "packageWeightG"=EXCLUDED."packageWeightG",
          "packageLengthCm"=EXCLUDED."packageLengthCm",
          "packageWidthCm"=EXCLUDED."packageWidthCm",
          "packageHeightCm"=EXCLUDED."packageHeightCm",
          "updatedAt"=NOW()`,
        listing.id,
        isVacation ? false : body.data.acceptsOffers,
        securePaymentEnabled,
        body.data.commissionPayer,
        isVacation ? false : body.data.handDeliveryEnabled,
        isShippable ? body.data.mondialRelayEnabled : false,
        isShippable ? body.data.colissimoEnabled : false,
        isShippable ? body.data.packageWeightG ?? null : null,
        isShippable ? body.data.packageLengthCm ?? null : null,
        isShippable ? body.data.packageWidthCm ?? null : null,
        isShippable ? body.data.packageHeightCm ?? null : null,
      );
    });

    return reply.send({ saved: true });
  });
}
