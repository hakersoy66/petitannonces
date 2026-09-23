import { createHash } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { getShippingOptions } from "./carrier-providers.js";
import { signShippingQuote } from "./shipping-quotes.js";
import { getSellerPayoutReadiness } from "./marketplace-payout-provider.js";
import { marketplaceQuote, type CommissionPayer } from "./marketplace-fees.js";
import { paypalCheckoutPublicConfig } from "./paypal-checkout.js";
import { expireAcceptedOfferPaymentWindows } from "./offer-lifecycle.js";

const SESSION_COOKIE = "pa_session";
function sha256(value:string){return createHash("sha256").update(value).digest("hex");}
async function requireUser(request:FastifyRequest,reply:FastifyReply){const auth=typeof request.headers.authorization==="string"?request.headers.authorization.trim():"";const bearer=/^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim()||null;const token=bearer??request.cookies[SESSION_COOKIE];if(!token){reply.code(401).send({error:"unauthorized"});return null;}const session=await prisma.session.findUnique({where:{tokenHash:sha256(token)},include:{user:{include:{profile:true}}}});if(!session||session.revokedAt||session.expiresAt<=new Date()||session.user.status!=="ACTIVE"){reply.code(401).send({error:"unauthorized"});return null;}return session.user;}

type CommerceRow={securePaymentEnabled:boolean;commissionPayer:CommissionPayer;packageWeightG:number|null;packageLengthCm:number|null;packageWidthCm:number|null;packageHeightCm:number|null;mondialRelayEnabled:boolean;colissimoEnabled:boolean};
async function loadListing(id:string){const listing=await prisma.listing.findFirst({where:{id,status:"PUBLISHED"},select:{id:true,title:true,priceMinor:true,currency:true,sellerId:true,city:true,postalCode:true,category:{select:{domain:true}}}});if(!listing)return null;const rows=await prisma.$queryRawUnsafe<CommerceRow[]>(`SELECT "securePaymentEnabled","commissionPayer","packageWeightG","packageLengthCm","packageWidthCm","packageHeightCm","mondialRelayEnabled","colissimoEnabled" FROM "ListingCommerceSettings" WHERE "listingId"=$1 LIMIT 1`,id);return {listing,commerce:rows[0]??null};}
async function sellerAddress(userId:string){return prisma.address.findFirst({where:{userId,type:{in:["SHIPPING","BUSINESS","HOME"]}},orderBy:[{isDefault:"desc"},{createdAt:"asc"}]});}

async function sellerCheckoutState(userId:string){
  const readiness=await getSellerPayoutReadiness(userId);
  if(!readiness.providerOperational)return{allowed:false,deferred:false,reason:"PAYMENT_PROVIDER_NOT_READY"};
  return{allowed:true,deferred:false,reason:null};
}

const recipientSchema=z.object({name:z.string().trim().min(2).max(120),address1:z.string().trim().min(3).max(160),address2:z.string().trim().max(160).optional(),postalCode:z.string().trim().min(3).max(20),city:z.string().trim().min(2).max(100),countryCode:z.string().trim().length(2).default("FR"),phone:z.string().trim().max(30).optional(),email:z.string().email().optional()});

