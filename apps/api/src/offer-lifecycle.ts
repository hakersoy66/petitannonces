import { prisma } from "@pa/database";
import { deliverUserEvent } from "./notification-delivery.js";
import { runObservedJob } from "./job-observability.js";
import { cancelMarketplaceCheckout } from "./marketplace-stripe.js";

export const ACCEPTED_OFFER_PAYMENT_WINDOW_HOURS = 48;
const WORKER_INTERVAL_MS = 10 * 60_000;
const PROTECTED_ORDER_STATUSES = ["PAID","PROCESSING","SHIPPED","DELIVERED","COMPLETED","DISPUTED","REFUNDED"] as const;

type DueOffer = {
  id:string;
  conversationId:string;
  listingId:string;
  messageId:string|null;
  makerId:string;
  recipientId:string;
  amountMinor:number;
  currency:string;
  expiresAt:Date;
  title:string|null;
  listingStatus:string;
  buyerId:string;
  sellerId:string;
};

type OfferOrder = {
  id:string;
  status:string;
  paymentProvider:string|null;
  providerCheckoutId:string|null;
};

export function acceptedOfferPaymentDeadline(from = new Date()){
  return new Date(from.getTime() + ACCEPTED_OFFER_PAYMENT_WINDOW_HOURS * 60 * 60 * 1000);
}

export async function listingSupportsAcceptedOfferPayment(listingId:string){
  const rows=await prisma.$queryRawUnsafe<Array<{eligible:boolean}>>(`
    SELECT (
      l."status"='PUBLISHED'
      AND l."priceMinor" IS NOT NULL AND l."priceMinor">0
      AND COALESCE(cs."securePaymentEnabled",FALSE)=TRUE
      AND c."domain"::text NOT IN ('VEHICLE','REAL_ESTATE','JOB','SERVICE')
      AND (COALESCE(cs."mondialRelayEnabled",FALSE)=TRUE OR COALESCE(cs."colissimoEnabled",FALSE)=TRUE)
      AND cs."packageWeightG" IS NOT NULL
    ) AS eligible
    FROM "Listing" l
    JOIN "Category" c ON c."id"=l."categoryId"
    LEFT JOIN "ListingCommerceSettings" cs ON cs."listingId"=l."id"
    WHERE l."id"=$1
    LIMIT 1
  `,listingId);
  return Boolean(rows[0]?.eligible);
}

function money(minor:number,currency:string){
  return new Intl.NumberFormat("fr-FR",{style:"currency",currency}).format(minor/100);
}

async function dueOffers(scope:{offerId?:string;conversationId?:string;limit?:number}={}){
  const limit=Math.min(Math.max(scope.limit??100,1),500);
  return prisma.$queryRawUnsafe<DueOffer[]>(`
    SELECT o."id",o."conversationId",o."listingId",o."messageId",o."makerId",o."recipientId",
      o."amountMinor",o."currency",o."expiresAt",l."title",l."status"::text AS "listingStatus",
      c."buyerId",c."sellerId"
    FROM "Offer" o
    JOIN "Listing" l ON l."id"=o."listingId"
    JOIN "Category" cat ON cat."id"=l."categoryId"
    JOIN "ListingCommerceSettings" cs ON cs."listingId"=l."id"
    JOIN "Conversation" c ON c."id"=o."conversationId"
    WHERE o."status"='ACCEPTED'
      AND l."status"='PUBLISHED'
      AND l."priceMinor" IS NOT NULL AND l."priceMinor">0
      AND cs."securePaymentEnabled"=TRUE
      AND cat."domain"::text NOT IN ('VEHICLE','REAL_ESTATE','JOB','SERVICE')
      AND (cs."mondialRelayEnabled"=TRUE OR cs."colissimoEnabled"=TRUE)
      AND cs."packageWeightG" IS NOT NULL
      AND o."expiresAt" IS NOT NULL
      AND o."expiresAt"<=CURRENT_TIMESTAMP
      AND ($1::text IS NULL OR o."id"=$1)
      AND ($2::text IS NULL OR o."conversationId"=$2)
    ORDER BY o."expiresAt" ASC
    LIMIT $3
  `,scope.offerId??null,scope.conversationId??null,limit);
}

async function ordersForOffer(offerId:string){
  return prisma.$queryRawUnsafe<OfferOrder[]>(`
    SELECT "id","status"::text AS "status","paymentProvider","providerCheckoutId"
    FROM "MarketplaceOrder"
    WHERE "offerId"=$1
    ORDER BY "createdAt" DESC
  `,offerId);
}

async function hasProtectedPayment(orderId:string){
  const rows=await prisma.$queryRawUnsafe<Array<{id:string}>>(`
    SELECT "id" FROM "MarketplacePayment"
    WHERE "orderId"=$1 AND "status" IN ('AUTHORIZED','CAPTURED','PARTIALLY_REFUNDED','REFUNDED')
    LIMIT 1
  `,orderId);
  return Boolean(rows[0]);
}

