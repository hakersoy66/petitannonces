import { randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyBaseLogger } from "fastify";
import { getRuntimeIntegration } from "./admin-control.js";
import { deliverUserEvent } from "./notification-delivery.js";
import { openProtectionWindow } from "./shipping.js";

type SupplierProduct={id:string;listingId:string;externalProductId:string;externalVariantId:string;warehouseCountryCode:string|null;deliveryDaysMin:number|null;deliveryDaysMax:number|null;stockQuantity:number;status:string;raw:any};
type FulfillmentOrder={id:string;marketplaceOrderId:string;listingId:string;provider:string;supplierCatalogProductId:string;providerOrderId:string|null;providerShipmentOrderId:string|null;providerStatus:string|null;logisticName:string|null;trackingNumber:string|null;trackingProvider:string|null;state:string;attemptCount:number;lastSyncedAt:Date|null;raw:any};

const CJ_API="https://developers.cjdropshipping.com/api2.0/v1";
const USD_TO_EUR=Number(process.env.CJ_USD_TO_EUR??"0.88");
const MAX_SUPPLIER_COST_RATIO=Math.min(.9,Math.max(.5,Number(process.env.CJ_MAX_SUPPLIER_COST_RATIO??"0.78")));
let cjTokenCache:{token:string;expiresAt:number}|null=null;
let cjNextAt=0;
function sleep(ms:number){return new Promise(resolve=>setTimeout(resolve,ms));}
async function throttleCj(){const wait=Math.max(0,cjNextAt-Date.now());if(wait)await sleep(wait);cjNextAt=Date.now()+1100;}
async function cjToken(){
  if(cjTokenCache&&cjTokenCache.expiresAt>Date.now()+60_000)return cjTokenCache.token;
  const integration=await getRuntimeIntegration("cj-dropshipping");
  const apiKey=String(integration?.secrets?.apiKey??"").trim();
  if(!integration?.enabled||!apiKey)throw new Error("cj_not_configured");
  await throttleCj();
  const response=await fetch(`${CJ_API}/authentication/getAccessToken`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({apiKey}),signal:AbortSignal.timeout(12000)});
  const payload=await response.json().catch(()=>({})) as any;
  if(!response.ok||payload?.code!==200||!payload?.data?.accessToken)throw new Error(payload?.message??"cj_auth_failed");
  const parsedExpiry=Date.parse(String(payload.data.accessTokenExpiryDate??""));
  cjTokenCache={token:String(payload.data.accessToken),expiresAt:Number.isFinite(parsedExpiry)?parsedExpiry:Date.now()+30*60_000};
  return cjTokenCache.token;
}
async function cjRequest(path:string,init:RequestInit={}){
  const run=async()=>{const token=await cjToken();await throttleCj();const response=await fetch(`${CJ_API}${path}`,{...init,headers:{"CJ-Access-Token":token,...(init.body?{"content-type":"application/json"}:{}),...(init.headers??{})},signal:AbortSignal.timeout(20000)});const payload=await response.json().catch(()=>({})) as any;if(!response.ok||payload?.code!==200||payload?.result===false)throw new Error(String(payload?.message??`cj_http_${response.status}`));return payload;};
  try{return await run();}catch(error:any){if(/token|auth|401/i.test(String(error?.message??""))){cjTokenCache=null;return run();}throw error;}
}
function parseAging(value:unknown){const values=String(value??"").match(/\d+/g)?.map(Number)??[];return values.length?[Math.min(...values),Math.max(...values)]:[99,99];}
const EU=new Set(["AT","BE","BG","HR","CY","CZ","DE","DK","EE","ES","FI","FR","GR","HU","IE","IT","LT","LU","LV","MT","NL","PL","PT","RO","SE","SI","SK"]);

