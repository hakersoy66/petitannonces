import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { deliverUserEvent } from "./notification-delivery.js";
import { getRuntimeIntegration } from "./admin-control.js";

const DEFAULT_PROTECTION_HOURS = 48;
const DEFAULT_PAYOUT_DELAY_DAYS = 21;
type ShipmentStatus = "LABEL_CREATED"|"IN_TRANSIT"|"OUT_FOR_DELIVERY"|"DELIVERED"|"EXCEPTION"|"RETURNED"|"LOST"|"CANCELED";
type RawRequest = FastifyRequest & { rawBody?: string | Buffer };

async function verifySignature(raw:string,signature:string){
  const configured=await getRuntimeIntegration("sendcloud");
  const secret=String(configured?.secrets?.webhookSecret??"").trim()||String(configured?.secrets?.privateKey??"").trim()||String(process.env.SENDCLOUD_WEBHOOK_SECRET??"").trim()||String(process.env.SENDCLOUD_PRIVATE_KEY??"").trim();
  if(!secret)return process.env.NODE_ENV!=="production";
  const expected=createHmac("sha256",secret).update(raw).digest("hex");
  const normalized=signature.trim().toLowerCase();
  if(normalized.length!==expected.length)return false;
  return timingSafeEqual(Buffer.from(normalized),Buffer.from(expected));
}
function textStatus(value:string){return value.toLowerCase().replace(/[^a-z0-9]+/g,"_")}
function mapStatus(body:any):ShipmentStatus|null{
  const phase=textStatus(String(body?.data?.event?.phase??""));
  const exception=textStatus(String(body?.data?.event?.exception??""));
  const returned=body?.data?.event?.is_returned===true;
  if(returned||phase.includes("return"))return "RETURNED";
  if(phase==="delivered"||phase.includes("delivered"))return "DELIVERED";
  if(phase.includes("out_for_delivery"))return "OUT_FOR_DELIVERY";
  if(phase.includes("in_transit")||phase.includes("transit"))return "IN_TRANSIT";
  if(exception&&exception!=="none")return exception.includes("lost")?"LOST":"EXCEPTION";
  const code=textStatus(String(body?.parcel?.status?.code??body?.data?.parcel?.status?.code??""));
  const message=textStatus(String(body?.parcel?.status?.message??body?.data?.parcel?.status?.message??""));
  const state=code||message;
  if(["delivered","collected_by_customer","shipment_collected_by_customer"].includes(state))return "DELIVERED";
  if(["driver_on_route","awaiting_customer_pickup"].includes(state))return "OUT_FOR_DELIVERY";
  if(["to_sorting","sorted","unsorted","sorting","shipment_on_route","picked_up_by_driver","at_customs","at_sorting_centre","delivery_method_changed","delivery_date_changed","delivery_address_changed","delayed"].includes(state))return "IN_TRANSIT";
  if(["returned_to_sender","refused_by_recipient"].includes(state)||state.includes("return"))return "RETURNED";
  if(state.includes("lost"))return "LOST";
  if(["cancelling_upstream","cancelling","cancelled","cancelled_upstream"].includes(state))return "CANCELED";
  if(["collect_error","delivery_failed","undeliverable","cancellation_failed","announcement_failed","no_label","unknown","exception","address_invalid"].includes(state))return "EXCEPTION";
  if(["ready_to_send","announced","announced_uncollected","announcing","being_announced"].includes(state)||state.includes("label"))return "LABEL_CREATED";
  if(message.includes("deliver")&&!message.includes("failed"))return "DELIVERED";
  if(message.includes("driver")||message.includes("pickup"))return "OUT_FOR_DELIVERY";
  if(message.includes("transit")||message.includes("route")||message.includes("sorting")||message.includes("customs"))return "IN_TRANSIT";
  if(message.includes("cancel"))return "CANCELED";
  if(message.includes("exception")||message.includes("failed")||message.includes("problem")||message.includes("invalid"))return "EXCEPTION";
  if(message.includes("ready_to_send")||message.includes("announced"))return "LABEL_CREATED";
  return null;
}
function trackingNumber(body:any){return String(body?.data?.parcel?.tracking_number??body?.parcel?.tracking_number??"").trim()}
function eventTimestamp(body:any){
  const raw=body?.data?.event?.timestamp??body?.carrier_status_change_timestamp??body?.timestamp;
  if(typeof raw==="number")return new Date(raw<10_000_000_000?raw*1000:raw);
  const d=raw?new Date(raw):new Date();return Number.isNaN(d.getTime())?new Date():d;
}
async function openProtectionWindow(orderId:string,deliveredAt:Date){
  const hours=Math.max(1,Number(process.env.BUYER_PROTECTION_HOURS??DEFAULT_PROTECTION_HOURS));
  const delayDays=Math.max(1,Number(process.env.SELLER_PAYOUT_DELAY_DAYS??DEFAULT_PAYOUT_DELAY_DAYS));
  const endsAt=new Date(deliveredAt.getTime()+hours*60*60*1000);
  const payoutEligibleAt=new Date(deliveredAt.getTime()+delayDays*24*60*60*1000);
  await prisma.$executeRawUnsafe(`INSERT INTO "BuyerProtectionWindow" ("id","orderId","startsAt","endsAt","payoutEligibleAt") VALUES ($1,$2,$3,$4,$5) ON CONFLICT ("orderId") DO NOTHING`,randomUUID(),orderId,deliveredAt,endsAt,payoutEligibleAt);
}
function eventKey(raw:string,tracking:string,status:string,at:Date){return createHash("sha256").update(`${raw}|${tracking}|${status}|${at.toISOString()}`).digest("hex")}