export async function registerCheckoutListingRoutes(app:FastifyInstance){
 app.get("/checkout/payment-methods",async(_request,reply)=>{const paypal=await paypalCheckoutPublicConfig();return reply.send({card:true,paypal:{enabled:paypal.enabled,mode:paypal.mode,payLater4x:paypal.enabled}})});
 app.get("/checkout/listings/:id/context",async(request,reply)=>{
  const user=await requireUser(request,reply);if(!user)return;
  const params=z.object({id:z.string().min(1)}).safeParse(request.params);
  const query=z.object({offerId:z.string().min(1).optional()}).safeParse(request.query);
  if(!params.success||!query.success)return reply.code(400).send({error:"invalid_request"});
  if(query.data.offerId)await expireAcceptedOfferPaymentWindows({offerId:query.data.offerId});
  const loaded=await loadListing(params.data.id);if(!loaded)return reply.code(404).send({error:"listing_not_available"});
  const {listing,commerce}=loaded;
  if(listing.sellerId===user.id)return reply.code(400).send({error:"cannot_buy_own_listing"});
  if(listing.priceMinor==null||listing.priceMinor<=0)return reply.code(409).send({error:"payment_not_available_for_free_listing"});
  const shippable=!["VEHICLE","REAL_ESTATE","JOB","SERVICE"].includes(listing.category.domain);
  if(!commerce?.securePaymentEnabled||!shippable||(!commerce.mondialRelayEnabled&&!commerce.colissimoEnabled))return reply.code(409).send({error:"shipping_checkout_unavailable"});
  if(!commerce.packageWeightG)return reply.code(409).send({error:"package_information_missing"});
  const paymentStatePromise=sellerCheckoutState(listing.sellerId);
  const originPromise=sellerAddress(listing.sellerId);
  const buyerAddressesPromise=prisma.address.findMany({where:{userId:user.id,type:{in:["SHIPPING","HOME"]}},orderBy:[{isDefault:"desc"},{createdAt:"asc"}],take:10});
  const coverPromise=prisma.$queryRawUnsafe<Array<{publicUrl:string}>>(`SELECT "publicUrl" FROM "ListingMedia" WHERE "listingId"=$1 AND "status"='READY' AND "publicUrl" IS NOT NULL ORDER BY "isCover" DESC,"sortOrder" ASC LIMIT 1`,listing.id);
  const acceptedPromise=query.data.offerId?prisma.offer.findFirst({where:{id:query.data.offerId,listingId:listing.id,status:"ACCEPTED",expiresAt:{gt:new Date()},conversation:{buyerId:user.id,sellerId:listing.sellerId}},select:{amountMinor:true,expiresAt:true}}):Promise.resolve(null);
  const paypalPromise=paypalCheckoutPublicConfig();
  const [paymentState,origin,buyerAddresses,cover,accepted,paypal]=await Promise.all([paymentStatePromise,originPromise,buyerAddressesPromise,coverPromise,acceptedPromise,paypalPromise]);
  if(!paymentState.allowed)return reply.code(409).send({error:"payment_provider_not_ready",reason:paymentState.reason});
  if(!origin)return reply.code(409).send({error:"seller_shipping_address_missing"});
  if(query.data.offerId&&!accepted)return reply.code(400).send({error:"accepted_offer_not_found"});
  const buyerAddress=buyerAddresses[0]??null;
  const purchasePriceMinor=accepted?.amountMinor??listing.priceMinor;
  const commissionPayer:CommissionPayer=commerce.commissionPayer==="BUYER"?"BUYER":"SELLER";
  const pricing=marketplaceQuote(purchasePriceMinor,0,commissionPayer);
  return reply.send({paymentDeferred:paymentState.deferred,paymentAvailabilityReason:paymentState.reason,paymentMethods:{card:true,paypal:paypal.enabled,paypalMode:paypal.mode,payLater4x:paypal.enabled&&listing.currency.toUpperCase()==="EUR"&&purchasePriceMinor>=2000&&purchasePriceMinor<=300000},pricing:{commissionPayer:pricing.commissionPayer,commissionRateBps:pricing.commissionRateBps,buyerServiceFeeMinor:pricing.buyerServiceFeeMinor,sellerNetMinor:pricing.sellerNetMinor},listing:{id:listing.id,title:listing.title,priceMinor:purchasePriceMinor,originalPriceMinor:listing.priceMinor,currency:listing.currency,coverUrl:cover[0]?.publicUrl??null,offerApplied:Boolean(query.data.offerId),offerId:query.data.offerId??null,offerExpiresAt:accepted?.expiresAt?.toISOString()??null},package:{weightG:commerce.packageWeightG,lengthCm:commerce.packageLengthCm,widthCm:commerce.packageWidthCm,heightCm:commerce.packageHeightCm},buyer:{name:buyerAddress?.recipient??user.profile?.displayName??user.profile?.firstName??"",email:user.email,phone:user.profile?.phone??"",address1:buyerAddress?.line1??"",address2:buyerAddress?.line2??"",postalCode:buyerAddress?.postalCode??"",city:buyerAddress?.city??"",countryCode:buyerAddress?.countryCode??"FR"},addresses:buyerAddresses.map(a=>({id:a.id,label:a.label,recipient:a.recipient,line1:a.line1,line2:a.line2,postalCode:a.postalCode,city:a.city,countryCode:a.countryCode,isDefault:a.isDefault})),origin:{postalCode:origin.postalCode,city:origin.city,countryCode:origin.countryCode}});
 });

 app.post("/checkout/shipping-options",async(request,reply)=>{const user=await requireUser(request,reply);if(!user)return;const body=z.object({listingId:z.string().min(1),recipient:recipientSchema}).safeParse(request.body);if(!body.success)return reply.code(400).send({error:"invalid_request",details:body.error.flatten()});const loaded=await loadListing(body.data.listingId);if(!loaded)return reply.code(404).send({error:"listing_not_available"});const {listing,commerce}=loaded;if(listing.sellerId===user.id)return reply.code(400).send({error:"cannot_buy_own_listing"});if(!commerce?.securePaymentEnabled||!commerce.packageWeightG)return reply.code(409).send({error:"shipping_checkout_unavailable"});const [paymentState,origin]=await Promise.all([sellerCheckoutState(listing.sellerId),sellerAddress(listing.sellerId)]);if(!paymentState.allowed)return reply.code(409).send({error:"payment_provider_not_ready",reason:paymentState.reason});if(!origin)return reply.code(409).send({error:"seller_shipping_address_missing"});try{const result=await getShippingOptions({weightG:commerce.packageWeightG,lengthCm:commerce.packageLengthCm??undefined,widthCm:commerce.packageWidthCm??undefined,heightCm:commerce.packageHeightCm??undefined,sender:{name:"Vendeur Petit Annonces",address1:origin.line1,address2:origin.line2??undefined,postalCode:origin.postalCode,city:origin.city,countryCode:origin.countryCode},recipient:{...body.data.recipient,countryCode:body.data.recipient.countryCode.toUpperCase()}});const options=result.options.map(item=>({...item,quoteToken:signShippingQuote({provider:"SENDCLOUD",shippingOptionCode:item.code,carrierCode:item.carrierCode||"sendcloud",carrierName:item.carrierName,serviceName:item.name,amountMinor:item.priceMinor,currency:item.currency||"EUR",servicePoint:item.servicePoint,contractId:item.contractId,weightG:commerce.packageWeightG!,recipientPostalCode:body.data.recipient.postalCode,recipientCountryCode:body.data.recipient.countryCode.toUpperCase()})}));return reply.send({provider:"SENDCLOUD",sandbox:result.sandbox,options});}catch(error){request.log.error(error);return reply.code(502).send({error:"shipping_options_unavailable"});}});
}