export async function ensureSupplierFulfillmentSchema(){
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "SupplierFulfillmentOrder" ("id" TEXT PRIMARY KEY,"marketplaceOrderId" TEXT NOT NULL UNIQUE REFERENCES "MarketplaceOrder"("id") ON DELETE CASCADE,"listingId" TEXT NOT NULL REFERENCES "Listing"("id") ON DELETE RESTRICT,"provider" TEXT NOT NULL,"supplierCatalogProductId" TEXT NOT NULL REFERENCES "SupplierCatalogProduct"("id") ON DELETE RESTRICT,"providerOrderId" TEXT,"providerShipmentOrderId" TEXT,"providerStatus" TEXT,"logisticName" TEXT,"trackingNumber" TEXT,"trackingProvider" TEXT,"totalCostMinor" INTEGER,"costCurrency" TEXT NOT NULL DEFAULT 'USD',"state" TEXT NOT NULL DEFAULT 'PENDING',"attemptCount" INTEGER NOT NULL DEFAULT 0,"lastError" TEXT,"lastSyncedAt" TIMESTAMP(3),"raw" JSONB,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SupplierFulfillmentOrder_state_idx" ON "SupplierFulfillmentOrder"("state","updatedAt")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SupplierFulfillmentOrder_provider_order_idx" ON "SupplierFulfillmentOrder"("provider","providerOrderId")`);
}
export async function getSupplierProductForListing(listingId:string){
  const rows=await prisma.$queryRawUnsafe<SupplierProduct[]>(`SELECT "id","publishedListingId" AS "listingId","externalProductId","externalVariantId","warehouseCountryCode","deliveryDaysMin","deliveryDaysMax","stockQuantity","status","raw" FROM "SupplierCatalogProduct" WHERE "publishedListingId"=$1 AND "provider"='CJ' AND "status"='LIVE' LIMIT 1`,listingId);
  return rows[0]??null;
}
export async function isSupplierListing(listingId:string){return Boolean(await getSupplierProductForListing(listingId));}
async function cjFreight(product:SupplierProduct,destinationCountryCode:string){
  const origin=String(product.warehouseCountryCode??product.raw?.shipping?.origin??"CN").toUpperCase();
  const payload=await cjRequest("/logistic/freightCalculate",{method:"POST",body:JSON.stringify({startCountryCode:origin,endCountryCode:destinationCountryCode.toUpperCase(),products:[{quantity:1,vid:product.externalVariantId}]})});
  const rows=(Array.isArray(payload?.data)?payload.data:[]).map((item:any)=>{const days=parseAging(item?.logisticAging);return{logisticName:String(item?.logisticName??""),feeUsd:Number(item?.totalPostageFee??item?.logisticPrice??9999),days,raw:item};}).filter((item:any)=>item.logisticName&&Number.isFinite(item.feeUsd));
  const acceptable=rows.filter((item:any)=>item.days[1]<=18);if(!acceptable.length)throw new Error("cj_no_acceptable_shipping");
  const preferred=String(product.raw?.shipping?.name??"").trim().toLowerCase();
  const exact=acceptable.find((item:any)=>item.logisticName.trim().toLowerCase()===preferred);
  const fast=acceptable.filter((item:any)=>item.days[1]<=12).sort((a:any,b:any)=>a.feeUsd-b.feeUsd);
  const chosen=exact??fast[0]??acceptable.sort((a:any,b:any)=>a.feeUsd-b.feeUsd)[0];
  return{...chosen,origin};
}
async function cjBalanceUsd(){
  const payload=await cjRequest("/shopping/pay/getBalance");
  const amount=Number(payload?.data?.amount??0);
  if(!Number.isFinite(amount)||amount<0)throw new Error("cj_balance_unavailable");
  return amount;
}
async function cjVariantPriceUsd(product:SupplierProduct){
  const payload=await cjRequest(`/product/variant/query?pid=${encodeURIComponent(product.externalProductId)}`);
  const variants=Array.isArray(payload?.data)?payload.data:[];
  const variant=variants.find((item:any)=>String(item?.vid??"")===product.externalVariantId);
  const value=Number(variant?.variantSellPrice??0);
  if(!Number.isFinite(value)||value<=0)throw new Error("cj_variant_price_unavailable");
  return value;
}
function estimatedSupplierCostUsd(productUsd:number,shippingUsd:number,origin:string,destination:string,itemPriceMinor:number){const ioss=EU.has(destination.toUpperCase())&&!EU.has(origin.toUpperCase())&&itemPriceMinor<15000?productUsd*.20+.02:0;return productUsd+shippingUsd+ioss;}
function estimatedSupplierCostEurMinor(productUsd:number,shippingUsd:number,origin:string,destination:string,itemPriceMinor:number){return Math.round(estimatedSupplierCostUsd(productUsd,shippingUsd,origin,destination,itemPriceMinor)*USD_TO_EUR*100);}
export async function supplierCheckoutShipping(listingId:string,destinationCountryCode:string){
  const product=await getSupplierProductForListing(listingId);if(!product)return null;
  const stockPayload=await cjRequest(`/product/stock/queryByVid?vid=${encodeURIComponent(product.externalVariantId)}`);
  const stockRows=Array.isArray(stockPayload?.data)?stockPayload.data:[];const liveStock=stockRows.reduce((sum:number,row:any)=>sum+Math.max(0,Number(row?.totalInventoryNum??0)),0);
  await prisma.$executeRawUnsafe(`UPDATE "SupplierCatalogProduct" SET "stockQuantity"=$2,"stockStatus"=$3,"lastSyncedAt"=NOW(),"updatedAt"=NOW() WHERE "id"=$1`,product.id,liveStock,liveStock>0?"IN_STOCK":"OUT_OF_STOCK");
  if(liveStock<1)throw new Error("supplier_out_of_stock");
  const freight=await cjFreight(product,destinationCountryCode);
  const currentProductUsd=await cjVariantPriceUsd(product);
  const listingRows=await prisma.$queryRawUnsafe<Array<{priceMinor:number|null}>>(`SELECT "priceMinor" FROM "Listing" WHERE "id"=$1 LIMIT 1`,listingId);const itemPriceMinor=Number(listingRows[0]?.priceMinor??0);
  const estimatedCostMinor=estimatedSupplierCostEurMinor(currentProductUsd,freight.feeUsd,freight.origin,destinationCountryCode,itemPriceMinor);if(itemPriceMinor<=0||estimatedCostMinor>Math.floor(itemPriceMinor*MAX_SUPPLIER_COST_RATIO))throw new Error("supplier_margin_guard");
  return{provider:"CJ" as const,shippingOptionCode:freight.logisticName,carrierCode:"PETITA_PARTNER",carrierName:"Petita",serviceName:`Livraison standard · ${freight.days[0]}–${freight.days[1]} jours`,amountMinor:0,currency:"EUR",servicePoint:false,weightG:100,recipientCountryCode:destinationCountryCode.toUpperCase(),originCountryCode:freight.origin,supplierVariantId:product.externalVariantId,deliveryDaysMin:freight.days[0],deliveryDaysMax:freight.days[1]};
}

export async function supplierPaymentPreflight(listingId:string,destinationCountryCode="FR"){
  const product=await getSupplierProductForListing(listingId);if(!product)return{supplier:false};
  const stockPayload=await cjRequest(`/product/stock/queryByVid?vid=${encodeURIComponent(product.externalVariantId)}`);
  const stockRows=Array.isArray(stockPayload?.data)?stockPayload.data:[];const liveStock=stockRows.reduce((sum:number,row:any)=>sum+Math.max(0,Number(row?.totalInventoryNum??0)),0);
  await prisma.$executeRawUnsafe(`UPDATE "SupplierCatalogProduct" SET "stockQuantity"=$2,"stockStatus"=$3,"lastSyncedAt"=NOW(),"updatedAt"=NOW() WHERE "id"=$1`,product.id,liveStock,liveStock>0?"IN_STOCK":"OUT_OF_STOCK");
  if(liveStock<1)throw new Error("supplier_out_of_stock");
  const freight=await cjFreight(product,destinationCountryCode);
  const currentProductUsd=await cjVariantPriceUsd(product);
  const listingRows=await prisma.$queryRawUnsafe<Array<{priceMinor:number|null}>>(`SELECT "priceMinor" FROM "Listing" WHERE "id"=$1 LIMIT 1`,listingId);
  const itemPriceMinor=Number(listingRows[0]?.priceMinor??0);
  const estimatedCostMinor=estimatedSupplierCostEurMinor(currentProductUsd,freight.feeUsd,freight.origin,destinationCountryCode,itemPriceMinor);
  if(itemPriceMinor<=0||estimatedCostMinor>Math.floor(itemPriceMinor*MAX_SUPPLIER_COST_RATIO))throw new Error("supplier_margin_guard");
  const requiredUsd=estimatedSupplierCostUsd(currentProductUsd,freight.feeUsd,freight.origin,destinationCountryCode,itemPriceMinor);
  const balanceUsd=await cjBalanceUsd();
  if(balanceUsd+0.001<requiredUsd*1.03)throw new Error("supplier_balance_insufficient");
  return{supplier:true,liveStock,estimatedCostMinor,requiredUsd,balanceUsd,shippingOptionCode:freight.logisticName};
}

async function orderContext(orderId:string){
  const rows=await prisma.$queryRawUnsafe<Array<any>>(`SELECT o."id",o."orderNumber",o."listingId",o."buyerId",o."sellerId",o."itemAmountMinor",o."currency",o."status"::text AS "status",d."service",d."recipientName",d."recipientAddress1",d."recipientAddress2",d."recipientPostalCode",d."recipientCity",d."recipientCountryCode",d."recipientPhone",d."recipientEmail",p."id" AS "supplierCatalogProductId",p."externalProductId",p."externalVariantId",p."warehouseCountryCode",p."deliveryDaysMin",p."deliveryDaysMax",p."stockQuantity",p."status" AS "supplierProductStatus",p."raw" FROM "MarketplaceOrder" o JOIN "SupplierCatalogProduct" p ON p."publishedListingId"=o."listingId" AND p."provider"='CJ' AND p."status"='LIVE' LEFT JOIN "MarketplaceDeliverySelection" d ON d."orderId"=o."id" WHERE o."id"=$1 LIMIT 1`,orderId);
  return rows[0]??null;
}
async function fulfillmentRow(orderId:string){
  const rows=await prisma.$queryRawUnsafe<FulfillmentOrder[]>(`SELECT * FROM "SupplierFulfillmentOrder" WHERE "marketplaceOrderId"=$1 LIMIT 1`,orderId);
  return rows[0]??null;
}
async function ensureFulfillmentRow(ctx:any){
  await prisma.$executeRawUnsafe(`INSERT INTO "SupplierFulfillmentOrder" ("id","marketplaceOrderId","listingId","provider","supplierCatalogProductId","state","createdAt","updatedAt") VALUES ($1,$2,$3,'CJ',$4,'PENDING',NOW(),NOW()) ON CONFLICT ("marketplaceOrderId") DO NOTHING`,randomUUID(),ctx.id,ctx.listingId,ctx.supplierCatalogProductId);
  return fulfillmentRow(ctx.id);
}
function countryName(code:string){return code.toUpperCase()==="FR"?"France":code.toUpperCase();}
function iossFields(ctx:any){
  const destination=String(ctx.recipientCountryCode??"FR").toUpperCase();
  const origin=String(ctx.warehouseCountryCode??ctx.raw?.shipping?.origin??"CN").toUpperCase();
  if(EU.has(destination)&&!EU.has(origin)&&Number(ctx.itemAmountMinor??0)<15000)return{iossType:3};
  return{};
}
async function markFailed(orderId:string,error:unknown){
  const message=String((error as Error)?.message??error).slice(0,800);
  await prisma.$executeRawUnsafe(`UPDATE "SupplierFulfillmentOrder" SET "state"='FAILED',"lastError"=$2,"updatedAt"=NOW() WHERE "marketplaceOrderId"=$1`,orderId,message);
  return message;
}

export async function submitSupplierFulfillment(orderId:string){
  await ensureSupplierFulfillmentSchema();
  const ctx=await orderContext(orderId);if(!ctx)return{handled:false};
  if(!["PAID","PROCESSING"].includes(String(ctx.status)))return{handled:true,state:"WAITING_PAYMENT"};
  if(!ctx.recipientName||!ctx.recipientAddress1||!ctx.recipientPostalCode||!ctx.recipientCity||!ctx.recipientCountryCode)throw new Error("supplier_delivery_address_missing");
  let fulfillment=await ensureFulfillmentRow(ctx);
  if(fulfillment?.providerOrderId)return{handled:true,state:fulfillment.state,providerOrderId:fulfillment.providerOrderId,shipmentOrderId:fulfillment.providerShipmentOrderId};
  await prisma.$executeRawUnsafe(`UPDATE "SupplierFulfillmentOrder" SET "state"='SUBMITTING',"attemptCount"="attemptCount"+1,"lastError"=NULL,"updatedAt"=NOW() WHERE "marketplaceOrderId"=$1`,orderId);
  try{
    const product:SupplierProduct={id:ctx.supplierCatalogProductId,listingId:ctx.listingId,externalProductId:ctx.externalProductId,externalVariantId:ctx.externalVariantId,warehouseCountryCode:ctx.warehouseCountryCode,deliveryDaysMin:ctx.deliveryDaysMin,deliveryDaysMax:ctx.deliveryDaysMax,stockQuantity:Number(ctx.stockQuantity??0),status:ctx.supplierProductStatus,raw:ctx.raw};
    const freight=await cjFreight(product,String(ctx.recipientCountryCode));
    const selectedService=String(ctx.service??"").trim();
    const logisticName=selectedService&&selectedService.toLowerCase()===freight.logisticName.toLowerCase()?selectedService:freight.logisticName;
    const currentProductUsd=await cjVariantPriceUsd(product);
    const estimatedCostMinor=estimatedSupplierCostEurMinor(currentProductUsd,freight.feeUsd,freight.origin,String(ctx.recipientCountryCode),Number(ctx.itemAmountMinor));
    const maxCostMinor=Math.floor(Number(ctx.itemAmountMinor)*MAX_SUPPLIER_COST_RATIO);
    if(estimatedCostMinor>maxCostMinor){
      await prisma.$executeRawUnsafe(`UPDATE "SupplierFulfillmentOrder" SET "state"='COST_REVIEW',"lastError"=$2,"updatedAt"=NOW() WHERE "marketplaceOrderId"=$1`,orderId,`supplier_preflight_cost_${estimatedCostMinor}_exceeds_${maxCostMinor}`);
      await deliverUserEvent({userId:String(ctx.sellerId),eventKind:"LISTING",notificationKind:"SYSTEM",title:"Commande Petita à vérifier",body:`La commande ${ctx.orderNumber} dépasse la marge fournisseur autorisée. Aucun débit CJ n’a été effectué.`,actionUrl:`/commandes/${ctx.id}`,transactional:true,dedupeKey:`supplier-cost-review:${ctx.id}`,metadata:{orderId:ctx.id,provider:"CJ",estimatedCostMinor,maxCostMinor}});
      return{handled:true,state:"COST_REVIEW",estimatedCostMinor,maxCostMinor};
    }
    const createBody={
      orderNumber:String(ctx.orderNumber).slice(0,50),
      shippingZip:String(ctx.recipientPostalCode).slice(0,20),
      shippingCountry:countryName(String(ctx.recipientCountryCode)).slice(0,50),
      shippingCountryCode:String(ctx.recipientCountryCode).toUpperCase().slice(0,20),
      shippingProvince:String(ctx.recipientCity).slice(0,50),
      shippingCity:String(ctx.recipientCity).slice(0,50),
      shippingCustomerName:String(ctx.recipientName).slice(0,50),
      shippingAddress:String(ctx.recipientAddress1).slice(0,200),
      shippingAddress2:ctx.recipientAddress2?String(ctx.recipientAddress2).slice(0,200):undefined,
      shippingPhone:ctx.recipientPhone?String(ctx.recipientPhone).slice(0,20):undefined,
      remark:`PetitAnnonces ${ctx.orderNumber}`.slice(0,500),
      payType:3,logisticName,fromCountryCode:freight.origin,orderFlow:1,...iossFields(ctx),
      products:[{vid:String(ctx.externalVariantId),quantity:1,storeLineItemId:String(ctx.id).slice(0,125)}],
    };
    const created=await cjRequest("/shopping/order/createOrderV2",{method:"POST",body:JSON.stringify(createBody)});
    const data=created?.data??{};
    const providerOrderId=String(data.orderId??"").trim();
    const shipmentOrderId=String(data.shipmentOrderId??providerOrderId).trim();
    if(!providerOrderId||!shipmentOrderId)throw new Error("cj_order_id_missing");
    if(Boolean(data.logisticsMiss)||(Array.isArray(data.interceptOrderReasons)&&data.interceptOrderReasons.length))throw new Error("cj_order_intercepted");
    const actualUsd=Number(data.actualPayment??data.orderAmount??0);
    const actualEurMinor=Math.round(actualUsd*USD_TO_EUR*100);
    const marginAlert=actualEurMinor>0&&actualEurMinor>maxCostMinor?`supplier_actual_cost_${actualEurMinor}_exceeds_${maxCostMinor}`:null;
    const nextState=marginAlert?"COST_REVIEW":"READY_TO_PAY";
    await prisma.$executeRawUnsafe(`UPDATE "SupplierFulfillmentOrder" SET "providerOrderId"=$2,"providerShipmentOrderId"=$3,"providerStatus"=$4,"logisticName"=$5,"totalCostMinor"=$6,"costCurrency"='EUR',"state"=$7,"lastError"=$8,"raw"=$9::jsonb,"updatedAt"=NOW() WHERE "marketplaceOrderId"=$1`,orderId,providerOrderId,shipmentOrderId,String(data.orderStatus??"CREATED"),logisticName,actualEurMinor,nextState,marginAlert,JSON.stringify({create:data,estimatedCostMinor,maxCostMinor}));
    if(marginAlert){
      await deliverUserEvent({userId:String(ctx.sellerId),eventKind:"LISTING",notificationKind:"SYSTEM",title:"Marge Petita à contrôler",body:`La commande ${ctx.orderNumber} a été créée chez le fournisseur sans débit, mais le coût final dépasse le seuil autorisé.`,actionUrl:`/commandes/${ctx.id}`,transactional:true,dedupeKey:`supplier-margin-alert:${ctx.id}`,metadata:{orderId:ctx.id,provider:"CJ",actualEurMinor,maxCostMinor}}).catch(()=>undefined);
      return{handled:true,state:"COST_REVIEW",providerOrderId,shipmentOrderId,actualEurMinor,maxCostMinor};
    }
    await deliverUserEvent({userId:String(ctx.sellerId),eventKind:"LISTING",notificationKind:"SYSTEM",title:"Commande Petita prête à payer",body:`La commande ${ctx.orderNumber} a été créée chez le fournisseur et a passé le contrôle de marge. Aucun débit fournisseur n’a encore été effectué.`,actionUrl:`/commandes/${ctx.id}`,transactional:true,dedupeKey:`supplier-ready-to-pay:${ctx.id}`,metadata:{orderId:ctx.id,provider:"CJ",providerOrderId}}).catch(()=>undefined);
    return{handled:true,state:"READY_TO_PAY",providerOrderId,shipmentOrderId,actualEurMinor,maxCostMinor};
  }catch(error){
    const message=await markFailed(orderId,error);
    const ctx2=await orderContext(orderId).catch(()=>null);
    if(ctx2)await deliverUserEvent({userId:String(ctx2.sellerId),eventKind:"LISTING",notificationKind:"SYSTEM",title:"Fulfillment Petita en attente",body:`La commande ${ctx2.orderNumber} n’a pas pu être transmise automatiquement au fournisseur. Une nouvelle tentative sera effectuée.`,actionUrl:`/commandes/${ctx2.id}`,transactional:true,dedupeKey:`supplier-failed:${ctx2.id}:${Date.now()>>16}`,metadata:{orderId:ctx2.id,error:message}}).catch(()=>undefined);
    throw error;
  }
}

export async function paySupplierFulfillment(orderId:string){
  await ensureSupplierFulfillmentSchema();
  const rows=await prisma.$queryRawUnsafe<Array<FulfillmentOrder&{buyerId:string;orderNumber:string;marketplaceStatus:string}>>(`SELECT f.*,o."buyerId",o."orderNumber",o."status"::text AS "marketplaceStatus" FROM "SupplierFulfillmentOrder" f JOIN "MarketplaceOrder" o ON o."id"=f."marketplaceOrderId" WHERE f."marketplaceOrderId"=$1 LIMIT 1`,orderId);
  const row=rows[0];if(!row)return{handled:false};
  if(["SUBMITTED","PROCESSING","SHIPPED","DELIVERED"].includes(row.state))return{handled:true,state:row.state,alreadyPaid:true};
  if(!["READY_TO_PAY","PAYMENT_FAILED"].includes(row.state))throw new Error(`supplier_order_not_ready_to_pay_${row.state}`);
  if(!["PAID","PROCESSING"].includes(row.marketplaceStatus))throw new Error("marketplace_order_not_paid");
  const shipmentOrderId=String(row.providerShipmentOrderId??"").trim();if(!shipmentOrderId)throw new Error("cj_shipment_order_id_missing");
  try{
    const paid=await cjRequest("/shopping/pay/payBalanceV2",{method:"POST",body:JSON.stringify({shipmentOrderId})});
    await prisma.$executeRawUnsafe(`UPDATE "SupplierFulfillmentOrder" SET "state"='SUBMITTED',"providerStatus"='PAID',"raw"=COALESCE("raw",'{}'::jsonb)||$2::jsonb,"lastError"=NULL,"updatedAt"=NOW() WHERE "marketplaceOrderId"=$1`,orderId,JSON.stringify({payment:paid?.data??null}));
    await prisma.$executeRawUnsafe(`UPDATE "MarketplaceOrder" SET "status"='PROCESSING',"updatedAt"=NOW() WHERE "id"=$1 AND "status"='PAID'`,orderId);
    await deliverUserEvent({userId:String(row.buyerId),eventKind:"LISTING",notificationKind:"SYSTEM",title:"Votre commande est en préparation",body:`La commande ${row.orderNumber} a été transmise à notre partenaire logistique. Le suivi apparaîtra automatiquement dès l’expédition.`,actionUrl:`/commandes/${orderId}`,transactional:true,dedupeKey:`supplier-submitted:${orderId}:buyer`,metadata:{orderId,fulfillment:"supplier"}}).catch(()=>undefined);
    return{handled:true,state:"SUBMITTED",providerOrderId:row.providerOrderId,shipmentOrderId};
  }catch(error){
    const message=String((error as Error)?.message??error).slice(0,800);
    await prisma.$executeRawUnsafe(`UPDATE "SupplierFulfillmentOrder" SET "state"='PAYMENT_FAILED',"lastError"=$2,"updatedAt"=NOW() WHERE "marketplaceOrderId"=$1`,orderId,message);
    throw error;
  }
}

function mapSupplierStatus(value:string){
  const s=value.toUpperCase();
  if(s==="SHIPPED")return"SHIPPED";
  if(s==="DELIVERED")return"DELIVERED";
  if(["CANCELLED","OTHER"].includes(s))return"CANCELED";
  return"PROCESSING";
}

export async function syncSupplierFulfillment(orderId:string){
  await ensureSupplierFulfillmentSchema();
  const f=await fulfillmentRow(orderId);if(!f?.providerOrderId)return{synced:false};
  const payload=await cjRequest(`/shopping/order/getOrderDetail?orderId=${encodeURIComponent(f.providerOrderId)}&features=LOGISTICS_TIMELINESS`);
  const data=payload?.data??{};
  const providerStatus=String(data.orderStatus??"");
  const mapped=mapSupplierStatus(providerStatus);
  const tracking=String(data.trackNumber??"").trim()||null;
  const carrier=String(data.trackingProvider??data.logisticName??"Petita").trim()||"Petita";
  await prisma.$executeRawUnsafe(`UPDATE "SupplierFulfillmentOrder" SET "providerStatus"=$2,"trackingNumber"=$3,"trackingProvider"=$4,"state"=$5,"lastSyncedAt"=NOW(),"raw"=COALESCE("raw",'{}'::jsonb)||$6::jsonb,"updatedAt"=NOW() WHERE "marketplaceOrderId"=$1`,orderId,providerStatus,tracking,carrier,mapped,JSON.stringify({detail:data}));
  if(mapped==="PROCESSING")await prisma.$executeRawUnsafe(`UPDATE "MarketplaceOrder" SET "status"='PROCESSING',"updatedAt"=NOW() WHERE "id"=$1 AND "status" IN ('PAID','PROCESSING')`,orderId);
  if(mapped==="SHIPPED"&&tracking){
    const orderRows=await prisma.$queryRawUnsafe<Array<{buyerId:string;orderNumber:string}>>(`SELECT "buyerId","orderNumber" FROM "MarketplaceOrder" WHERE "id"=$1 LIMIT 1`,orderId);
    await prisma.$executeRawUnsafe(`INSERT INTO "MarketplaceShipment" ("id","orderId","carrier","service","trackingNumber","trackingUrl","status","shippedAt","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,'IN_TRANSIT',NOW(),NOW(),NOW()) ON CONFLICT ("orderId") DO UPDATE SET "carrier"=EXCLUDED."carrier","service"=EXCLUDED."service","trackingNumber"=EXCLUDED."trackingNumber","trackingUrl"=EXCLUDED."trackingUrl","status"='IN_TRANSIT',"shippedAt"=COALESCE("MarketplaceShipment"."shippedAt",NOW()),"updatedAt"=NOW()`,randomUUID(),orderId,`SUPPLIER:${carrier}`,String(data.logisticName??carrier),tracking,data.trackingUrl?String(data.trackingUrl):null);
    await prisma.$executeRawUnsafe(`UPDATE "MarketplaceOrder" SET "status"='SHIPPED',"updatedAt"=NOW() WHERE "id"=$1 AND "status" IN ('PAID','PROCESSING','SHIPPED')`,orderId);
    const o=orderRows[0];
    if(o)await deliverUserEvent({userId:o.buyerId,eventKind:"LISTING",notificationKind:"SYSTEM",title:"Votre colis est expédié",body:`La commande ${o.orderNumber} est en route. Numéro de suivi : ${tracking}.`,actionUrl:`/commandes/${orderId}`,transactional:true,dedupeKey:`supplier-shipped:${orderId}`,metadata:{orderId,trackingNumber:tracking,shipmentStatus:"IN_TRANSIT"}}).catch(()=>undefined);
  }
  if(mapped==="DELIVERED"){
    const now=new Date();
    await prisma.$executeRawUnsafe(`UPDATE "MarketplaceShipment" SET "status"='DELIVERED',"deliveredAt"=COALESCE("deliveredAt",$2),"updatedAt"=NOW() WHERE "orderId"=$1`,orderId,now);
    await prisma.$executeRawUnsafe(`UPDATE "MarketplaceOrder" SET "status"='DELIVERED',"updatedAt"=NOW() WHERE "id"=$1 AND "status" IN ('PAID','PROCESSING','SHIPPED','DELIVERED')`,orderId);
    await openProtectionWindow(orderId,now);
  }
  return{synced:true,state:mapped,providerStatus,tracking};
}

async function workerTick(log:FastifyBaseLogger){
  const pending=await prisma.$queryRawUnsafe<Array<{marketplaceOrderId:string;state:string;attemptCount:number}>>(`SELECT f."marketplaceOrderId",f."state",f."attemptCount" FROM "SupplierFulfillmentOrder" f JOIN "MarketplaceOrder" o ON o."id"=f."marketplaceOrderId" WHERE ((f."state" IN ('PENDING','FAILED') AND f."attemptCount"<3 AND o."status" IN ('PAID','PROCESSING') AND f."updatedAt"<NOW()-INTERVAL '5 minutes') OR (f."state" IN ('SUBMITTED','PROCESSING','SHIPPED') AND (f."lastSyncedAt" IS NULL OR f."lastSyncedAt"<NOW()-INTERVAL '10 minutes'))) ORDER BY f."updatedAt" ASC LIMIT 25`);
  for(const row of pending){
    try{
      if(["PENDING","FAILED"].includes(row.state))await submitSupplierFulfillment(row.marketplaceOrderId);
      else await syncSupplierFulfillment(row.marketplaceOrderId);
    }catch(error){log.warn({error,orderId:row.marketplaceOrderId},"supplier fulfillment worker item failed");}
  }
}
export function startSupplierFulfillmentWorker(log:FastifyBaseLogger){
  const run=()=>workerTick(log).catch(error=>log.error({error},"supplier fulfillment worker failed"));
  const startup=setTimeout(run,60_000);startup.unref();
  const timer=setInterval(run,10*60_000);timer.unref();
}
