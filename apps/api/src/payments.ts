import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { verifyShippingQuote } from "./shipping-quotes.js";
import { getRuntimeIntegration } from "./admin-control.js";
import { cancelMarketplaceCheckout, createMarketplaceCheckout, ensurePayoutReconciliationSchema, refundMarketplacePayment, stripeMarketplaceConfigured } from "./marketplace-stripe.js";
import { executeSellerPayout, getPayoutProviderRuntime, getSellerPayoutReadiness } from "./marketplace-payout-provider.js";
import { runObservedJob } from "./job-observability.js";
import { commercePaymentGate, commercePayoutGate, snapshotOrderCommerceRisk } from "./commerce-risk.js";
import { MARKETPLACE_COMMISSION_RATE_BPS, marketplaceQuote, type CommissionPayer } from "./marketplace-fees.js";
import { capturePayPalOrder, createPayPalCheckout, getPayPalOrder, paypalCaptureFromOrder, refundPayPalCapture } from "./paypal-checkout.js";
import { deliverUserEvent } from "./notification-delivery.js";
import { expireAcceptedOfferPaymentWindows } from "./offer-lifecycle.js";

const SESSION_COOKIE = "pa_session";

function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }
async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const auth = typeof request.headers.authorization === "string" ? request.headers.authorization.trim() : "";
  const bearer = /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim() || null;
  const token = bearer ?? request.cookies[SESSION_COOKIE];
  if (!token) { reply.code(401).send({ error: "unauthorized" }); return null; }
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== "ACTIVE") { reply.code(401).send({ error: "unauthorized" }); return null; }
  return session.user;
}

async function sellerPaymentReady(userId:string){const readiness=await getSellerPayoutReadiness(userId);return readiness.sellerReady&&readiness.providerOperational;}