export async function registerSendcloudWebhookRoutes(app:FastifyInstance){
  app.post("/shipping/webhooks/sendcloud",{config:{rawBody:true}},async(request,reply)=>{
    const rawRequest=request as RawRequest;
    const raw=Buffer.isBuffer(rawRequest.rawBody)?rawRequest.rawBody.toString("utf8"):rawRequest.rawBody;
    if(!raw)return reply.code(400).send({error:"raw_body_missing"});
    const signature=String(request.headers["sendcloud-signature"]??"");
    if(!await verifySignature(raw,signature))return reply.code(401).send({error:"invalid_signature"});
    const body=request.body as any;
    const tracking=trackingNumber(body);if(!tracking)return reply.code(200).send({received:true,ignored:"tracking_missing"});
    const status=mapStatus(body);if(!status)return reply.code(200).send({received:true,ignored:"unmapped_status"});
    const at=eventTimestamp(body);const key=eventKey(raw,tracking,status,at);
    const existing=await prisma.$queryRawUnsafe<Array<{id:string}>>(`SELECT "id" FROM "ShippingWebhookEvent" WHERE "provider"='SENDCLOUD' AND "eventKey"=$1 LIMIT 1`,key);
    if(existing[0])return reply.send({received:true,duplicate:true});
    const shipments=await prisma.$queryRawUnsafe<Array<{id:string;orderId:string;status:string;lastCarrierEventAt:Date|null}>>(`SELECT "id","orderId","status","lastCarrierEventAt" FROM "MarketplaceShipment" WHERE "trackingNumber"=$1 ORDER BY "updatedAt" DESC LIMIT 1`,tracking);
    const shipment=shipments[0];
    await prisma.$executeRawUnsafe(`INSERT INTO "ShippingWebhookEvent" ("id","provider","eventKey","trackingNumber","status","payload") VALUES ($1,'SENDCLOUD',$2,$3,$4,$5::jsonb)`,randomUUID(),key,tracking,status,JSON.stringify(body??{}));
    if(!shipment)return reply.code(200).send({received:true,ignored:"shipment_not_found"});
    const previousAt=shipment.lastCarrierEventAt?new Date(shipment.lastCarrierEventAt):null;
    if(previousAt&&at.getTime()<previousAt.getTime())return reply.code(200).send({received:true,ignored:"stale_event",status});
    if(shipment.status==="RETURNED"&&status!=="RETURNED")return reply.code(200).send({received:true,ignored:"terminal_returned",status});
    if(shipment.status==="CANCELED"&&status!=="CANCELED")return reply.code(200).send({received:true,ignored:"terminal_canceled",status});
    if(shipment.status==="DELIVERED"&&!['DELIVERED','RETURNED'].includes(status))return reply.code(200).send({received:true,ignored:"post_delivery_regression",status});
    await prisma.$executeRawUnsafe(`UPDATE "MarketplaceShipment" SET "status"=$1::"ShipmentStatus","lastCarrierEventAt"=$2,"shippedAt"=CASE WHEN $1 IN ('IN_TRANSIT','OUT_FOR_DELIVERY') THEN COALESCE("shippedAt",$2) ELSE "shippedAt" END,"deliveredAt"=CASE WHEN $1='DELIVERED' THEN COALESCE("deliveredAt",$2) ELSE "deliveredAt" END,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$3`,status,at,shipment.id);
    const orders=await prisma.$queryRawUnsafe<Array<{id:string;buyerId:string;sellerId:string;orderNumber:string;status:string}>>(`SELECT "id","buyerId","sellerId","orderNumber","status" FROM "MarketplaceOrder" WHERE "id"=$1 LIMIT 1`,shipment.orderId);const order=orders[0];
    if(!order)return reply.send({received:true});
    if(status==="IN_TRANSIT"||status==="OUT_FOR_DELIVERY")await prisma.$executeRawUnsafe(`UPDATE "MarketplaceOrder" SET "status"='SHIPPED',"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "status" IN ('PAID','PROCESSING','SHIPPED')`,order.id);
    if(status==="DELIVERED"){await prisma.$executeRawUnsafe(`UPDATE "MarketplaceOrder" SET "status"='DELIVERED',"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "status" IN ('SHIPPED','PROCESSING','PAID','DELIVERED')`,order.id);await openProtectionWindow(order.id,at)}
    const actionUrl=`/commandes/${order.id}`;
    const semanticDedupeKey=`shipping-status:${order.id}:${status}`;
    const notifications:Record<ShipmentStatus,{title:string;body:string}|undefined>={
      LABEL_CREATED:{title:"Envoi préparé",body:`Le bordereau de la commande ${order.orderNumber} est prêt.`},
      IN_TRANSIT:{title:"Colis expédié",body:`La commande ${order.orderNumber} est en cours d’acheminement.`},
      OUT_FOR_DELIVERY:{title:"Livraison en cours",body:`La commande ${order.orderNumber} est en cours de livraison.`},
      DELIVERED:{title:"Colis livré",body:`La commande ${order.orderNumber} a été indiquée comme livrée.`},
      EXCEPTION:{title:"Incident de livraison",body:`Un incident a été signalé pour la commande ${order.orderNumber}.`},
      RETURNED:{title:"Retour du colis",body:`Le colis de la commande ${order.orderNumber} est en cours de retour.`},
      LOST:{title:"Colis signalé perdu",body:`Le transporteur signale un problème majeur sur la commande ${order.orderNumber}.`},
      CANCELED:{title:"Envoi annulé",body:`L’envoi de la commande ${order.orderNumber} a été annulé.`},
    };
    const note=notifications[status];
    if(status==="DELIVERED"){
      await Promise.all([
        deliverUserEvent({userId:order.buyerId,eventKind:"LISTING",notificationKind:"SYSTEM",title:"Votre colis est livré",body:`La commande ${order.orderNumber} est indiquée comme livrée. Vérifiez l’article : votre protection acheteur de 48 h est maintenant active.`,actionUrl,transactional:true,dedupeKey:semanticDedupeKey,metadata:{orderId:order.id,trackingNumber:tracking,shipmentStatus:status,source:"SENDCLOUD",deliveryRole:"BUYER"}}),
        deliverUserEvent({userId:order.sellerId,eventKind:"LISTING",notificationKind:"SYSTEM",title:"Commande livrée",body:`La commande ${order.orderNumber} est livrée. La protection acheteur de 48 h est ouverte; le versement vendeur reste planifié à partir du 21e jour après la livraison, ce délai incluant la période de protection.`,actionUrl,transactional:true,dedupeKey:semanticDedupeKey,metadata:{orderId:order.id,trackingNumber:tracking,shipmentStatus:status,source:"SENDCLOUD",deliveryRole:"SELLER"}}),
      ]);
    }else if(note){for(const userId of new Set([order.buyerId,order.sellerId]))await deliverUserEvent({userId,eventKind:"LISTING",notificationKind:"LISTING",title:note.title,body:note.body,actionUrl,transactional:true,dedupeKey:semanticDedupeKey,metadata:{orderId:order.id,trackingNumber:tracking,shipmentStatus:status,source:"SENDCLOUD"}})}
    return reply.send({received:true,status});
  });
}
