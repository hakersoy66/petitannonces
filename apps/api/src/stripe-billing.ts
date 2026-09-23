import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getStripeBillingModeRuntime, getStripeBillingRuntime } from "./admin-control.js";
import { handleMarketplaceStripeEvent } from "./marketplace-stripe.js";
import { handleVacationStripeEvent } from "./vacation-payments.js";
import { handlePromotionStripeEvent } from "./growth.js";
import { completePaidListingRenewal, getListingLifecycles, LISTING_RENEWAL_COST_MINOR, LISTING_RENEWAL_CURRENCY, renewExpiredListingInTransaction } from "./listing-lifecycle.js";
import { z } from "zod";
import { consumeSiteCreditInTransaction, ensureSiteCreditSchema, getSiteCreditPackages, grantPurchasedSiteCredit } from "./site-credit.js";
import { nativeExternalDigitalBillingEnabled, nativeExternalProBillingEnabled } from "./native-billing-policy.js";
import { notifyListingIndexNow } from "./indexnow.js";
import { notifyProCancellationScheduled, notifyProPaymentFailed, notifyProPaymentRecovered, notifyProPlanChanged, notifyProPlanChangeCancelled, notifyProPlanChangeScheduled, notifyProReactivated } from "./pro-subscription-notifications.js";

const TOLERANCE_SECONDS = 300;

const SESSION_COOKIE = "pa_session";
function sha256(value: string) { return createHmac("sha256", "").update(value).digest("hex"); }
async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const authHeader=typeof request.headers.authorization==="string"?request.headers.authorization.trim():"";
  const bearer=/^Bearer\s+(.+)$/i.exec(authHeader)?.[1]?.trim()||null;
  const token = bearer ?? request.cookies[SESSION_COOKIE] ?? null;
  if (!token) { reply.code(401).send({ error: "unauthorized" }); return null; }
  const tokenHash = (await import("node:crypto")).createHash("sha256").update(token).digest("hex");
  const session = await prisma.session.findUnique({ where:{ tokenHash }, include:{ user:true } });
  if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== "ACTIVE") { reply.code(401).send({ error:"unauthorized" }); return null; }
  return session.user;
}
async function stripeBillingRuntime() {
  return getStripeBillingRuntime();
}
async function stripeRequest(path:string, init:RequestInit = {}) {
  const runtime = await stripeBillingRuntime();
  if (!runtime?.apiKey) throw new Error("stripe_billing_not_configured");
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${runtime.apiKey}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type","application/x-www-form-urlencoded");
  const response = await fetch(`https://api.stripe.com${path}`, { ...init, headers });
  const payload = await response.json().catch(()=>({})) as Record<string,unknown>;
  if (!response.ok) throw new Error(`stripe_${response.status}_${String((payload.error as any)?.type ?? "error")}`);
  return { payload, runtime };
}

type RawRequest = FastifyRequest & { rawBody?: string | Buffer };
type StripeObject = Record<string, unknown>;