function quote(itemAmountMinor: number, shippingAmountMinor: number, commissionPayer: CommissionPayer) {
  return marketplaceQuote(itemAmountMinor, shippingAmountMinor, commissionPayer);
}
async function paymentRuntime() {
  const configured = await getRuntimeIntegration("marketplace-payment");
  if (configured?.enabled) {
    return {
      provider: String(configured.config.provider ?? "custom"),
      baseUrl: String(configured.config.apiUrl ?? ""),
      token: configured.secrets.apiToken ?? "",
      webhookSecret: configured.secrets.webhookSecret ?? "",
    };
  }
  if (await stripeMarketplaceConfigured()) return { provider:"stripe-connect", baseUrl:"", token:"", webhookSecret: process.env.STRIPE_BILLING_WEBHOOK_SECRET ?? "" };
  const fallbackProvider = process.env.MARKETPLACE_PAYMENT_PROVIDER ?? (process.env.NODE_ENV === "production" ? "unconfigured" : "mock");
  return {
    provider: fallbackProvider,
    baseUrl: process.env.MARKETPLACE_PAYMENT_API_URL ?? "",
    token: process.env.MARKETPLACE_PAYMENT_API_TOKEN ?? "",
    webhookSecret: process.env.MARKETPLACE_WEBHOOK_SECRET ?? "",
  };
}
async function providerRequest(path: string, input: Record<string, unknown>, idempotencyKey: string):Promise<Record<string,unknown>> {
  const runtime = await paymentRuntime();
  const provider = runtime.provider;
  if (provider === "mock") return { provider, id: `mock_${randomUUID()}`, url: `/checkout/mock/${String(input.orderId ?? "")}` };
  if (provider === "unconfigured") throw new Error("payment_provider_not_configured");
  if (path === "/payouts") return executeSellerPayout({sellerId:String(input.sellerId),orderId:String(input.orderId),amountMinor:Number(input.amountMinor),currency:String(input.currency??"EUR"),idempotencyKey});
  if (provider === "stripe-connect") {
    if (path === "/checkouts") return createMarketplaceCheckout({orderId:String(input.orderId),orderNumber:String(input.orderNumber??input.orderId),title:String(input.title??"Annonce Petit Annonces"),amountMinor:Number(input.amountMinor),currency:String(input.currency??"EUR"),idempotencyKey,successUrl:typeof input.successUrl==="string"?input.successUrl:undefined,cancelUrl:typeof input.cancelUrl==="string"?input.cancelUrl:undefined});
    if (path === "/refunds") {const refund=await refundMarketplacePayment(String(input.providerPaymentId??input.paymentIntentId??""),Number(input.amountMinor),idempotencyKey,String(input.orderId??"")||undefined);return {provider,id:refund.id,status:refund.status};}
  }
  if (!runtime.baseUrl || !runtime.token) throw new Error("payment_provider_not_configured");
  const response = await fetch(`${runtime.baseUrl.replace(/\/$/, "")}${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${runtime.token}`, "idempotency-key": idempotencyKey }, body: JSON.stringify(input) });
  if (!response.ok) throw new Error(`payment_provider_error_${response.status}`);
  return { provider, ...((await response.json()) as Record<string, unknown>) };
}
async function verifyWebhookSignature(rawBody: string, signature: string) {
  const secret = (await paymentRuntime()).webhookSecret;
  if (!secret) return process.env.NODE_ENV !== "production";
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex"); const a = Buffer.from(expected); const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

type OrderRow = { id:string;orderNumber:string;buyerId:string;sellerId:string;currency:string;totalAmountMinor:number;sellerNetMinor:number;status:string;paymentProvider:string|null };
type PaymentRow = { id:string;provider:string;providerPaymentId:string|null;amountMinor:number;currency:string;status:string };

async function payoutEligibility(orderId:string,sellerId?:string){
  const rows=await prisma.$queryRawUnsafe<Array<{payoutEligibleAt:Date|null;activeDispute:boolean;activeRefund:boolean;activeReturn:boolean;partialRefundReview:boolean;shipmentDelivered:boolean}>>(`SELECT bp."payoutEligibleAt", EXISTS(SELECT 1 FROM "MarketplaceDispute" d WHERE d."orderId"=$1 AND d."status" NOT IN ('RESOLVED_BUYER','RESOLVED_SELLER','CLOSED')) AS "activeDispute", EXISTS(SELECT 1 FROM "MarketplaceRefund" r WHERE r."orderId"=$1 AND r."status" IN ('PENDING','PROCESSING')) AS "activeRefund", EXISTS(SELECT 1 FROM "MarketplaceReturnRequest" rr WHERE rr."orderId"=$1 AND rr."status" IN ('OPEN','APPROVED','PROCESSING')) AS "activeReturn", EXISTS(SELECT 1 FROM "MarketplacePayment" mp WHERE mp."orderId"=$1 AND mp."status"='PARTIALLY_REFUNDED') AS "partialRefundReview", EXISTS(SELECT 1 FROM "MarketplaceShipment" ms WHERE ms."orderId"=$1 AND ms."status"='DELIVERED') AS "shipmentDelivered" FROM "BuyerProtectionWindow" bp WHERE bp."orderId"=$1 LIMIT 1`,orderId);
  const row=rows[0];
  const [readiness,riskGate]=await Promise.all([sellerId?getSellerPayoutReadiness(sellerId):Promise.resolve(null),commercePayoutGate(orderId)]);
  return{eligibleAt:row?.payoutEligibleAt??null,activeDispute:Boolean(row?.activeDispute),activeRefund:Boolean(row?.activeRefund),activeReturn:Boolean(row?.activeReturn),partialRefundReview:Boolean(row?.partialRefundReview),shipmentDelivered:Boolean(row?.shipmentDelivered),sellerReady:readiness?.sellerReady??true,sellerReason:readiness?.reason??null,providerOperational:readiness?.providerOperational??true,provider:readiness?.provider??null,riskAllowed:riskGate.allowed,riskReason:riskGate.error,risk:riskGate.risk};
}

function payoutQueueReason(eligibility:Awaited<ReturnType<typeof payoutEligibility>>){
  if(!eligibility.shipmentDelivered)return"SHIPMENT_NOT_DELIVERED";
  if(eligibility.activeDispute)return"ACTIVE_DISPUTE";
  if(eligibility.activeReturn)return"ACTIVE_RETURN";
  if(eligibility.activeRefund)return"ACTIVE_REFUND";
  if(eligibility.partialRefundReview)return"PARTIAL_REFUND_REVIEW";
  if(!eligibility.riskAllowed)return eligibility.riskReason??"RISK_REVIEW_REQUIRED";
  if(!eligibility.sellerReady)return eligibility.sellerReason??"SELLER_VERIFICATION_REQUIRED";
  if(!eligibility.providerOperational)return"PROVIDER_PENDING";
  return null;
}
function payoutBlockMessage(reason:string,orderNumber:string){
  if(reason==="IBAN_REQUIRED")return `Le versement de la commande ${orderNumber} attend l’ajout ou la validation de votre compte bancaire.`;
  if(["KYC_REQUIRED","USER_VERIFICATION_REQUIRED","SELLER_VERIFICATION_REQUIRED","BANK_ACCOUNT_OR_VERIFICATION_REQUIRED","VERIFICATION_PENDING","SELLER_PROFILE_REQUIRED"].includes(reason))return `Le versement de la commande ${orderNumber} est en attente d’une vérification de votre profil vendeur.`;
  if(reason==="ACTIVE_DISPUTE")return `Le versement de la commande ${orderNumber} est temporairement bloqué car un litige est actif.`;
  if(reason==="ACTIVE_RETURN")return `Le versement de la commande ${orderNumber} est temporairement bloqué pendant le traitement du retour.`;
  if(reason==="ACTIVE_REFUND"||reason==="PARTIAL_REFUND_REVIEW")return `Le versement de la commande ${orderNumber} est temporairement bloqué pendant le traitement du remboursement.`;
  if(reason.startsWith("RISK_"))return `Le versement de la commande ${orderNumber} fait l’objet d’une vérification de sécurité. Aucune action n’est requise sauf indication contraire.`;
  if(reason==="PROVIDER_PENDING")return `Le versement de la commande ${orderNumber} est prêt mais le prestataire de paiement est momentanément en attente.`;
  return `Le versement de la commande ${orderNumber} est temporairement en attente. Consultez le détail pour connaître la situation.`;
}

async function upsertPayoutQueue(order:OrderRow,eligibility:Awaited<ReturnType<typeof payoutEligibility>>){
  await ensurePayoutReconciliationSchema();
  const reason=payoutQueueReason(eligibility);const status=reason?"BLOCKED":"PENDING";const key=`auto-payout-${order.id}`;
  await prisma.$executeRawUnsafe(`INSERT INTO "MarketplacePayout" ("id","orderId","sellerId","amountMinor","currency","status","idempotencyKey","availableAt","failureReason") VALUES ($1,$2,$3,$4,$5,$6::"PayoutStatus",$7,$8,$9) ON CONFLICT ("orderId") DO UPDATE SET "status"=CASE WHEN "MarketplacePayout"."status" IN ('PROCESSING','PAID','CANCELED') THEN "MarketplacePayout"."status" ELSE EXCLUDED."status" END,"availableAt"=COALESCE("MarketplacePayout"."availableAt",EXCLUDED."availableAt"),"failureReason"=CASE WHEN "MarketplacePayout"."status" IN ('PROCESSING','PAID','CANCELED') THEN "MarketplacePayout"."failureReason" ELSE EXCLUDED."failureReason" END,"updatedAt"=CURRENT_TIMESTAMP`,randomUUID(),order.id,order.sellerId,order.sellerNetMinor,order.currency,status,key,eligibility.eligibleAt,reason);
  return{status,reason};
}


export async function issueMarketplaceRefund(input:{orderId:string;amountMinor?:number;reason?:string;idempotencyKey:string}){
  const orders=await prisma.$queryRawUnsafe<OrderRow[]>(`SELECT "id","orderNumber","buyerId","sellerId","currency","totalAmountMinor","sellerNetMinor","status","paymentProvider" FROM "MarketplaceOrder" WHERE "id"=$1 LIMIT 1`,input.orderId);
  const order=orders[0];
  if(!order)throw new Error("order_not_found");
  if(!["PAID","PROCESSING","SHIPPED","DELIVERED","COMPLETED","DISPUTED"].includes(order.status))throw new Error("order_not_refundable");
  const existing=await prisma.$queryRawUnsafe<Array<{id:string;status:string;amountMinor:number}>>(`SELECT "id","status"::text AS "status","amountMinor" FROM "MarketplaceRefund" WHERE "orderId"=$1 AND "idempotencyKey"=$2 LIMIT 1`,order.id,input.idempotencyKey);
  if(existing[0])return{refund:{id:existing[0].id,amountMinor:existing[0].amountMinor,currency:order.currency,status:existing[0].status},existing:true};
  const payoutRows=await prisma.$queryRawUnsafe<Array<{status:string}>>(`SELECT "status"::text AS "status" FROM "MarketplacePayout" WHERE "orderId"=$1 LIMIT 1`,order.id);
  const payoutStatus=String(payoutRows[0]?.status??"");
  if(["PROCESSING","PAID"].includes(payoutStatus))throw new Error("payout_already_released_support_required");
  const payments=await prisma.$queryRawUnsafe<PaymentRow[]>(`SELECT "id","provider","providerPaymentId","amountMinor","currency","status" FROM "MarketplacePayment" WHERE "orderId"=$1 AND "status" IN ('AUTHORIZED','CAPTURED','PARTIALLY_REFUNDED') ORDER BY "createdAt" DESC LIMIT 1`,order.id);
  const payment=payments[0];
  if(!payment||!payment.providerPaymentId)throw new Error("captured_payment_not_found");
  const sums=await prisma.$queryRawUnsafe<Array<{refunded:bigint}>>(`SELECT COALESCE(SUM("amountMinor"),0)::bigint AS "refunded" FROM "MarketplaceRefund" WHERE "paymentId"=$1 AND "status" IN ('PENDING','PROCESSING','SUCCEEDED')`,payment.id);
  const already=Number(sums[0]?.refunded??0n);
  const remaining=Math.max(0,payment.amountMinor-already);
  if(remaining<=0)throw new Error("payment_already_refunded");
  const amountMinor=input.amountMinor??remaining;
  if(amountMinor<=0||amountMinor>remaining)throw new Error("refund_exceeds_payment");
  const providerRefund=payment.provider==="paypal"?await refundPayPalCapture(payment.providerPaymentId,amountMinor,order.currency,input.idempotencyKey):await providerRequest("/refunds",{orderId:order.id,paymentId:payment.id,providerPaymentId:payment.providerPaymentId,amountMinor,currency:order.currency,reason:input.reason},input.idempotencyKey);
  const refundId=randomUUID();
  const providerStatus=String((providerRefund as {status?:unknown}).status??"pending").toLowerCase();
  const refundStatus=(providerStatus==="succeeded"||providerStatus==="completed")?"SUCCEEDED":providerStatus==="failed"?"FAILED":providerStatus==="canceled"?"CANCELED":"PROCESSING";
  await prisma.$transaction(async tx=>{
    await tx.$executeRawUnsafe(`INSERT INTO "MarketplaceRefund" ("id","orderId","paymentId","providerRefundId","amountMinor","currency","reason","status","idempotencyKey") VALUES ($1,$2,$3,$4,$5,$6,$7,$8::"RefundStatus",$9)`,refundId,order.id,payment.id,String(providerRefund.id??`refund_${refundId}`),amountMinor,order.currency,input.reason??null,refundStatus,input.idempotencyKey);
    await tx.$executeRawUnsafe(`INSERT INTO "FinancialLedgerEntry" ("id","orderId","type","amountMinor","currency","reference") VALUES ($1,$2,'REFUND',$3,$4,$5)`,randomUUID(),order.id,-amountMinor,order.currency,refundId);
    if(refundStatus==="SUCCEEDED"){
      const totalRows=await tx.$queryRawUnsafe<Array<{refunded:bigint}>>(`SELECT COALESCE(SUM("amountMinor"),0)::bigint AS "refunded" FROM "MarketplaceRefund" WHERE "paymentId"=$1 AND "status"='SUCCEEDED'`,payment.id);
      const refunded=Number(totalRows[0]?.refunded??0n);const full=refunded>=payment.amountMinor;
      await tx.$executeRawUnsafe(`UPDATE "MarketplacePayment" SET "status"=$1::"PaymentStatus","updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$2`,full?"REFUNDED":"PARTIALLY_REFUNDED",payment.id);
      if(full)await tx.$executeRawUnsafe(`UPDATE "MarketplaceOrder" SET "status"='REFUNDED',"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,order.id);
    }
    await tx.$executeRawUnsafe(`UPDATE "MarketplacePayout" SET "status"='CANCELED',"updatedAt"=CURRENT_TIMESTAMP WHERE "orderId"=$1 AND "status" IN ('PENDING','BLOCKED')`,order.id);
  });
  return{refund:{id:refundId,amountMinor,currency:order.currency,status:refundStatus},existing:false};
}

export async function retryMarketplaceRefund(refundId:string){
  const rows=await prisma.$queryRawUnsafe<Array<{id:string;orderId:string;amountMinor:number;reason:string|null;status:string;idempotencyKey:string}>>(`SELECT "id","orderId","amountMinor","reason","status"::text AS "status","idempotencyKey" FROM "MarketplaceRefund" WHERE "id"=$1 LIMIT 1`,refundId);
  const row=rows[0];if(!row)throw new Error("refund_not_found");if(row.status!=="FAILED")throw new Error("refund_not_failed");
  const base=row.idempotencyKey.includes(":retry:")?row.idempotencyKey.split(":retry:")[0]:row.idempotencyKey;
  const attempts=await prisma.$queryRawUnsafe<Array<{count:bigint;active:bigint}>>(`SELECT COUNT(*) FILTER (WHERE "idempotencyKey" LIKE $2)::bigint AS count,COUNT(*) FILTER (WHERE "idempotencyKey" LIKE $2 AND "status" IN ('PROCESSING','SUCCEEDED'))::bigint AS active FROM "MarketplaceRefund" WHERE "orderId"=$1`,row.orderId,`${base}:retry:%`);
  if(Number(attempts[0]?.active??0n)>0)throw new Error("refund_retry_already_active");
  const retryCount=Number(attempts[0]?.count??0n);if(retryCount>=3)throw new Error("refund_retry_limit_reached");
  const next=retryCount+1;
  return issueMarketplaceRefund({orderId:row.orderId,amountMinor:row.amountMinor,reason:`Nouvelle tentative ${next}/3 · ${row.reason??"Remboursement"}`,idempotencyKey:`${base}:retry:${next}`});
}

export async function registerPaymentRoutes(app: FastifyInstance) {
  app.post("/checkout/quote", async (request, reply) => {
    const parsed = z.object({ itemAmountMinor: z.number().int().positive(), shippingAmountMinor: z.number().int().nonnegative().default(0), commissionPayer: z.enum(["SELLER","BUYER"]).default("SELLER") }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    return reply.send({ quote: quote(parsed.data.itemAmountMinor, parsed.data.shippingAmountMinor, parsed.data.commissionPayer) });
  });

  app.post("/checkout/orders", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const parsed = z.object({ listingId: z.string().min(1), offerId: z.string().min(1).optional(), shippingQuoteToken: z.string().min(20), idempotencyKey: z.string().min(12).max(120) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const shippingQuote = verifyShippingQuote(parsed.data.shippingQuoteToken);
    if (!shippingQuote) return reply.code(400).send({ error: "invalid_or_expired_shipping_quote" });
    const listing = await prisma.listing.findFirst({ where: { id: parsed.data.listingId, status: "PUBLISHED" } });
    if (!listing || listing.priceMinor == null) return reply.code(404).send({ error: "listing_not_available" });
    if (listing.priceMinor <= 0) return reply.code(409).send({ error: "payment_not_available_for_free_listing" });
    if (listing.sellerId === user.id) return reply.code(400).send({ error: "cannot_buy_own_listing" });
    const sellerReadiness=await getSellerPayoutReadiness(listing.sellerId);
    if(!sellerReadiness.providerOperational)return reply.code(409).send({error:"payment_provider_not_ready"});
    const commerceRows=await prisma.$queryRawUnsafe<Array<{securePaymentEnabled:boolean;commissionPayer:string|null}>>(`SELECT "securePaymentEnabled","commissionPayer" FROM "ListingCommerceSettings" WHERE "listingId"=$1 LIMIT 1`,listing.id);
    const commerce=commerceRows[0];
    if(!commerce?.securePaymentEnabled)return reply.code(409).send({error:"secure_payment_disabled"});
    const commissionPayer:CommissionPayer=commerce.commissionPayer==="BUYER"?"BUYER":"SELLER";
    let itemAmountMinor = listing.priceMinor;
    if (parsed.data.offerId) {
      await expireAcceptedOfferPaymentWindows({offerId:parsed.data.offerId});
      const offer = await prisma.offer.findFirst({ where: { id: parsed.data.offerId, listingId: listing.id, status: "ACCEPTED", expiresAt:{gt:new Date()}, conversation: { buyerId: user.id, sellerId: listing.sellerId } } });
      if (!offer) return reply.code(400).send({ error: "accepted_offer_not_found" });
      itemAmountMinor = offer.amountMinor;
    }
    const totals = quote(itemAmountMinor, shippingQuote.amountMinor, commissionPayer);
    const orderId = randomUUID();
    const orderNumber = `PA-${Date.now().toString(36).toUpperCase()}-${orderId.slice(0, 6).toUpperCase()}`;
    try {
      await prisma.$transaction(async tx=>{
        const locked=await tx.$queryRawUnsafe<Array<{id:string;status:string}>>(`SELECT "id","status"::text AS "status" FROM "Listing" WHERE "id"=$1 FOR UPDATE`,listing.id);
        if(!locked[0]||locked[0].status!=="PUBLISHED")throw new Error("listing_not_available");
        if(parsed.data.offerId){const offerLocked=await tx.$queryRawUnsafe<Array<{id:string}>>(`SELECT o."id" FROM "Offer" o JOIN "Conversation" c ON c."id"=o."conversationId" WHERE o."id"=$1 AND o."listingId"=$2 AND o."status"='ACCEPTED' AND o."expiresAt">CURRENT_TIMESTAMP AND c."buyerId"=$3 AND c."sellerId"=$4 FOR UPDATE`,parsed.data.offerId,listing.id,user.id,listing.sellerId);if(!offerLocked[0])throw new Error("accepted_offer_expired");}
        const active=await tx.$queryRawUnsafe<Array<{id:string;buyerId:string;status:string;createdAt:Date}>>(`SELECT "id","buyerId","status"::text AS "status","createdAt" FROM "MarketplaceOrder" WHERE "listingId"=$1 AND "status" IN ('PENDING_PAYMENT','PAID','PROCESSING','SHIPPED','DELIVERED','COMPLETED','DISPUTED') ORDER BY "createdAt" DESC FOR UPDATE`,listing.id);
        const blocking=active.find(o=>o.status!=="PENDING_PAYMENT"||(Date.now()-new Date(o.createdAt).getTime())<30*60*1000);
        if(blocking&&blocking.status!=="PENDING_PAYMENT")throw new Error(`listing_order_in_progress:${blocking.id}`);
        if(blocking&&blocking.buyerId!==user.id)throw new Error("listing_temporarily_reserved");
        const staleOrOwnPending=active.filter(o=>o.status==="PENDING_PAYMENT"&&(!blocking||o.id!==blocking.id||o.buyerId===user.id));
        for(const old of staleOrOwnPending){await tx.$executeRawUnsafe(`UPDATE "MarketplaceOrder" SET "status"='CANCELED',"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "status"='PENDING_PAYMENT'`,old.id);await tx.$executeRawUnsafe(`UPDATE "MarketplacePayment" SET "status"='CANCELED',"updatedAt"=CURRENT_TIMESTAMP WHERE "orderId"=$1 AND "status" IN ('CREATED','REQUIRES_ACTION','AUTHORIZED')`,old.id);}
        if(blocking&&blocking.status==="PENDING_PAYMENT"&&blocking.buyerId===user.id){await tx.$executeRawUnsafe(`UPDATE "MarketplaceOrder" SET "status"='CANCELED',"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,blocking.id);await tx.$executeRawUnsafe(`UPDATE "MarketplacePayment" SET "status"='CANCELED',"updatedAt"=CURRENT_TIMESTAMP WHERE "orderId"=$1 AND "status" IN ('CREATED','REQUIRES_ACTION','AUTHORIZED')`,blocking.id);}
        await tx.$executeRawUnsafe(`INSERT INTO "MarketplaceOrder" ("id","orderNumber","listingId","offerId","buyerId","sellerId","currency","itemAmountMinor","shippingAmountMinor","buyerProtectionFeeMinor","platformCommissionMinor","sellerNetMinor","totalAmountMinor","commissionPayer","commissionRateBps","status","idempotencyKey") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'PENDING_PAYMENT',$16)`, orderId, orderNumber, listing.id, parsed.data.offerId ?? null, user.id, listing.sellerId, listing.currency, totals.itemAmountMinor, totals.shippingAmountMinor, totals.buyerProtectionFeeMinor, totals.platformCommissionMinor, totals.sellerNetMinor, totals.totalAmountMinor, totals.commissionPayer, totals.commissionRateBps, parsed.data.idempotencyKey);
      });
      const commerceRisk=await snapshotOrderCommerceRisk(orderId).catch(()=>null);
      return reply.code(201).send({ order: { id: orderId, orderNumber, ...totals, currency: listing.currency, status: "PENDING_PAYMENT" }, commerceRisk: commerceRisk?{paymentGate:commerceRisk.paymentGate,payoutGate:commerceRisk.payoutGate,reviewRequired:commerceRisk.paymentGate==="REVIEW"}:null });
    } catch (error) {
      const message=String(error);
      if(message.includes("listing_temporarily_reserved"))return reply.code(409).send({error:"listing_temporarily_reserved"});
      if(message.includes("listing_order_in_progress:")){const orderId=message.split("listing_order_in_progress:")[1]?.split(/\s/)[0]??null;return reply.code(409).send({error:"listing_order_in_progress",orderId});}
      if(message.includes("listing_not_available"))return reply.code(409).send({error:"listing_not_available"});
      if(message.includes("accepted_offer_expired"))return reply.code(409).send({error:"accepted_offer_expired"});
      if (message.toLowerCase().includes("unique") || message.includes("idempotencyKey")) return reply.code(409).send({ error: "duplicate_checkout" });
      throw error;
    }
  });

  app.post("/orders/:id/payment-session",async(request,reply)=>{
    const user=await requireUser(request,reply);if(!user)return;
    const params=z.object({id:z.string().min(1)}).safeParse(request.params);
    const body=z.object({idempotencyKey:z.string().min(12).max(120).optional(),client:z.enum(["WEB","NATIVE"]).optional(),appScheme:z.enum(["petitannonces","petitannonces-development","petitannonces-preview"]).optional().default("petitannonces"),paymentMethod:z.enum(["CARD","PAYPAL"]).optional().default("CARD")}).safeParse(request.body??{});
    if(!params.success||!body.success)return reply.code(400).send({error:"invalid_request"});
    const rows=await prisma.$queryRawUnsafe<Array<{id:string;orderNumber:string;listingId:string;offerId:string|null;buyerId:string;sellerId:string;currency:string;totalAmountMinor:number;itemAmountMinor:number;shippingAmountMinor:number;buyerProtectionFeeMinor:number;platformCommissionMinor:number;sellerNetMinor:number;status:string;title:string|null}>>(`SELECT o."id",o."orderNumber",o."listingId",o."offerId",o."buyerId",o."sellerId",o."currency",o."totalAmountMinor",o."itemAmountMinor",o."shippingAmountMinor",o."buyerProtectionFeeMinor",o."platformCommissionMinor",o."sellerNetMinor",o."status"::text AS "status",l."title" FROM "MarketplaceOrder" o LEFT JOIN "Listing" l ON l."id"=o."listingId" WHERE o."id"=$1 LIMIT 1`,params.data.id);
    const order=rows[0];if(!order)return reply.code(404).send({error:"order_not_found"});if(order.buyerId!==user.id)return reply.code(403).send({error:"buyer_only"});if(order.offerId){await expireAcceptedOfferPaymentWindows({offerId:order.offerId});const validOffer=await prisma.offer.findFirst({where:{id:order.offerId,listingId:order.listingId,status:"ACCEPTED",expiresAt:{gt:new Date()},conversation:{buyerId:user.id,sellerId:order.sellerId}},select:{id:true}});if(!validOffer)return reply.code(409).send({error:"accepted_offer_expired"});}if(order.status!=="PENDING_PAYMENT")return reply.code(409).send({error:"order_not_awaiting_payment"});
    const riskGate=await commercePaymentGate(order.id);if(!riskGate.allowed)return reply.code(riskGate.error==="commerce_review_rejected"?403:409).send({error:riskGate.error,reviewRequired:riskGate.error==="commerce_review_required",risk:riskGate.risk?{score:riskGate.risk.orderRiskScore,paymentGate:riskGate.risk.paymentGate}:null});
    const readiness=await getSellerPayoutReadiness(order.sellerId);if(!readiness.providerOperational)return reply.code(409).send({error:"payment_provider_not_ready"});
    const active=await prisma.$queryRawUnsafe<Array<{id:string;status:string}>>(`SELECT "id","status"::text AS "status" FROM "MarketplacePayment" WHERE "orderId"=$1 AND "status" IN ('CREATED','REQUIRES_ACTION','AUTHORIZED','CAPTURED') ORDER BY "createdAt" DESC LIMIT 1`,order.id);if(active[0])return reply.code(409).send({error:"payment_session_already_created"});
    const key=body.data.idempotencyKey??`resume-${order.id}-${Date.now()}`;
    const native=body.data.client==="NATIVE";
    const checkoutResult=body.data.paymentMethod==="PAYPAL"?await createPayPalCheckout({orderId:order.id,orderNumber:order.orderNumber,title:order.title??"Annonce Petit Annonces",amountMinor:order.totalAmountMinor,currency:order.currency,idempotencyKey:key,returnUrl:`https://petitannonces.fr/paiement/paypal/retour?orderId=${encodeURIComponent(order.id)}`,cancelUrl:`https://petitannonces.fr/commandes/${encodeURIComponent(order.id)}?paypal=cancel`}):await providerRequest("/checkouts",{orderId:order.id,orderNumber:order.orderNumber,title:order.title??"Annonce Petit Annonces",amountMinor:order.totalAmountMinor,currency:order.currency,...(native?{successUrl:`https://petitannonces.fr/app/checkout?orderId=${encodeURIComponent(order.id)}&result=success&scheme=${encodeURIComponent(body.data.appScheme)}`,cancelUrl:`https://petitannonces.fr/app/checkout?orderId=${encodeURIComponent(order.id)}&result=cancel&scheme=${encodeURIComponent(body.data.appScheme)}`}:{})},key);
    const checkoutId=String(checkoutResult.id??`checkout_${order.id}`);const checkoutUrl=String((checkoutResult as {url?:unknown}).url??"");if(!checkoutUrl)return reply.code(502).send({error:"payment_checkout_url_missing"});
    await prisma.$transaction(async tx=>{
      await tx.$executeRawUnsafe(`UPDATE "MarketplaceOrder" SET "paymentProvider"=$1,"providerCheckoutId"=$2,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$3 AND "status"='PENDING_PAYMENT'`,String(checkoutResult.provider),checkoutId,order.id);
      await tx.$executeRawUnsafe(`INSERT INTO "MarketplacePayment" ("id","orderId","provider","amountMinor","currency","status","idempotencyKey") VALUES ($1,$2,$3,$4,$5,'CREATED',$6)`,randomUUID(),order.id,String(checkoutResult.provider),order.totalAmountMinor,order.currency,`${key}:payment`);
      for(const [type,amount] of [["ORDER_GROSS",order.itemAmountMinor],["BUYER_FEE",order.buyerProtectionFeeMinor],["PLATFORM_COMMISSION",order.platformCommissionMinor],["SELLER_NET",order.sellerNetMinor]] as const)await tx.$executeRawUnsafe(`INSERT INTO "FinancialLedgerEntry" ("id","orderId","type","amountMinor","currency") VALUES ($1,$2,$3::"LedgerEntryType",$4,$5)`,randomUUID(),order.id,type,amount,order.currency);
    });
    return reply.send({checkout:{provider:String(checkoutResult.provider),checkoutId,checkoutUrl},order:{id:order.id,status:order.status}});
  });

  app.post("/orders/:id/paypal/capture",async(request,reply)=>{
    const user=await requireUser(request,reply);if(!user)return;
    const params=z.object({id:z.string().min(1)}).safeParse(request.params);
    const body=z.object({paypalOrderId:z.string().trim().min(8).max(64)}).safeParse(request.body??{});
    if(!params.success||!body.success)return reply.code(400).send({error:"invalid_request"});
    const rows=await prisma.$queryRawUnsafe<Array<{id:string;orderNumber:string;listingId:string;buyerId:string;sellerId:string;currency:string;totalAmountMinor:number;status:string;paymentProvider:string|null;providerCheckoutId:string|null}>>(`SELECT "id","orderNumber","listingId","buyerId","sellerId","currency","totalAmountMinor","status"::text AS "status","paymentProvider","providerCheckoutId" FROM "MarketplaceOrder" WHERE "id"=$1 LIMIT 1`,params.data.id);
    const order=rows[0];
    if(!order)return reply.code(404).send({error:"order_not_found"});
    if(order.buyerId!==user.id)return reply.code(403).send({error:"buyer_only"});
    if(order.paymentProvider!=="paypal"||order.providerCheckoutId!==body.data.paypalOrderId)return reply.code(409).send({error:"paypal_order_mismatch"});
    if(["PAID","PROCESSING","SHIPPED","DELIVERED","COMPLETED","DISPUTED"].includes(order.status))return reply.send({ok:true,order:{id:order.id,status:order.status},alreadyCaptured:true});
    if(order.status!=="PENDING_PAYMENT")return reply.code(409).send({error:"order_not_awaiting_payment"});

    let remote=await getPayPalOrder(body.data.paypalOrderId);
    const unit=Array.isArray(remote?.purchase_units)?remote.purchase_units[0]:null;
    const remoteOrderId=String(unit?.custom_id??unit?.reference_id??"");
    const remoteCurrency=String(unit?.amount?.currency_code??"").toUpperCase();
    const remoteAmountMinor=Math.round(Number(unit?.amount?.value??0)*100);
    if(remoteOrderId!==order.id)return reply.code(409).send({error:"paypal_order_reference_mismatch"});
    if(remoteCurrency!==order.currency.toUpperCase()||remoteAmountMinor!==order.totalAmountMinor)return reply.code(409).send({error:"paypal_amount_mismatch"});

    const remoteStatus=String(remote?.status??"").toUpperCase();
    if(remoteStatus!=="COMPLETED"){
      if(remoteStatus!=="APPROVED"){
        await deliverUserEvent({userId:order.buyerId,eventKind:"LISTING",notificationKind:"SYSTEM",title:"Paiement PayPal non finalisé",body:`Le paiement PayPal de la commande ${order.orderNumber} n’a pas été finalisé. Aucun paiement confirmé n’a été enregistré; vous pouvez réessayer.`,actionUrl:`/commandes/${order.id}`,transactional:true,dedupeKey:`payment-failed:${order.id}:buyer`,metadata:{orderId:order.id,paymentStatus:"FAILED",paymentProvider:"paypal"}}).catch(()=>undefined);
        return reply.code(409).send({error:"paypal_order_not_approved",status:remoteStatus});
      }
      remote=await capturePayPalOrder(body.data.paypalOrderId,`paypal-capture-${order.id}`);
    }
    const capture=paypalCaptureFromOrder(remote);
    if(!capture||capture.status.toUpperCase()!=="COMPLETED"){
      await deliverUserEvent({userId:order.buyerId,eventKind:"LISTING",notificationKind:"SYSTEM",title:"Paiement PayPal en attente",body:`Le paiement de la commande ${order.orderNumber} n’a pas encore été confirmé par PayPal. Vérifiez la commande avant de réessayer.`,actionUrl:`/commandes/${order.id}`,transactional:true,dedupeKey:`payment-pending:${order.id}:buyer`,metadata:{orderId:order.id,paymentStatus:"PENDING",paymentProvider:"paypal"}}).catch(()=>undefined);
      return reply.code(409).send({error:"paypal_capture_not_completed"});
    }
    if(capture.currency!==order.currency.toUpperCase()||capture.amountMinor!==order.totalAmountMinor)return reply.code(409).send({error:"paypal_capture_amount_mismatch"});

    let captured=false,refundLate=false;
    await prisma.$transaction(async tx=>{
      const orderLocked=await tx.$queryRawUnsafe<Array<{status:string}>>(`SELECT "status"::text AS "status" FROM "MarketplaceOrder" WHERE "id"=$1 FOR UPDATE`,order.id);
      const listingLocked=await tx.$queryRawUnsafe<Array<{status:string}>>(`SELECT "status"::text AS "status" FROM "Listing" WHERE "id"=$1 FOR UPDATE`,order.listingId);
      const paymentLocked=await tx.$queryRawUnsafe<Array<{id:string;status:string}>>(`SELECT "id","status"::text AS "status" FROM "MarketplacePayment" WHERE "orderId"=$1 AND "provider"='paypal' ORDER BY "createdAt" DESC LIMIT 1 FOR UPDATE`,order.id);
      if(!paymentLocked[0])throw new Error("paypal_payment_missing");
      if(orderLocked[0]?.status==="PENDING_PAYMENT"&&listingLocked[0]?.status==="PUBLISHED"){
        captured=true;
        await tx.$executeRawUnsafe(`UPDATE "MarketplaceOrder" SET "status"='PAID',"paidAt"=COALESCE("paidAt",CURRENT_TIMESTAMP),"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,order.id);
        await tx.$executeRawUnsafe(`UPDATE "MarketplacePayment" SET "status"='CAPTURED',"providerPaymentId"=$2,"capturedAt"=COALESCE("capturedAt",CURRENT_TIMESTAMP),"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,paymentLocked[0].id,capture.id);
        await tx.$executeRawUnsafe(`UPDATE "Listing" SET "status"='SOLD',"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "status"='PUBLISHED'`,order.listingId);
      }else{
        refundLate=true;
        await tx.$executeRawUnsafe(`UPDATE "MarketplacePayment" SET "status"='CAPTURED',"providerPaymentId"=$2,"capturedAt"=COALESCE("capturedAt",CURRENT_TIMESTAMP),"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,paymentLocked[0].id,capture.id);
      }
    });

    if(refundLate){
      try{
        const refund=await refundPayPalCapture(capture.id,order.totalAmountMinor,order.currency,`paypal-late-refund-${order.id}`);
        const refundStatus=String(refund.status).toUpperCase()==="COMPLETED"?"SUCCEEDED":"PROCESSING";
        await prisma.$transaction(async tx=>{
          const payments=await tx.$queryRawUnsafe<Array<{id:string}>>(`SELECT "id" FROM "MarketplacePayment" WHERE "orderId"=$1 AND "provider"='paypal' ORDER BY "createdAt" DESC LIMIT 1`,order.id);
          const paymentId=payments[0]?.id;
          if(paymentId){
            await tx.$executeRawUnsafe(`UPDATE "MarketplacePayment" SET "status"=$1::"PaymentStatus","updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$2`,refundStatus==="SUCCEEDED"?"REFUNDED":"PARTIALLY_REFUNDED",paymentId);
            await tx.$executeRawUnsafe(`INSERT INTO "MarketplaceRefund" ("id","orderId","paymentId","providerRefundId","amountMinor","currency","reason","status","idempotencyKey") VALUES ($1,$2,$3,$4,$5,$6,'Paiement PayPal reçu après expiration/réservation concurrente',$7::"RefundStatus",$8) ON CONFLICT DO NOTHING`,randomUUID(),order.id,paymentId,refund.id,order.totalAmountMinor,order.currency,refundStatus,`paypal-late-refund-${order.id}`);
          }
          await tx.$executeRawUnsafe(`UPDATE "MarketplaceOrder" SET "status"='CANCELED',"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "status"='PENDING_PAYMENT'`,order.id);
        });
      }catch(error){
        request.log.error({error,orderId:order.id},"late PayPal refund failed");
        return reply.code(502).send({error:"paypal_refund_required"});
      }
      return reply.code(409).send({error:"listing_not_available_payment_refunded"});
    }

    if(captured){
      const actionUrl=`/commandes/${order.id}`;
      await Promise.all([
        deliverUserEvent({userId:order.buyerId,eventKind:"LISTING",notificationKind:"SYSTEM",title:"Paiement PayPal confirmé",body:`Le paiement de la commande ${order.orderNumber} est confirmé. Le vendeur peut préparer l’envoi.`,actionUrl,transactional:true,dedupeKey:`paypal-paid:${order.id}:buyer`,metadata:{orderId:order.id,orderStatus:"PAID",paymentProvider:"paypal"}}),
        deliverUserEvent({userId:order.sellerId,eventKind:"LISTING",notificationKind:"SYSTEM",title:"Nouvelle vente",body:`La commande ${order.orderNumber} a été payée avec PayPal. Vous pouvez préparer l’envoi.`,actionUrl,transactional:true,dedupeKey:`paypal-paid:${order.id}:seller`,metadata:{orderId:order.id,orderStatus:"PAID",paymentProvider:"paypal"}}),
      ]).catch(()=>undefined);
    }
    return reply.send({ok:true,order:{id:order.id,status:"PAID"},captureId:capture.id});
  });

  app.post("/orders/:id/cancel",async(request,reply)=>{
    const user=await requireUser(request,reply);if(!user)return;
    const params=z.object({id:z.string().min(1)}).safeParse(request.params);if(!params.success)return reply.code(400).send({error:"invalid_request"});
    const rows=await prisma.$queryRawUnsafe<Array<{id:string;buyerId:string;status:string;paymentProvider:string|null;providerCheckoutId:string|null}>>(`SELECT "id","buyerId","status"::text AS "status","paymentProvider","providerCheckoutId" FROM "MarketplaceOrder" WHERE "id"=$1 LIMIT 1`,params.data.id);
    const order=rows[0];if(!order)return reply.code(404).send({error:"order_not_found"});if(order.buyerId!==user.id)return reply.code(403).send({error:"buyer_only"});if(order.status!=="PENDING_PAYMENT")return reply.code(409).send({error:"invalid_order_status"});
    const paid=await prisma.$queryRawUnsafe<Array<{id:string}>>(`SELECT "id" FROM "MarketplacePayment" WHERE "orderId"=$1 AND "status" IN ('AUTHORIZED','CAPTURED','PARTIALLY_REFUNDED','REFUNDED') LIMIT 1`,order.id);if(paid[0])return reply.code(409).send({error:"payment_already_completed"});
    if(order.paymentProvider==="stripe-connect"&&order.providerCheckoutId){try{await cancelMarketplaceCheckout(order.providerCheckoutId)}catch(error){if(String(error).includes("payment_already_completed"))return reply.code(409).send({error:"payment_already_completed"});request.log.error({error,orderId:order.id},"marketplace checkout expiration failed");return reply.code(502).send({error:"payment_cancellation_unavailable"})}}
    await prisma.$transaction(async tx=>{await tx.$executeRawUnsafe(`UPDATE "MarketplaceOrder" SET "status"='CANCELED',"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "status"='PENDING_PAYMENT'`,order.id);await tx.$executeRawUnsafe(`UPDATE "MarketplacePayment" SET "status"='CANCELED',"updatedAt"=CURRENT_TIMESTAMP WHERE "orderId"=$1 AND "status" IN ('CREATED','REQUIRES_ACTION','FAILED')`,order.id);});
    return reply.send({ok:true,order:{id:order.id,status:"CANCELED"}});
  });

  app.get("/orders/:id", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const parsed = z.object({ id: z.string().min(1) }).safeParse(request.params); if (!parsed.success) return reply.code(400).send({ error: "invalid_order" });
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT * FROM "MarketplaceOrder" WHERE "id"=$1 AND ("buyerId"=$2 OR "sellerId"=$2) LIMIT 1`, parsed.data.id, user.id);
    if (!rows[0]) return reply.code(404).send({ error: "order_not_found" }); return reply.send({ order: rows[0] });
  });

  app.post("/orders/:id/refunds", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ amountMinor: z.number().int().positive().optional(), reason: z.string().trim().max(500).optional(), idempotencyKey: z.string().min(12).max(120) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    const rows=await prisma.$queryRawUnsafe<Array<{sellerId:string;buyerId:string;orderNumber:string}>>(`SELECT "sellerId","buyerId","orderNumber" FROM "MarketplaceOrder" WHERE "id"=$1 LIMIT 1`,params.data.id);
    if(!rows[0])return reply.code(404).send({error:"order_not_found"});
    if(rows[0].sellerId!==user.id)return reply.code(403).send({error:"seller_only"});
    try{
      const result=await issueMarketplaceRefund({orderId:params.data.id,amountMinor:body.data.amountMinor,reason:body.data.reason,idempotencyKey:body.data.idempotencyKey});
      const row=rows[0];const done=result.refund.status==="SUCCEEDED";const actionUrl=`/commandes/${params.data.id}#retour`;
      await Promise.all([
        deliverUserEvent({userId:row.buyerId,eventKind:"LISTING",notificationKind:"SYSTEM",title:done?"Remboursement effectué":"Remboursement en cours",body:done?`Le remboursement de la commande ${row.orderNumber} a été confirmé.`:`Le remboursement de la commande ${row.orderNumber} a été lancé et reste en cours de traitement.`,actionUrl,transactional:true,dedupeKey:`refund-direct:${result.refund.id}:${result.refund.status}:buyer`,metadata:{orderId:params.data.id,refundId:result.refund.id,refundStatus:result.refund.status}}),
        deliverUserEvent({userId:row.sellerId,eventKind:"LISTING",notificationKind:"SYSTEM",title:done?"Remboursement confirmé":"Remboursement lancé",body:done?`Le remboursement de la commande ${row.orderNumber} a été confirmé.`:`Le remboursement de la commande ${row.orderNumber} a été transmis au prestataire de paiement.`,actionUrl,transactional:true,dedupeKey:`refund-direct:${result.refund.id}:${result.refund.status}:seller`,metadata:{orderId:params.data.id,refundId:result.refund.id,refundStatus:result.refund.status}})
      ]).catch(()=>undefined);
      return reply.code(done?200:202).send(result);
    }catch(error){
      const code=String(error instanceof Error?error.message:error);
      if(["order_not_found","order_not_refundable","captured_payment_not_found","payment_already_refunded","refund_exceeds_payment","payout_already_released_support_required"].includes(code))return reply.code(code==="order_not_found"?404:409).send({error:code});
      throw error;
    }
  });

  app.post("/orders/:id/payout", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ idempotencyKey: z.string().min(12).max(120) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    const orders = await prisma.$queryRawUnsafe<OrderRow[]>(`SELECT "id","orderNumber","buyerId","sellerId","currency","totalAmountMinor","sellerNetMinor","status","paymentProvider" FROM "MarketplaceOrder" WHERE "id"=$1 LIMIT 1`, params.data.id);
    const order = orders[0];
    if (!order) return reply.code(404).send({ error: "order_not_found" });
    if (order.sellerId !== user.id) return reply.code(403).send({ error: "seller_only" });
    if (order.status!=="COMPLETED") return reply.code(409).send({ error: "payout_not_available" });
    const eligibility=await payoutEligibility(order.id,order.sellerId);
    if(!eligibility.eligibleAt)return reply.code(409).send({error:"payout_schedule_missing"});
    if(eligibility.eligibleAt.getTime()>Date.now())return reply.code(409).send({error:"payout_not_yet_eligible",eligibleAt:eligibility.eligibleAt});
    await upsertPayoutQueue(order,eligibility);
    if(eligibility.activeDispute)return reply.code(409).send({error:"active_dispute",queued:true,payoutState:"BLOCKED"});
    if(eligibility.activeReturn)return reply.code(409).send({error:"active_return_request",queued:true,payoutState:"BLOCKED"});
    if(eligibility.activeRefund)return reply.code(409).send({error:"refund_in_progress",queued:true,payoutState:"BLOCKED"});
    if(eligibility.partialRefundReview)return reply.code(409).send({error:"partial_refund_requires_finance_review",queued:true,payoutState:"BLOCKED"});
    if(!eligibility.riskAllowed)return reply.code(409).send({error:eligibility.riskReason==="RISK_REVIEW_REJECTED"?"payout_risk_review_rejected":"payout_risk_review_required",queued:true,payoutState:"BLOCKED_RISK_REVIEW"});
    if(!eligibility.sellerReady)return reply.code(409).send({error:"seller_payment_account_not_ready",reason:eligibility.sellerReason,queued:true,payoutState:"BLOCKED"});
    if(!eligibility.providerOperational){
      await prisma.$executeRawUnsafe(`UPDATE "MarketplacePayout" SET "status"='BLOCKED',"failureReason"='PROVIDER_PENDING',"updatedAt"=CURRENT_TIMESTAMP WHERE "orderId"=$1 AND "status" IN ('PENDING','BLOCKED','FAILED')`,order.id);
      return reply.code(202).send({queued:true,payout:{orderId:order.id,amountMinor:order.sellerNetMinor,currency:order.currency,status:"BLOCKED",reason:"PROVIDER_PENDING"}});
    }
    try{
      const providerPayout=await executeSellerPayout({sellerId:order.sellerId,orderId:order.id,amountMinor:order.sellerNetMinor,currency:order.currency,idempotencyKey:body.data.idempotencyKey});
      const payoutRows=await prisma.$queryRawUnsafe<Array<{id:string}>>(`UPDATE "MarketplacePayout" SET "providerPayoutId"=$2,"status"='PROCESSING',"failureReason"=NULL,"idempotencyKey"=$3,"updatedAt"=CURRENT_TIMESTAMP WHERE "orderId"=$1 AND "status" IN ('PENDING','BLOCKED','FAILED') RETURNING "id"`,order.id,String(providerPayout.id),body.data.idempotencyKey);
      const payoutId=payoutRows[0]?.id;
      if(!payoutId)return reply.code(409).send({error:"payout_already_processing_or_paid"});
      await prisma.$executeRawUnsafe(`INSERT INTO "FinancialLedgerEntry" ("id","orderId","type","amountMinor","currency","reference") SELECT $1,$2,'PAYOUT',$3,$4,$5 WHERE NOT EXISTS(SELECT 1 FROM "FinancialLedgerEntry" WHERE "reference"=$5)`,randomUUID(),order.id,-order.sellerNetMinor,order.currency,payoutId);
      return reply.code(202).send({queued:false,payout:{id:payoutId,amountMinor:order.sellerNetMinor,currency:order.currency,status:"PROCESSING"}});
    }catch(error){
      const message=String(error instanceof Error?error.message:error).slice(0,500);
      if(message.includes("provider_not_configured")||message.includes("adapter_pending")){
        await prisma.$executeRawUnsafe(`UPDATE "MarketplacePayout" SET "status"='BLOCKED',"failureReason"='PROVIDER_PENDING',"updatedAt"=CURRENT_TIMESTAMP WHERE "orderId"=$1`,order.id);
        return reply.code(202).send({queued:true,payout:{orderId:order.id,amountMinor:order.sellerNetMinor,currency:order.currency,status:"BLOCKED",reason:"PROVIDER_PENDING"}});
      }
      await prisma.$executeRawUnsafe(`UPDATE "MarketplacePayout" SET "status"='FAILED',"failureReason"=$2,"retryCount"="retryCount"+1,"updatedAt"=CURRENT_TIMESTAMP WHERE "orderId"=$1`,order.id,message);
      throw error;
    }
  });

  app.post("/internal/marketplace/payout-sweep", async (request, reply) => {
    const secret=String(request.headers["x-internal-secret"]??"");
    if(!process.env.INTERNAL_CRON_SECRET||secret!==process.env.INTERNAL_CRON_SECRET)return reply.code(401).send({error:"unauthorized"});
    const result=await runObservedJob("marketplace-payout-sweep",async()=>{
      const due=await prisma.$queryRawUnsafe<OrderRow[]>(`SELECT o."id",o."orderNumber",o."buyerId",o."sellerId",o."currency",o."totalAmountMinor",o."sellerNetMinor",o."status"::text,o."paymentProvider" FROM "MarketplaceOrder" o JOIN "BuyerProtectionWindow" bp ON bp."orderId"=o."id" LEFT JOIN "MarketplacePayout" po ON po."orderId"=o."id" WHERE o."status"='COMPLETED' AND bp."payoutEligibleAt"<=CURRENT_TIMESTAMP AND (po."id" IS NULL OR po."status" IN ('PENDING','BLOCKED','FAILED')) LIMIT 100`);
      let queued=0,blocked=0,processing=0,failed=0;
      const runtime=await getPayoutProviderRuntime();
      for(const order of due){
        const eligibility=await payoutEligibility(order.id,order.sellerId);
        const queue=await upsertPayoutQueue(order,eligibility);
        if(queue.reason){
          await deliverUserEvent({userId:order.sellerId,eventKind:"LISTING",notificationKind:"SYSTEM",title:"Versement temporairement en attente",body:payoutBlockMessage(queue.reason,order.orderNumber),actionUrl:`/commandes/${order.id}#versement`,transactional:true,dedupeKey:`payout-blocked:${order.id}:${queue.reason}:seller`,metadata:{orderId:order.id,payoutStatus:"BLOCKED",payoutReason:queue.reason}}).catch(()=>undefined);
          blocked++;continue;
        }
        if(!runtime.operational){await prisma.$executeRawUnsafe(`UPDATE "MarketplacePayout" SET "status"='BLOCKED',"failureReason"='PROVIDER_PENDING',"updatedAt"=CURRENT_TIMESTAMP WHERE "orderId"=$1 AND "status" IN ('PENDING','BLOCKED','FAILED')`,order.id);await deliverUserEvent({userId:order.sellerId,eventKind:"LISTING",notificationKind:"SYSTEM",title:"Versement en attente du prestataire",body:payoutBlockMessage("PROVIDER_PENDING",order.orderNumber),actionUrl:`/commandes/${order.id}#versement`,transactional:true,dedupeKey:`payout-blocked:${order.id}:PROVIDER_PENDING:seller`,metadata:{orderId:order.id,payoutStatus:"BLOCKED",payoutReason:"PROVIDER_PENDING"}}).catch(()=>undefined);blocked++;continue;}
        queued++;
        try{
          const providerPayout=await executeSellerPayout({sellerId:order.sellerId,orderId:order.id,amountMinor:order.sellerNetMinor,currency:order.currency,idempotencyKey:`auto-payout-${order.id}`});
          const payoutRows=await prisma.$queryRawUnsafe<Array<{id:string}>>(`UPDATE "MarketplacePayout" SET "providerPayoutId"=$2,"status"='PROCESSING',"failureReason"=NULL,"updatedAt"=CURRENT_TIMESTAMP WHERE "orderId"=$1 AND "status" IN ('PENDING','BLOCKED','FAILED') RETURNING "id"`,order.id,String(providerPayout.id));
          const payoutId=payoutRows[0]?.id;
          if(payoutId)await prisma.$executeRawUnsafe(`INSERT INTO "FinancialLedgerEntry" ("id","orderId","type","amountMinor","currency","reference") SELECT $1,$2,'PAYOUT',$3,$4,$5 WHERE NOT EXISTS(SELECT 1 FROM "FinancialLedgerEntry" WHERE "reference"=$5)`,randomUUID(),order.id,-order.sellerNetMinor,order.currency,payoutId);
          await deliverUserEvent({userId:order.sellerId,eventKind:"LISTING",notificationKind:"SYSTEM",title:"Versement lancé",body:`Le versement de la commande ${order.orderNumber} a été transmis au prestataire de paiement. Vous serez informé dès sa confirmation.`,actionUrl:`/commandes/${order.id}#versement`,transactional:true,dedupeKey:`payout-processing:${order.id}:seller`,metadata:{orderId:order.id,payoutStatus:"PROCESSING",provider:runtime.provider}}).catch(()=>undefined);
          processing++;
        }catch(error){
          const message=String(error instanceof Error?error.message:error).slice(0,500);
          if(message.includes("provider_not_configured")||message.includes("adapter_pending")){await prisma.$executeRawUnsafe(`UPDATE "MarketplacePayout" SET "status"='BLOCKED',"failureReason"='PROVIDER_PENDING',"updatedAt"=CURRENT_TIMESTAMP WHERE "orderId"=$1`,order.id);await deliverUserEvent({userId:order.sellerId,eventKind:"LISTING",notificationKind:"SYSTEM",title:"Versement en attente du prestataire",body:payoutBlockMessage("PROVIDER_PENDING",order.orderNumber),actionUrl:`/commandes/${order.id}#versement`,transactional:true,dedupeKey:`payout-blocked:${order.id}:PROVIDER_PENDING:seller`,metadata:{orderId:order.id,payoutStatus:"BLOCKED",payoutReason:"PROVIDER_PENDING"}}).catch(()=>undefined);blocked++;continue;}
          await prisma.$executeRawUnsafe(`UPDATE "MarketplacePayout" SET "status"='FAILED',"failureReason"=$2,"retryCount"="retryCount"+1,"updatedAt"=CURRENT_TIMESTAMP WHERE "orderId"=$1`,order.id,message);
          await deliverUserEvent({userId:order.sellerId,eventKind:"LISTING",notificationKind:"SYSTEM",title:"Incident de versement",body:`Le versement de la commande ${order.orderNumber} n’a pas pu être lancé automatiquement. Le dossier reste suivi et une nouvelle tentative pourra être effectuée.`,actionUrl:`/commandes/${order.id}#versement`,transactional:true,dedupeKey:`payout-auto-failed:${order.id}:seller`,metadata:{orderId:order.id,payoutStatus:"FAILED"}}).catch(()=>undefined);
          request.log.error({orderId:order.id,error},"automatic payout failed");failed++;
        }
      }
      return{processed:due.length,queued,blocked,processing,failed,provider:runtime.provider,providerOperational:runtime.operational};
    });
    return reply.send(result);
  });

  app.post("/payments/webhooks/:provider", async (request, reply) => {
    const parsed = z.object({ provider: z.string().min(1).max(40) }).safeParse(request.params); if (!parsed.success) return reply.code(400).send({ error: "invalid_provider" });
    const eventId = String(request.headers["x-provider-event-id"] ?? ""); const signature = String(request.headers["x-provider-signature"] ?? ""); if (!eventId) return reply.code(400).send({ error: "missing_event_id" });
    const raw = JSON.stringify(request.body ?? {}); if (!await verifyWebhookSignature(raw, signature)) return reply.code(401).send({ error: "invalid_webhook_signature" }); const payloadHash = sha256(raw);
    try { await prisma.$executeRawUnsafe(`INSERT INTO "PaymentWebhookEvent" ("id","provider","providerEventId","eventType","payloadHash") VALUES ($1,$2,$3,$4,$5)`, randomUUID(), parsed.data.provider, eventId, String((request.body as { type?: string })?.type ?? "unknown"), payloadHash); } catch { return reply.send({ received: true, duplicate: true }); }
    await prisma.$executeRawUnsafe(`UPDATE "PaymentWebhookEvent" SET "processedAt"=CURRENT_TIMESTAMP WHERE "provider"=$1 AND "providerEventId"=$2`, parsed.data.provider, eventId);
    return reply.send({ received: true });
  });
}