async function expireOne(row:DueOffer){
  const orders=await ordersForOffer(row.id);
  if(orders.some(order=>PROTECTED_ORDER_STATUSES.includes(order.status as (typeof PROTECTED_ORDER_STATUSES)[number])))return "protected" as const;

  for(const order of orders){
    if(await hasProtectedPayment(order.id))return "protected" as const;
    if(order.status==="PENDING_PAYMENT"&&order.paymentProvider==="stripe-connect"&&order.providerCheckoutId){
      try{
        await cancelMarketplaceCheckout(order.providerCheckoutId);
      }catch(error){
        if(String(error).includes("payment_already_completed"))return "protected" as const;
        throw error;
      }
    }
  }

  const changed=await prisma.$transaction(async tx=>{
    const rows=await tx.$queryRawUnsafe<Array<{id:string}>>(`
      UPDATE "Offer" o
      SET "status"='EXPIRED',"updatedAt"=CURRENT_TIMESTAMP
      WHERE o."id"=$1 AND o."status"='ACCEPTED' AND o."expiresAt"<=CURRENT_TIMESTAMP
        AND NOT EXISTS(
          SELECT 1 FROM "MarketplaceOrder" mo
          WHERE mo."offerId"=o."id"
            AND mo."status" IN ('PAID','PROCESSING','SHIPPED','DELIVERED','COMPLETED','DISPUTED','REFUNDED')
        )
        AND NOT EXISTS(
          SELECT 1
          FROM "MarketplaceOrder" mo
          JOIN "MarketplacePayment" mp ON mp."orderId"=mo."id"
          WHERE mo."offerId"=o."id"
            AND mp."status" IN ('AUTHORIZED','CAPTURED','PARTIALLY_REFUNDED','REFUNDED')
        )
      RETURNING o."id"
    `,row.id);
    if(!rows[0])return false;
    await tx.$executeRawUnsafe(`
      UPDATE "MarketplaceOrder" mo
      SET "status"='CANCELED',"canceledAt"=COALESCE("canceledAt",CURRENT_TIMESTAMP),"updatedAt"=CURRENT_TIMESTAMP
      WHERE mo."offerId"=$1 AND mo."status"='PENDING_PAYMENT'
        AND NOT EXISTS(
          SELECT 1 FROM "MarketplacePayment" mp
          WHERE mp."orderId"=mo."id"
            AND mp."status" IN ('AUTHORIZED','CAPTURED','PARTIALLY_REFUNDED','REFUNDED')
        )
    `,row.id);
    await tx.$executeRawUnsafe(`
      UPDATE "MarketplacePayment" mp
      SET "status"='CANCELED',"updatedAt"=CURRENT_TIMESTAMP
      WHERE mp."orderId" IN (SELECT mo."id" FROM "MarketplaceOrder" mo WHERE mo."offerId"=$1)
        AND mp."status" IN ('CREATED','REQUIRES_ACTION','FAILED')
    `,row.id);
    return true;
  });

  if(!changed)return "protected" as const;

  const amount=money(row.amountMinor,row.currency);
  const actionUrl=`/messages?conversation=${encodeURIComponent(row.conversationId)}`;
  await Promise.all([
    deliverUserEvent({
      userId:row.buyerId,eventKind:"OFFER",notificationKind:"SYSTEM",
      title:"Délai de paiement expiré",
      body:`Le délai de ${ACCEPTED_OFFER_PAYMENT_WINDOW_HOURS} h pour régler l’offre de ${amount} est dépassé. Cette offre n’est plus utilisable.`,
      actionUrl,transactional:true,dedupeKey:`accepted-offer-expired:${row.id}:buyer`,
      metadata:{offerId:row.id,listingId:row.listingId,status:"EXPIRED",reason:"PAYMENT_WINDOW_EXPIRED",paymentWindowHours:ACCEPTED_OFFER_PAYMENT_WINDOW_HOURS},
    }),
    deliverUserEvent({
      userId:row.sellerId,eventKind:"OFFER",notificationKind:"SYSTEM",
      title:"Offre expirée",
      body:`Le délai de paiement de ${ACCEPTED_OFFER_PAYMENT_WINDOW_HOURS} h pour l’offre de ${amount} est dépassé.${row.listingStatus==="PUBLISHED"?" Votre annonce reste disponible.":""}`,
      actionUrl,transactional:true,dedupeKey:`accepted-offer-expired:${row.id}:seller`,
      metadata:{offerId:row.id,listingId:row.listingId,status:"EXPIRED",reason:"PAYMENT_WINDOW_EXPIRED",paymentWindowHours:ACCEPTED_OFFER_PAYMENT_WINDOW_HOURS},
    }),
  ]).catch(()=>undefined);

  return "expired" as const;
}

export async function expireAcceptedOfferPaymentWindows(scope:{offerId?:string;conversationId?:string;limit?:number}={}){
  return runObservedJob("accepted-offer-payment-window-sweep",async()=>{
    const rows=await dueOffers(scope);
    let expired=0,protectedCount=0,failed=0;
    for(const row of rows){
      try{
        const result=await expireOne(row);
        if(result==="expired")expired+=1;
        else protectedCount+=1;
      }catch{
        failed+=1;
      }
    }
    return{processed:rows.length,expired,protected:protectedCount,failed,paymentWindowHours:ACCEPTED_OFFER_PAYMENT_WINDOW_HOURS};
  });
}

export function startAcceptedOfferPaymentWindowWorker(log?:{info:(value:unknown,message?:string)=>void;error:(value:unknown,message?:string)=>void}){
  let running=false;
  const tick=async()=>{
    if(running)return;
    running=true;
    try{
      const result=await expireAcceptedOfferPaymentWindows();
      if(Number((result as any)?.processed??0)>0)log?.info(result,"accepted offer payment window sweep processed");
    }catch(error){
      log?.error(error,"accepted offer payment window sweep failed");
    }finally{
      running=false;
    }
  };
  const first=setTimeout(()=>void tick(),30_000);first.unref();
  const timer=setInterval(()=>void tick(),WORKER_INTERVAL_MS);timer.unref();
  return timer;
}