function unixDate(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value * 1000) : null;
}
function stripeId(value: unknown) {
  if (typeof value === "string" && value) return value;
  if (value && typeof value === "object" && typeof (value as Record<string,unknown>).id === "string") return (value as Record<string,string>).id;
  return null;
}
function planCode(obj: StripeObject) {
  const metadata = obj.metadata as Record<string, unknown> | undefined;
  const value = metadata?.pa_plan_code;
  return value === "ESSENTIEL" || value === "PROFESSIONNEL" || value === "PREMIUM" ? value : null;
}
function mapStatus(value: unknown) {
  switch (value) {
    case "trialing": return "TRIALING" as const;
    case "active": return "ACTIVE" as const;
    case "past_due": case "unpaid": case "incomplete": return "PAST_DUE" as const;
    case "canceled": return "CANCELED" as const;
    case "incomplete_expired": case "paused": return "EXPIRED" as const;
    default: return "ACTIVE" as const;
  }
}
function verifyStripeSignature(raw: string, header: string, secret: string) {
  const parts = header.split(",").map((x) => x.trim());
  const timestamp = parts.find((x) => x.startsWith("t="))?.slice(2);
  const signatures = parts.filter((x) => x.startsWith("v1=")).map((x) => x.slice(3));
  if (!timestamp || !signatures.length) return false;
  const t = Number(timestamp);
  if (!Number.isFinite(t) || Math.abs(Math.floor(Date.now() / 1000) - t) > TOLERANCE_SECONDS) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
  const a = Buffer.from(expected);
  return signatures.some((sig) => {
    const b = Buffer.from(sig);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

async function ensurePlans() {
  const defs = [
    { code:"ESSENTIEL" as const,name:"Essentiel",monthlyPriceMinor:990,maxActiveListings:50,maxStores:1,analyticsEnabled:false,featuredCreditsMonthly:0 },
    { code:"PROFESSIONNEL" as const,name:"Professionnel",monthlyPriceMinor:2490,maxActiveListings:250,maxStores:2,analyticsEnabled:true,autoRenewListings:true,featuredCreditsMonthly:0,bulkImportEnabled:true },
    { code:"PREMIUM" as const,name:"Premium",monthlyPriceMinor:4990,maxActiveListings:null,maxStores:5,analyticsEnabled:true,autoRenewListings:true,prioritySupport:true,featuredCreditsMonthly:0,bulkImportEnabled:true,apiFeedEnabled:true },
  ];
  await Promise.all(defs.map((d)=>prisma.professionalPlan.upsert({where:{code:d.code},create:d,update:{}})));
}

async function syncSubscriptionById(subscription: StripeObject) {
  const externalId = typeof subscription.id === "string" ? subscription.id : null;
  if (!externalId) return;
  const existing = await prisma.professionalSubscription.findUnique({ where:{ externalSubscriptionId: externalId }, include:{plan:true} });
  if (!existing) return;
  const code = planCode(subscription);
  const plan = code ? await prisma.professionalPlan.findUnique({ where:{ code } }) : null;
  const nextCancelAtPeriodEnd = Boolean(subscription.cancel_at_period_end);
  const nextPeriodStart = unixDate(subscription.current_period_start);
  const nextPeriodEnd = unixDate(subscription.current_period_end);
  await prisma.professionalSubscription.update({
    where:{ id: existing.id },
    data:{
      ...(plan ? { planId: plan.id } : {}),
      status: mapStatus(subscription.status),
      trialEndsAt: unixDate(subscription.trial_end),
      currentPeriodStart: nextPeriodStart,
      currentPeriodEnd: nextPeriodEnd,
      cancelAtPeriodEnd: nextCancelAtPeriodEnd,
      externalProvider:"stripe",
    },
  });
  if(plan&&existing.planId!==plan.id){
    await notifyProPlanChanged({userId:existing.userId,subscriptionId:existing.id,previousPlan:existing.plan.name,nextPlan:plan.name,dedupeToken:nextPeriodEnd?.toISOString()??externalId}).catch(()=>undefined);
  }
  if(!existing.cancelAtPeriodEnd&&nextCancelAtPeriodEnd){
    await notifyProCancellationScheduled({userId:existing.userId,subscriptionId:existing.id,planName:plan?.name??existing.plan.name,effectiveAt:nextPeriodEnd}).catch(()=>undefined);
  }else if(existing.cancelAtPeriodEnd&&!nextCancelAtPeriodEnd){
    await notifyProReactivated({userId:existing.userId,subscriptionId:existing.id,planName:plan?.name??existing.plan.name,currentPeriodEnd:nextPeriodEnd}).catch(()=>undefined);
  }
}

async function handleCheckoutCompleted(session: StripeObject) {
  const userId = typeof session.client_reference_id === "string" ? session.client_reference_id : null;
  const subscriptionId = typeof session.subscription === "string" ? session.subscription : null;
  const customerId = typeof session.customer === "string" ? session.customer : null;
  const code = planCode(session);
  if (!userId || !subscriptionId || !code) return;
  const [user,plan] = await Promise.all([
    prisma.user.findUnique({where:{id:userId},select:{id:true,kind:true}}),
    prisma.professionalPlan.findUnique({where:{code}}),
  ]);
  if (!user || !plan) return;
  if (user.kind !== "PROFESSIONNEL") await prisma.user.update({where:{id:user.id},data:{kind:"PROFESSIONNEL"}});
  await prisma.professionalSubscription.upsert({
    where:{ externalSubscriptionId: subscriptionId },
    create:{ userId:user.id,planId:plan.id,status:"ACTIVE",externalProvider:"stripe",externalSubscriptionId:subscriptionId },
    update:{ userId:user.id,planId:plan.id,status:"ACTIVE",externalProvider:"stripe" },
  });
  if (customerId) {
    // Customer id is intentionally not persisted until the schema has a dedicated field.
  }
}


async function handleSiteCreditCheckoutEvent(eventType:string,session:StripeObject){
  const metadata=session.metadata as Record<string,unknown>|undefined;
  if(metadata?.pa_site_credit!=="true")return false;
  if(!["checkout.session.completed","checkout.session.async_payment_succeeded"].includes(eventType))return true;
  if(session.payment_status!=="paid")return true;
  const userId=typeof metadata.pa_user_id==="string"?metadata.pa_user_id:null;
  const packageId=typeof metadata.pa_credit_package_id==="string"?metadata.pa_credit_package_id:null;
  const creditMinor=Number(metadata.pa_credit_minor);
  const expectedPriceMinor=Number(metadata.pa_price_minor);
  const paidMinor=typeof session.amount_total==="number"?session.amount_total:NaN;
  const sessionId=typeof session.id==="string"?session.id:null;
  if(!userId||!packageId||!sessionId||!Number.isInteger(creditMinor)||creditMinor<=0||!Number.isInteger(expectedPriceMinor)||expectedPriceMinor<=0||paidMinor!==expectedPriceMinor)throw new Error("site_credit_checkout_mismatch");
  const user=await prisma.user.findUnique({where:{id:userId},select:{id:true,status:true}});
  if(!user||user.status!=="ACTIVE")throw new Error("site_credit_user_unavailable");
  await grantPurchasedSiteCredit(user.id,creditMinor,sessionId,{packageId,pricePaidMinor:paidMinor,stripeCheckoutSessionId:sessionId,nonWithdrawable:true,platformServicesOnly:true});
  return true;
}

async function handleListingRenewalCheckoutCompleted(session:StripeObject){
  const metadata=session.metadata as Record<string,unknown>|undefined;if(metadata?.pa_listing_renewal!=="true")return false;
  const userId=typeof metadata.pa_user_id==="string"?metadata.pa_user_id:null;const listingId=typeof metadata.pa_listing_id==="string"?metadata.pa_listing_id:null;const expected=Number(metadata.pa_amount_minor);const amount=typeof session.amount_total==="number"?session.amount_total:NaN;const paid=session.payment_status==="paid";
  if(!userId||!listingId||!Number.isFinite(expected)||expected!==LISTING_RENEWAL_COST_MINOR||amount!==expected||!paid)return true;
  try{await completePaidListingRenewal(listingId,userId)}catch(error){if(!(error instanceof Error)||!["listing_not_expired","free_renewal_available"].includes(error.message))throw error}
  return true;
}

async function ensureWebhookAuditSchema(){
  await prisma.$executeRawUnsafe(`ALTER TABLE "PaymentWebhookEvent" ADD COLUMN IF NOT EXISTS "attemptCount" INTEGER NOT NULL DEFAULT 0`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "PaymentWebhookEvent" ADD COLUMN IF NOT EXISTS "lastAttemptAt" TIMESTAMP(3)`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "PaymentWebhookEvent" ADD COLUMN IF NOT EXISTS "lastError" TEXT`);
}

export async function registerStripeBillingRoutes(app: FastifyInstance) {
  app.get("/billing/native-policy",async(request,reply)=>{const user=await requireUser(request,reply);if(!user)return;return reply.send({externalDigitalBillingEnabled:nativeExternalDigitalBillingEnabled(),externalProBillingEnabled:nativeExternalProBillingEnabled()})});


  app.post("/billing/stripe/credits/checkout",async(request,reply)=>{
    const user=await requireUser(request,reply);if(!user)return;
    const body=z.object({packageId:z.string().min(1).max(120),returnMode:z.enum(["WEB","NATIVE"]).optional().default("WEB"),appScheme:z.enum(["petitannonces","petitannonces-development","petitannonces-preview"]).optional().default("petitannonces")}).safeParse(request.body);if(!body.success)return reply.code(400).send({error:"invalid_request"});
    if(body.data.returnMode==="NATIVE"&&!nativeExternalDigitalBillingEnabled())return reply.code(403).send({error:"native_external_digital_billing_disabled"});
    const packages=await getSiteCreditPackages(false);const pack=packages.find(item=>item.id===body.data.packageId);
    if(!pack)return reply.code(404).send({error:"site_credit_package_not_found"});
    if(pack.currency!=="EUR"||pack.priceMinor<=0||pack.creditMinor<=0)return reply.code(409).send({error:"site_credit_package_invalid"});
    try{
      const params=new URLSearchParams();
      params.set("mode","payment");params.set("client_reference_id",user.id);params.set("customer_email",user.email);
      const nativeReturn=body.data.returnMode==="NATIVE";params.set("success_url",nativeReturn?`https://petitannonces.fr/app/return?target=wallet&result=success&scheme=${encodeURIComponent(body.data.appScheme)}`:"https://petitannonces.fr/mon-compte/portefeuille?credit=success");params.set("cancel_url",nativeReturn?`https://petitannonces.fr/app/return?target=wallet&result=cancel&scheme=${encodeURIComponent(body.data.appScheme)}`:"https://petitannonces.fr/mon-compte/portefeuille?credit=cancelled");
      params.set("line_items[0][quantity]","1");params.set("line_items[0][price_data][currency]",pack.currency.toLowerCase());params.set("line_items[0][price_data][unit_amount]",String(pack.priceMinor));
      params.set("line_items[0][price_data][product_data][name]",`Crédit Petit Annonces · ${(pack.creditMinor/100).toFixed(2)} €`.slice(0,120));
      params.set("line_items[0][price_data][product_data][description]","Crédit non remboursable en espèces, utilisable uniquement pour les services Petit Annonces.");
      params.set("metadata[pa_site_credit]","true");params.set("metadata[pa_user_id]",user.id);params.set("metadata[pa_credit_package_id]",pack.id);params.set("metadata[pa_credit_minor]",String(pack.creditMinor));params.set("metadata[pa_price_minor]",String(pack.priceMinor));
      const checkout=await stripeRequest("/v1/checkout/sessions",{method:"POST",body:params.toString()});
      const url=typeof checkout.payload.url==="string"?checkout.payload.url:null;if(!url)return reply.code(502).send({error:"stripe_checkout_url_missing"});
      return reply.send({url,package:{id:pack.id,name:pack.name,creditMinor:pack.creditMinor,priceMinor:pack.priceMinor,currency:pack.currency}});
    }catch(error){request.log.error({error,packageId:body.data.packageId},"site credit checkout failed");return reply.code(503).send({error:"stripe_site_credit_checkout_unavailable"})}
  });

  app.post("/billing/stripe/listing-renewal/checkout",async(request,reply)=>{
    const user=await requireUser(request,reply);if(!user)return;
    const body=z.object({listingId:z.string().min(1),returnMode:z.enum(["WEB","NATIVE"]).optional().default("WEB"),appScheme:z.enum(["petitannonces","petitannonces-development","petitannonces-preview"]).optional().default("petitannonces")}).safeParse(request.body);if(!body.success)return reply.code(400).send({error:"invalid_request"});
    if(body.data.returnMode==="NATIVE"&&!nativeExternalDigitalBillingEnabled())return reply.code(403).send({error:"native_external_digital_billing_disabled"});
    const listing=await prisma.listing.findFirst({where:{id:body.data.listingId,sellerId:user.id,status:{in:["EXPIRED","DRAFT"]}},select:{id:true,title:true}});if(!listing)return reply.code(404).send({error:"listing_not_found"});
    const lifecycle=(await getListingLifecycles([listing.id]))[0];if(!lifecycle)return reply.code(409).send({error:"listing_lifecycle_not_found"});if(lifecycle.expiresAt.getTime()>Date.now())return reply.code(409).send({error:"listing_not_expired"});if(!lifecycle.freeRenewalUsed)return reply.code(409).send({error:"free_renewal_available"});
    await ensureSiteCreditSchema();
    try{
      const creditFlow=await prisma.$transaction(async(tx:any)=>{
        const credit=await consumeSiteCreditInTransaction(tx,user.id,LISTING_RENEWAL_COST_MINOR,"LISTING_RENEWAL",listing.id+":"+String(lifecycle.renewalCount+1),{listingId:listing.id,days:30});
        if(!credit.consumed)return {credit,renewal:null};
        const renewal=await renewExpiredListingInTransaction(tx,listing.id,user.id,true);
        return {credit,renewal};
      });
      if(creditFlow.credit.consumed&&creditFlow.renewal){
        if(creditFlow.renewal.status==="PUBLISHED")await notifyListingIndexNow(creditFlow.renewal.listingId).catch(error=>request.log.warn({error,listingId:creditFlow.renewal!.listingId},"indexnow notification failed after site-credit listing renewal"));
        return reply.send({paidWith:"SITE_CREDIT",amountMinor:LISTING_RENEWAL_COST_MINOR,currency:LISTING_RENEWAL_CURRENCY,creditBalanceMinor:creditFlow.credit.balanceMinor,renewal:creditFlow.renewal});
      }
    }catch(error){const code=error instanceof Error?error.message:"listing_renewal_failed";if(["listing_not_found","listing_not_expired","free_renewal_available"].includes(code))return reply.code(409).send({error:code});request.log.error({error},"site credit listing renewal failed");return reply.code(500).send({error:"listing_renewal_failed"})}
    try{
      const params=new URLSearchParams();params.set("mode","payment");params.set("client_reference_id",user.id);params.set("customer_email",user.email);const nativeReturn=body.data.returnMode==="NATIVE";params.set("success_url",nativeReturn?`https://petitannonces.fr/app/return?target=listings&result=success&scheme=${encodeURIComponent(body.data.appScheme)}`:"https://petitannonces.fr/mon-compte/annonces?renewal=success");params.set("cancel_url",nativeReturn?`https://petitannonces.fr/app/return?target=listings&result=cancel&scheme=${encodeURIComponent(body.data.appScheme)}`:"https://petitannonces.fr/mon-compte/annonces?renewal=cancelled");params.set("line_items[0][quantity]","1");params.set("line_items[0][price_data][currency]",LISTING_RENEWAL_CURRENCY.toLowerCase());params.set("line_items[0][price_data][unit_amount]",String(LISTING_RENEWAL_COST_MINOR));params.set("line_items[0][price_data][product_data][name]",`Prolongation de 30 jours · ${listing.title??"Annonce"}`.slice(0,120));params.set("metadata[pa_listing_renewal]","true");params.set("metadata[pa_user_id]",user.id);params.set("metadata[pa_listing_id]",listing.id);params.set("metadata[pa_amount_minor]",String(LISTING_RENEWAL_COST_MINOR));const checkout=await stripeRequest("/v1/checkout/sessions",{method:"POST",body:params.toString()});const url=typeof checkout.payload.url==="string"?checkout.payload.url:null;if(!url)return reply.code(502).send({error:"stripe_checkout_url_missing"});return reply.send({url,amountMinor:LISTING_RENEWAL_COST_MINOR,currency:LISTING_RENEWAL_CURRENCY});
    }catch(error){request.log.error({error},"listing renewal checkout failed");return reply.code(503).send({error:"stripe_listing_renewal_unavailable"})}
  });

  app.get("/billing/stripe/subscription/summary", async (request, reply) => {
    const user=await requireUser(request,reply);if(!user)return;
    await ensurePlans();
    const [plans,local]=await Promise.all([
      prisma.professionalPlan.findMany({where:{isActive:true},orderBy:{monthlyPriceMinor:"asc"}}),
      prisma.professionalSubscription.findFirst({where:{userId:user.id},include:{plan:true},orderBy:{createdAt:"desc"}}),
    ]);
    let invoices:Array<Record<string,unknown>>=[];
    let stripeReachable=false;
    let paymentMethod:null|{type:string;brand:string|null;last4:string|null;expMonth:number|null;expYear:number|null}=null;
    let upcomingInvoice:null|{amountDueMinor:number;currency:string;chargeAt:string|null;periodStart:string|null;periodEnd:string|null}=null;
    let pendingChange:null|{planCode:"ESSENTIEL"|"PROFESSIONNEL"|"PREMIUM";effectiveAt:string|null;scheduleId:string}=null;
    if(local?.externalProvider==="stripe"&&local.externalSubscriptionId){
      try{
        const sub=await stripeRequest(`/v1/subscriptions/${encodeURIComponent(local.externalSubscriptionId)}`);
        stripeReachable=true;
        const customer=typeof sub.payload.customer==="string"?sub.payload.customer:null;
        const scheduleId=stripeId(sub.payload.schedule);
        if(scheduleId){
          try{
            const schedule=await stripeRequest(`/v1/subscription_schedules/${encodeURIComponent(scheduleId)}`);
            const metadata=(schedule.payload.metadata&&typeof schedule.payload.metadata==="object"?schedule.payload.metadata:{}) as Record<string,unknown>;
            const target=metadata.pa_target_plan_code;
            if(target==="ESSENTIEL"||target==="PROFESSIONNEL"||target==="PREMIUM"){
              const currentPhase=(schedule.payload.current_phase&&typeof schedule.payload.current_phase==="object"?schedule.payload.current_phase:{}) as Record<string,unknown>;
              const effectiveUnix=typeof currentPhase.end_date==="number"?currentPhase.end_date:typeof sub.payload.current_period_end==="number"?sub.payload.current_period_end:null;
              pendingChange={planCode:target,effectiveAt:effectiveUnix?new Date(effectiveUnix*1000).toISOString():null,scheduleId};
            }
          }catch(error){request.log.warn({error,scheduleId},"stripe scheduled subscription change unavailable")}
        }
        if(customer){
          let paymentMethodId=stripeId(sub.payload.default_payment_method);
          try{
            const customerResult=await stripeRequest(`/v1/customers/${encodeURIComponent(customer)}`);
            const invoiceSettings=(customerResult.payload.invoice_settings&&typeof customerResult.payload.invoice_settings==="object"?customerResult.payload.invoice_settings:{}) as Record<string,unknown>;
            if(!paymentMethodId)paymentMethodId=stripeId(invoiceSettings.default_payment_method);
          }catch{}
          if(!paymentMethodId){
            try{
              const methods=await stripeRequest(`/v1/payment_methods?customer=${encodeURIComponent(customer)}&type=card&limit=1`);
              const methodRows=Array.isArray((methods.payload as any).data)?(methods.payload as any).data:[];
              paymentMethodId=typeof methodRows[0]?.id==="string"?methodRows[0].id:null;
            }catch{}
          }
          if(paymentMethodId){
            try{
              const pm=await stripeRequest(`/v1/payment_methods/${encodeURIComponent(paymentMethodId)}`);
              const type=typeof pm.payload.type==="string"?pm.payload.type:"unknown";
              const details=(pm.payload[type]&&typeof pm.payload[type]==="object"?pm.payload[type]:{}) as Record<string,unknown>;
              paymentMethod={
                type,
                brand:typeof details.brand==="string"?details.brand:type==="sepa_debit"?"SEPA":null,
                last4:typeof details.last4==="string"?details.last4:null,
                expMonth:typeof details.exp_month==="number"?details.exp_month:null,
                expYear:typeof details.exp_year==="number"?details.exp_year:null,
              };
            }catch{}
          }
          if(!local.cancelAtPeriodEnd){
            try{
              const previewParams=new URLSearchParams();
              previewParams.set("customer",customer);
              previewParams.set("subscription",local.externalSubscriptionId);
              const preview=await stripeRequest("/v1/invoices/create_preview",{method:"POST",body:previewParams.toString()});
              const chargeUnix=typeof preview.payload.next_payment_attempt==="number"?preview.payload.next_payment_attempt:typeof preview.payload.period_end==="number"?preview.payload.period_end:typeof sub.payload.current_period_end==="number"?sub.payload.current_period_end:null;
              upcomingInvoice={
                amountDueMinor:Number(preview.payload.amount_due??0),
                currency:String(preview.payload.currency??local.plan.currency??"EUR").toUpperCase(),
                chargeAt:chargeUnix?new Date(chargeUnix*1000).toISOString():null,
                periodStart:typeof preview.payload.period_start==="number"?new Date(preview.payload.period_start*1000).toISOString():null,
                periodEnd:typeof preview.payload.period_end==="number"?new Date(preview.payload.period_end*1000).toISOString():null,
              };
            }catch{}
          }
          const inv=await stripeRequest(`/v1/invoices?customer=${encodeURIComponent(customer)}&limit=12`);
          const rows=Array.isArray((inv.payload as any).data)?(inv.payload as any).data:[];
          invoices=rows.map((x:any)=>({
            id:String(x.id??""),number:typeof x.number==="string"?x.number:null,status:typeof x.status==="string"?x.status:null,
            amountDueMinor:Number(x.amount_due??0),amountPaidMinor:Number(x.amount_paid??0),currency:String(x.currency??"EUR").toUpperCase(),
            createdAt:typeof x.created==="number"?new Date(x.created*1000).toISOString():null,
            periodStart:typeof x.period_start==="number"?new Date(x.period_start*1000).toISOString():null,periodEnd:typeof x.period_end==="number"?new Date(x.period_end*1000).toISOString():null,
            hostedInvoiceUrl:typeof x.hosted_invoice_url==="string"?x.hosted_invoice_url:null,invoicePdfUrl:typeof x.invoice_pdf==="string"?x.invoice_pdf:null,
          }));
        }
      }catch(error){request.log.warn({error},"stripe subscription summary remote data unavailable")}
    }
    return reply.send({
      externalBillingEnabled:nativeExternalProBillingEnabled(),
      stripeReachable,
      subscription:local?{id:local.id,status:local.status,externalProvider:local.externalProvider,externalSubscriptionId:local.externalSubscriptionId,trialEndsAt:local.trialEndsAt,currentPeriodStart:local.currentPeriodStart,currentPeriodEnd:local.currentPeriodEnd,cancelAtPeriodEnd:local.cancelAtPeriodEnd,plan:local.plan}:null,
      plans:plans.map(plan=>({id:plan.id,code:plan.code,name:plan.name,description:plan.description,monthlyPriceMinor:plan.monthlyPriceMinor,currency:plan.currency,maxActiveListings:plan.maxActiveListings,maxStores:plan.maxStores,analyticsEnabled:plan.analyticsEnabled,autoRenewListings:plan.autoRenewListings,prioritySupport:plan.prioritySupport,bulkImportEnabled:plan.bulkImportEnabled,apiFeedEnabled:plan.apiFeedEnabled})),
      paymentMethod,
      upcomingInvoice,
      pendingChange,
      invoices,
    });
  });

  app.post("/billing/stripe/subscription/checkout", async (request, reply) => {
    const user=await requireUser(request,reply);if(!user)return;
    const body=z.object({planCode:z.enum(["ESSENTIEL","PROFESSIONNEL","PREMIUM"]),returnMode:z.enum(["WEB","NATIVE"]).optional().default("WEB"),appScheme:z.enum(["petitannonces","petitannonces-development","petitannonces-preview"]).optional().default("petitannonces")}).safeParse(request.body);if(!body.success)return reply.code(400).send({error:"invalid_request"});
    if(body.data.returnMode==="NATIVE"&&!nativeExternalProBillingEnabled())return reply.code(403).send({error:"native_external_billing_disabled"});
    await ensurePlans();
    const active=await prisma.professionalSubscription.findFirst({where:{userId:user.id,externalProvider:"stripe",status:{in:["TRIALING","ACTIVE","PAST_DUE"]}},select:{id:true}});if(active)return reply.code(409).send({error:"stripe_subscription_already_active"});
    const plan=await prisma.professionalPlan.findUnique({where:{code:body.data.planCode}});if(!plan||!plan.isActive)return reply.code(404).send({error:"professional_plan_not_found"});
    try{
      const params=new URLSearchParams();
      params.set("mode","subscription");
      params.set("client_reference_id",user.id);
      params.set("customer_email",user.email);
      const nativeReturn=body.data.returnMode==="NATIVE";
      params.set("success_url",nativeReturn?`https://petitannonces.fr/app/subscription?result=success&scheme=${encodeURIComponent(body.data.appScheme)}`:"https://petitannonces.fr/espace-pro/abonnement?stripe=success");
      params.set("cancel_url",nativeReturn?`https://petitannonces.fr/app/subscription?result=cancel&scheme=${encodeURIComponent(body.data.appScheme)}`:"https://petitannonces.fr/espace-pro/abonnement?stripe=cancelled");
      params.set("allow_promotion_codes","true");
      params.set("line_items[0][quantity]","1");
      params.set("line_items[0][price_data][currency]",String(plan.currency??"EUR").toLowerCase());
      params.set("line_items[0][price_data][unit_amount]",String(plan.monthlyPriceMinor));
      params.set("line_items[0][price_data][recurring][interval]","month");
      params.set("line_items[0][price_data][product_data][name]",`Petit Annonces Pro · ${plan.name}`.slice(0,120));
      params.set("metadata[pa_plan_code]",plan.code);
      params.set("metadata[pa_user_id]",user.id);
      params.set("subscription_data[metadata][pa_plan_code]",plan.code);
      params.set("subscription_data[metadata][pa_user_id]",user.id);
      const checkout=await stripeRequest("/v1/checkout/sessions",{method:"POST",body:params.toString()});
      const url=typeof checkout.payload.url==="string"?checkout.payload.url:null;if(!url)return reply.code(502).send({error:"stripe_checkout_url_missing"});
      return reply.send({url,planCode:plan.code,amountMinor:plan.monthlyPriceMinor,currency:plan.currency});
    }catch(error){request.log.error({error,planCode:body.data.planCode},"stripe subscription checkout failed");return reply.code(503).send({error:"stripe_subscription_checkout_unavailable"})}
  });

  app.post("/billing/stripe/subscription/change", async (request, reply) => {
    const user=await requireUser(request,reply);if(!user)return;
    const body=z.object({planCode:z.enum(["ESSENTIEL","PROFESSIONNEL","PREMIUM"])}).safeParse(request.body);if(!body.success)return reply.code(400).send({error:"invalid_request"});
    await ensurePlans();
    const [local,target]=await Promise.all([
      prisma.professionalSubscription.findFirst({where:{userId:user.id,externalProvider:"stripe",externalSubscriptionId:{not:null},status:{in:["TRIALING","ACTIVE","PAST_DUE"]}},include:{plan:true},orderBy:{createdAt:"desc"}}),
      prisma.professionalPlan.findUnique({where:{code:body.data.planCode}}),
    ]);
    if(!local?.externalSubscriptionId)return reply.code(409).send({error:"stripe_subscription_required_for_change"});
    if(!target||!target.isActive)return reply.code(404).send({error:"professional_plan_not_found"});
    if(local.plan.code===target.code)return reply.code(409).send({error:"plan_already_active"});
    try{
      const sub=await stripeRequest(`/v1/subscriptions/${encodeURIComponent(local.externalSubscriptionId)}`);
      if(stripeId(sub.payload.schedule))return reply.code(409).send({error:"subscription_change_already_scheduled"});
      const items=(sub.payload.items&&typeof sub.payload.items==="object"?(sub.payload.items as Record<string,unknown>).data:null);
      const item=Array.isArray(items)?items[0] as Record<string,unknown>|undefined:undefined;
      const itemId=stripeId(item);
      const price=item?.price&&typeof item.price==="object"?item.price as Record<string,unknown>:null;
      const currentPriceId=stripeId(price);
      const productId=stripeId(price?.product);
      const currentStart=typeof sub.payload.current_period_start==="number"?sub.payload.current_period_start:null;
      const currentEnd=typeof sub.payload.current_period_end==="number"?sub.payload.current_period_end:null;
      if(!itemId||!currentPriceId||!productId||!currentStart||!currentEnd)return reply.code(409).send({error:"stripe_subscription_item_unavailable"});
      const immediate=local.status==="TRIALING"||target.monthlyPriceMinor>local.plan.monthlyPriceMinor;
      if(immediate){
        const params=new URLSearchParams();
        params.set("items[0][id]",itemId);
        params.set("items[0][price_data][currency]",String(target.currency??"EUR").toLowerCase());
        params.set("items[0][price_data][product]",productId);
        params.set("items[0][price_data][recurring][interval]","month");
        params.set("items[0][price_data][unit_amount]",String(target.monthlyPriceMinor));
        params.set("items[0][quantity]","1");
        params.set("metadata[pa_plan_code]",target.code);
        params.set("metadata[pa_user_id]",user.id);
        params.set("cancel_at_period_end","false");
        params.set("proration_behavior",local.status==="TRIALING"?"none":"always_invoice");
        params.set("payment_behavior","pending_if_incomplete");
        const updated=await stripeRequest(`/v1/subscriptions/${encodeURIComponent(local.externalSubscriptionId)}`,{method:"POST",body:params.toString()});
        const pending=Boolean(updated.payload.pending_update);
        if(!pending)await syncSubscriptionById(updated.payload);
        return reply.send({mode:"immediate",planCode:target.code,pendingPayment:pending,effectiveAt:new Date().toISOString()});
      }
      const createParams=new URLSearchParams();createParams.set("from_subscription",local.externalSubscriptionId);
      const created=await stripeRequest("/v1/subscription_schedules",{method:"POST",body:createParams.toString()});
      const scheduleId=stripeId(created.payload);if(!scheduleId)return reply.code(502).send({error:"stripe_schedule_missing"});
      try{
        const params=new URLSearchParams();
        params.set("end_behavior","release");
        params.set("proration_behavior","none");
        params.set("metadata[pa_managed_plan_change]","true");
        params.set("metadata[pa_target_plan_code]",target.code);
        params.set("metadata[pa_user_id]",user.id);
        params.set("phases[0][start_date]",String(currentStart));
        params.set("phases[0][end_date]",String(currentEnd));
        params.set("phases[0][items][0][price]",currentPriceId);
        params.set("phases[0][items][0][quantity]","1");
        params.set("phases[0][proration_behavior]","none");
        params.set("phases[0][metadata][pa_plan_code]",local.plan.code);
        params.set("phases[1][start_date]",String(currentEnd));
        params.set("phases[1][items][0][price_data][currency]",String(target.currency??"EUR").toLowerCase());
        params.set("phases[1][items][0][price_data][product]",productId);
        params.set("phases[1][items][0][price_data][recurring][interval]","month");
        params.set("phases[1][items][0][price_data][unit_amount]",String(target.monthlyPriceMinor));
        params.set("phases[1][items][0][quantity]","1");
        params.set("phases[1][iterations]","1");
        params.set("phases[1][proration_behavior]","none");
        params.set("phases[1][metadata][pa_plan_code]",target.code);
        await stripeRequest(`/v1/subscription_schedules/${encodeURIComponent(scheduleId)}`,{method:"POST",body:params.toString()});
        const effectiveAt=new Date(currentEnd*1000).toISOString();
        await notifyProPlanChangeScheduled({userId:user.id,subscriptionId:local.id,previousPlan:local.plan.name,nextPlan:target.name,effectiveAt}).catch(()=>undefined);
        return reply.send({mode:"period_end",planCode:target.code,effectiveAt,scheduleId});
      }catch(error){
        await stripeRequest(`/v1/subscription_schedules/${encodeURIComponent(scheduleId)}/release`,{method:"POST"}).catch(()=>undefined);
        throw error;
      }
    }catch(error){request.log.error({error,planCode:body.data.planCode},"stripe subscription change failed");return reply.code(503).send({error:"stripe_subscription_change_unavailable"})}
  });

  app.post("/billing/stripe/subscription/change/cancel", async (request, reply) => {
    const user=await requireUser(request,reply);if(!user)return;
    const local=await prisma.professionalSubscription.findFirst({where:{userId:user.id,externalProvider:"stripe",externalSubscriptionId:{not:null},status:{in:["TRIALING","ACTIVE","PAST_DUE"]}},include:{plan:true},orderBy:{createdAt:"desc"}});
    if(!local?.externalSubscriptionId)return reply.code(404).send({error:"stripe_subscription_not_found"});
    try{
      const sub=await stripeRequest(`/v1/subscriptions/${encodeURIComponent(local.externalSubscriptionId)}`);
      const scheduleId=stripeId(sub.payload.schedule);if(!scheduleId)return reply.code(404).send({error:"scheduled_change_not_found"});
      const schedule=await stripeRequest(`/v1/subscription_schedules/${encodeURIComponent(scheduleId)}`);
      const metadata=(schedule.payload.metadata&&typeof schedule.payload.metadata==="object"?schedule.payload.metadata:{}) as Record<string,unknown>;
      if(metadata.pa_managed_plan_change!=="true")return reply.code(409).send({error:"external_subscription_schedule"});
      await stripeRequest(`/v1/subscription_schedules/${encodeURIComponent(scheduleId)}/release`,{method:"POST"});
      await notifyProPlanChangeCancelled({userId:user.id,subscriptionId:local.id,planName:local.plan.name,scheduleId}).catch(()=>undefined);
      return reply.send({cancelled:true});
    }catch(error){request.log.error({error},"stripe scheduled subscription change cancel failed");return reply.code(503).send({error:"stripe_subscription_change_cancel_unavailable"})}
  });

  app.post("/billing/stripe/subscription/cancel", async (request, reply) => {
    const user=await requireUser(request,reply);if(!user)return;
    const local=await prisma.professionalSubscription.findFirst({where:{userId:user.id,externalProvider:"stripe",externalSubscriptionId:{not:null},status:{in:["TRIALING","ACTIVE","PAST_DUE"]}},orderBy:{createdAt:"desc"}});
    if(!local?.externalSubscriptionId)return reply.code(404).send({error:"stripe_subscription_not_found"});
    try{
      let sub=await stripeRequest(`/v1/subscriptions/${encodeURIComponent(local.externalSubscriptionId)}`);
      const scheduleId=stripeId(sub.payload.schedule);
      if(scheduleId){
        const schedule=await stripeRequest(`/v1/subscription_schedules/${encodeURIComponent(scheduleId)}`);
        const metadata=(schedule.payload.metadata&&typeof schedule.payload.metadata==="object"?schedule.payload.metadata:{}) as Record<string,unknown>;
        if(metadata.pa_managed_plan_change!=="true")return reply.code(409).send({error:"external_subscription_schedule"});
        await stripeRequest(`/v1/subscription_schedules/${encodeURIComponent(scheduleId)}/release`,{method:"POST"});
        sub=await stripeRequest(`/v1/subscriptions/${encodeURIComponent(local.externalSubscriptionId)}`);
      }
      if(Boolean(sub.payload.cancel_at_period_end)){
        const end=typeof sub.payload.current_period_end==="number"?new Date(sub.payload.current_period_end*1000).toISOString():local.currentPeriodEnd?.toISOString()??null;
        return reply.send({cancelAtPeriodEnd:true,effectiveAt:end,alreadyScheduled:true});
      }
      const params=new URLSearchParams();params.set("cancel_at_period_end","true");
      const updated=await stripeRequest(`/v1/subscriptions/${encodeURIComponent(local.externalSubscriptionId)}`,{method:"POST",body:params.toString()});
      await syncSubscriptionById(updated.payload);
      const end=typeof updated.payload.current_period_end==="number"?new Date(updated.payload.current_period_end*1000).toISOString():local.currentPeriodEnd?.toISOString()??null;
      return reply.send({cancelAtPeriodEnd:true,effectiveAt:end});
    }catch(error){request.log.error({error},"stripe subscription cancellation scheduling failed");return reply.code(503).send({error:"stripe_subscription_cancel_unavailable"})}
  });

  app.post("/billing/stripe/subscription/reactivate", async (request, reply) => {
    const user=await requireUser(request,reply);if(!user)return;
    const local=await prisma.professionalSubscription.findFirst({where:{userId:user.id,externalProvider:"stripe",externalSubscriptionId:{not:null},status:{in:["TRIALING","ACTIVE","PAST_DUE"]}},orderBy:{createdAt:"desc"}});
    if(!local?.externalSubscriptionId)return reply.code(404).send({error:"stripe_subscription_not_found"});
    try{
      const sub=await stripeRequest(`/v1/subscriptions/${encodeURIComponent(local.externalSubscriptionId)}`);
      if(!Boolean(sub.payload.cancel_at_period_end)){await syncSubscriptionById(sub.payload);return reply.send({reactivated:true,alreadyActive:true});}
      const params=new URLSearchParams();params.set("cancel_at_period_end","false");
      const updated=await stripeRequest(`/v1/subscriptions/${encodeURIComponent(local.externalSubscriptionId)}`,{method:"POST",body:params.toString()});
      await syncSubscriptionById(updated.payload);
      const end=typeof updated.payload.current_period_end==="number"?new Date(updated.payload.current_period_end*1000).toISOString():local.currentPeriodEnd?.toISOString()??null;
      return reply.send({reactivated:true,currentPeriodEnd:end});
    }catch(error){request.log.error({error},"stripe subscription reactivation failed");return reply.code(503).send({error:"stripe_subscription_reactivate_unavailable"})}
  });

  app.post("/billing/stripe/portal", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const body=z.object({returnMode:z.enum(["WEB","NATIVE"]).optional().default("WEB"),appScheme:z.enum(["petitannonces","petitannonces-development","petitannonces-preview"]).optional().default("petitannonces")}).safeParse(request.body??{});if(!body.success)return reply.code(400).send({error:"invalid_request"});
    if(body.data.returnMode==="NATIVE"&&!nativeExternalProBillingEnabled())return reply.code(403).send({error:"native_external_billing_disabled"});
    const local = await prisma.professionalSubscription.findFirst({
      where:{ userId:user.id, externalProvider:"stripe", externalSubscriptionId:{ not:null }, status:{ in:["TRIALING","ACTIVE","PAST_DUE"] } },
      orderBy:{ createdAt:"desc" },
    });
    if (!local?.externalSubscriptionId) return reply.code(404).send({ error:"stripe_subscription_not_found" });
    try {
      const sub = await stripeRequest(`/v1/subscriptions/${encodeURIComponent(local.externalSubscriptionId)}`);
      const customer = typeof sub.payload.customer === "string" ? sub.payload.customer : null;
      if (!customer) return reply.code(409).send({ error:"stripe_customer_not_found" });
      const params = new URLSearchParams();
      params.set("customer",customer);
      params.set("return_url",body.data.returnMode==="NATIVE"?`https://petitannonces.fr/app/subscription?result=portal_return&scheme=${encodeURIComponent(body.data.appScheme)}`:"https://petitannonces.fr/espace-pro/abonnement?stripe=portal_return");
      if (sub.runtime.portalConfigurationId) params.set("configuration",sub.runtime.portalConfigurationId);
      const portal = await stripeRequest("/v1/billing_portal/sessions", { method:"POST", body:params.toString() });
      const url = typeof portal.payload.url === "string" ? portal.payload.url : null;
      if (!url) return reply.code(502).send({ error:"stripe_portal_url_missing" });
      return reply.send({ url });
    } catch (error) {
      request.log.error({error},"stripe customer portal session failed");
      return reply.code(503).send({ error:"stripe_portal_unavailable" });
    }
  });
  app.post("/billing/stripe/test-webhook/:token", { config:{ rawBody:true } }, async (request, reply) => {
    const runtime=await getStripeBillingModeRuntime("test");const supplied=String((request.params as {token?:string})?.token??"");const expected=runtime?.webhookToken??"";
    const a=Buffer.from(expected),b=Buffer.from(supplied);if(!expected||a.length!==b.length||!timingSafeEqual(a,b))return reply.code(404).send({error:"not_found"});
    const rawRequest=request as RawRequest;const raw=Buffer.isBuffer(rawRequest.rawBody)?rawRequest.rawBody.toString("utf8"):rawRequest.rawBody;const signature=String(request.headers["stripe-signature"]??"");
    if(!raw)return reply.code(400).send({error:"missing_body"});if(!runtime?.webhookSecret)return reply.code(503).send({error:"stripe_test_webhook_secret_not_configured"});if(!signature||!verifyStripeSignature(raw,signature,runtime.webhookSecret))return reply.code(401).send({error:"invalid_stripe_signature"});
    let event:{id?:string;type?:string};try{event=JSON.parse(raw)}catch{return reply.code(400).send({error:"invalid_json"})}if(!event.id||!event.type)return reply.code(400).send({error:"invalid_stripe_event"});
    await ensureWebhookAuditSchema();const payloadHash=createHash("sha256").update(raw).digest("hex");await prisma.$executeRawUnsafe(`INSERT INTO "PaymentWebhookEvent" ("id","provider","providerEventId","eventType","payloadHash","attemptCount","lastAttemptAt","processedAt") VALUES ($1,'stripe-billing-test',$2,$3,$4,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT ("provider","providerEventId") DO UPDATE SET "attemptCount"="PaymentWebhookEvent"."attemptCount"+1,"lastAttemptAt"=CURRENT_TIMESTAMP,"processedAt"=CURRENT_TIMESTAMP`,randomUUID(),event.id,event.type,payloadHash);
    return reply.send({received:true,mode:"test"});
  });

  app.post("/billing/stripe/webhook/:token", { config:{ rawBody:true } }, async (request, reply) => {
    const runtime = await stripeBillingRuntime();
    const configuredToken = runtime?.webhookToken ?? "";
    const suppliedToken = String((request.params as {token?:string})?.token ?? "");
    const a=Buffer.from(configuredToken); const b=Buffer.from(suppliedToken);
    if (!configuredToken || a.length !== b.length || !timingSafeEqual(a,b)) return reply.code(404).send({error:"not_found"});
    const secret = runtime?.webhookSecret ?? "";
    const rawRequest = request as RawRequest;
    const raw = Buffer.isBuffer(rawRequest.rawBody) ? rawRequest.rawBody.toString("utf8") : rawRequest.rawBody;
    const signature = String(request.headers["stripe-signature"] ?? "");
    if (!raw) return reply.code(400).send({error:"missing_body"});
    if (!secret) return reply.code(503).send({error:"stripe_webhook_secret_not_configured"});
    if (!signature || !verifyStripeSignature(raw, signature, secret)) return reply.code(401).send({error:"invalid_stripe_signature"});
    let event: {id?:string;type?:string;account?:string;data?:{object?:StripeObject}};
    try { event = JSON.parse(raw); } catch { return reply.code(400).send({error:"invalid_json"}); }
    if (!event.id || !event.type) return reply.code(400).send({error:"invalid_stripe_event"});
    await ensureWebhookAuditSchema();
    const payloadHash = createHash("sha256").update(raw).digest("hex");
    const inserted = await prisma.$queryRawUnsafe<Array<{id:string}>>(
      `INSERT INTO "PaymentWebhookEvent" ("id","provider","providerEventId","eventType","payloadHash","attemptCount","lastAttemptAt") VALUES ($1,'stripe-billing',$2,$3,$4,1,CURRENT_TIMESTAMP) ON CONFLICT ("provider","providerEventId") DO NOTHING RETURNING "id"`,
      randomUUID(), event.id, event.type, payloadHash,
    );
    if (!inserted.length) {
      const previous = await prisma.$queryRawUnsafe<Array<{processedAt:Date|null;payloadHash:string;lastError:string|null}>>(
        `SELECT "processedAt","payloadHash","lastError" FROM "PaymentWebhookEvent" WHERE "provider"='stripe-billing' AND "providerEventId"=$1 LIMIT 1`, event.id,
      );
      if (previous[0]?.processedAt) return reply.send({received:true,duplicate:true});
      if (previous[0]?.payloadHash !== payloadHash) {
        request.log.warn({eventId:event.id,eventType:event.type},"stripe webhook retry payload changed after valid signature; retrying event");
        await prisma.$executeRawUnsafe(`UPDATE "PaymentWebhookEvent" SET "attemptCount"="attemptCount"+1,"lastAttemptAt"=CURRENT_TIMESTAMP,"payloadHash"=$2,"lastError"=NULL WHERE "provider"='stripe-billing' AND "providerEventId"=$1`,event.id,payloadHash);
      } else {
        await prisma.$executeRawUnsafe(`UPDATE "PaymentWebhookEvent" SET "attemptCount"="attemptCount"+1,"lastAttemptAt"=CURRENT_TIMESTAMP WHERE "provider"='stripe-billing' AND "providerEventId"=$1`,event.id);
      }
    }
    const obj = event.data?.object ?? {};
    await ensurePlans();
    try {
      const vacationEvent=await handleVacationStripeEvent(event.type,obj);
      const marketplaceEvent=vacationEvent?false:await handleMarketplaceStripeEvent(event.type,obj,event.id,event.account);
      const promotionCheckoutEvent=["checkout.session.completed","checkout.session.async_payment_succeeded","checkout.session.expired","checkout.session.async_payment_failed"].includes(event.type);
      if (!vacationEvent && !marketplaceEvent && promotionCheckoutEvent) {
        const handledPromotion=await handlePromotionStripeEvent(event.type,obj);
        if(!handledPromotion){const handledCredit=await handleSiteCreditCheckoutEvent(event.type,obj);if(!handledCredit&&(event.type==="checkout.session.completed"||event.type==="checkout.session.async_payment_succeeded")){const handledRenewal=await handleListingRenewalCheckoutCompleted(obj);if(!handledRenewal)await handleCheckoutCompleted(obj)}}
      }
      else if (!marketplaceEvent && (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted")) await syncSubscriptionById(obj);
      else if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
        const subscriptionId = typeof obj.subscription === "string" ? obj.subscription : null;
        const invoiceId = typeof obj.id === "string" ? obj.id : null;
        if (subscriptionId) {
          const local = await prisma.professionalSubscription.findUnique({where:{externalSubscriptionId:subscriptionId},include:{plan:true}});
          if (local) {
            const wasPastDue=local.status==="PAST_DUE";
            const nextStatus=event.type === "invoice.paid" ? "ACTIVE" : "PAST_DUE";
            await prisma.professionalSubscription.update({where:{id:local.id},data:{status:nextStatus}});
            if(event.type==="invoice.payment_failed"){
              await notifyProPaymentFailed({userId:local.userId,subscriptionId:local.id,planName:local.plan.name,invoiceId}).catch(()=>undefined);
            }else if(wasPastDue){
              await notifyProPaymentRecovered({userId:local.userId,subscriptionId:local.id,planName:local.plan.name,invoiceId}).catch(()=>undefined);
            }
          }
        }
      }
      await prisma.$executeRawUnsafe(
        `UPDATE "PaymentWebhookEvent" SET "processedAt"=CURRENT_TIMESTAMP,"lastError"=NULL WHERE "provider"='stripe-billing' AND "providerEventId"=$1`, event.id,
      );
    } catch (error) {
      const message=String(error instanceof Error?error.message:error).slice(0,2000);
      await prisma.$executeRawUnsafe(`UPDATE "PaymentWebhookEvent" SET "lastError"=$1,"lastAttemptAt"=CURRENT_TIMESTAMP WHERE "provider"='stripe-billing' AND "providerEventId"=$2`,message,event.id).catch(()=>undefined);
      request.log.error({error,eventId:event.id,eventType:event.type},"stripe billing webhook processing failed");
      return reply.code(500).send({received:false});
    }
    return reply.send({received:true});
  });
}
