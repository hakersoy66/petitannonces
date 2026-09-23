import { getRuntimeIntegration } from "./admin-control.js";

type PayPalRuntime={enabled:boolean;mode:"sandbox"|"live";clientId:string;clientSecret:string;baseUrl:string};
type CacheEntry={token:string;expiresAt:number;key:string};
let tokenCache:CacheEntry|null=null;

export async function getPayPalRuntime():Promise<PayPalRuntime|null>{
 const configured=await getRuntimeIntegration("paypal-checkout");
 if(!configured?.enabled)return null;
 const mode=String(configured.config.mode??"sandbox").toLowerCase()==="live"?"live":"sandbox";
 const clientId=String(configured.secrets.clientId??"").trim();
 const clientSecret=String(configured.secrets.clientSecret??"").trim();
 if(!clientId||!clientSecret)return null;
 return{enabled:true,mode,clientId,clientSecret,baseUrl:mode==="live"?"https://api-m.paypal.com":"https://api-m.sandbox.paypal.com"};
}

async function accessToken(runtime:PayPalRuntime){
 const key=`${runtime.mode}:${runtime.clientId}`;
 if(tokenCache&&tokenCache.key===key&&tokenCache.expiresAt>Date.now()+30_000)return tokenCache.token;
 const auth=Buffer.from(`${runtime.clientId}:${runtime.clientSecret}`,"utf8").toString("base64");
 const response=await fetch(`${runtime.baseUrl}/v1/oauth2/token`,{method:"POST",headers:{authorization:`Basic ${auth}`,"content-type":"application/x-www-form-urlencoded","accept":"application/json"},body:"grant_type=client_credentials"});
 const payload=await response.json().catch(()=>({})) as Record<string,unknown>;
 if(!response.ok)throw new Error(`paypal_auth_error_${response.status}`);
 const token=String(payload.access_token??"");
 if(!token)throw new Error("paypal_access_token_missing");
 const expires=Math.max(60,Number(payload.expires_in??300));
 tokenCache={token,key,expiresAt:Date.now()+expires*1000};
 return token;
}

async function paypalFetch(path:string,init:RequestInit={},requestId?:string){
 const runtime=await getPayPalRuntime();
 if(!runtime)throw new Error("paypal_not_configured");
 const token=await accessToken(runtime);
 const headers=new Headers(init.headers??{});
 headers.set("authorization",`Bearer ${token}`);
 headers.set("accept","application/json");
 if(init.body&&!headers.has("content-type"))headers.set("content-type","application/json");
 if(requestId)headers.set("PayPal-Request-Id",requestId.slice(0,108));
 const response=await fetch(`${runtime.baseUrl}${path}`,{...init,headers});
 const payload=await response.json().catch(()=>({})) as Record<string,any>;
 if(!response.ok){
  const issue=String(payload?.details?.[0]?.issue??payload?.name??"paypal_error");
  throw new Error(`paypal_${response.status}_${issue}`);
 }
 return payload;
}

export async function paypalCheckoutPublicConfig(){
 const runtime=await getPayPalRuntime();
 return runtime?{enabled:true,mode:runtime.mode,clientId:runtime.clientId,payLater4x:true}:{enabled:false,mode:null,clientId:null,payLater4x:false};
}

export async function testPayPalConnection(){
 const runtime=await getPayPalRuntime();
 if(!runtime)return{ok:false as const,error:"paypal_not_configured"};
 await accessToken(runtime);
 return{ok:true as const,mode:runtime.mode};
}

export async function createPayPalCheckout(input:{orderId:string;orderNumber:string;title:string;amountMinor:number;currency:string;returnUrl:string;cancelUrl:string;idempotencyKey:string}){
 const currency=input.currency.toUpperCase();
 const payload={
  intent:"CAPTURE",
  purchase_units:[{
   reference_id:input.orderId,
   custom_id:input.orderId,
   invoice_id:input.orderNumber.slice(0,127),
   description:input.title.slice(0,127),
   amount:{currency_code:currency,value:(input.amountMinor/100).toFixed(2)},
  }],
  payment_source:{paypal:{experience_context:{brand_name:"Petit Annonces",locale:"fr-FR",landing_page:"LOGIN",user_action:"PAY_NOW",return_url:input.returnUrl,cancel_url:input.cancelUrl}}},
 };
 const order=await paypalFetch("/v2/checkout/orders",{method:"POST",body:JSON.stringify(payload)},input.idempotencyKey);
 const approve=Array.isArray(order.links)?order.links.find((x:any)=>x?.rel==="payer-action"||x?.rel==="approve"):null;
 return{provider:"paypal",id:String(order.id??""),url:String(approve?.href??""),status:String(order.status??"CREATED")};
}

export async function getPayPalOrder(orderId:string){
 return paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}`,{method:"GET"});
}

export async function capturePayPalOrder(orderId:string,idempotencyKey:string){
 try{return await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,{method:"POST",headers:{"content-type":"application/json"},body:"{}"},idempotencyKey)}
 catch(error){const message=String(error instanceof Error?error.message:error);if(message.includes("ORDER_ALREADY_CAPTURED"))return getPayPalOrder(orderId);throw error}
}

export function paypalCaptureFromOrder(order:any){
 const unit=Array.isArray(order?.purchase_units)?order.purchase_units[0]:null;
 const capture=Array.isArray(unit?.payments?.captures)?unit.payments.captures[0]:null;
 return capture?{id:String(capture.id??""),status:String(capture.status??""),amountMinor:Math.round(Number(capture.amount?.value??0)*100),currency:String(capture.amount?.currency_code??"").toUpperCase()}:null;
}

export async function refundPayPalCapture(captureId:string,amountMinor:number,currency:string,idempotencyKey:string){
 const refund=await paypalFetch(`/v2/payments/captures/${encodeURIComponent(captureId)}/refund`,{method:"POST",body:JSON.stringify({amount:{value:(amountMinor/100).toFixed(2),currency_code:currency.toUpperCase()}})},idempotencyKey);
 return{id:String(refund.id??""),status:String(refund.status??"PENDING")};
}


export const PAYPAL_WEBHOOK_EVENTS=[
 "CHECKOUT.ORDER.APPROVED",
 "CHECKOUT.PAYMENT-APPROVAL.REVERSED",
 "PAYMENT.CAPTURE.PENDING",
 "PAYMENT.CAPTURE.COMPLETED",
 "PAYMENT.CAPTURE.DENIED",
 "PAYMENT.CAPTURE.REFUNDED",
 "PAYMENT.CAPTURE.REVERSED",
 "CUSTOMER.DISPUTE.CREATED",
] as const;

export async function createPayPalWebhook(url:string){
 const payload=await paypalFetch("/v1/notifications/webhooks",{method:"POST",body:JSON.stringify({url,event_types:PAYPAL_WEBHOOK_EVENTS.map(name=>({name}))})});
 return{id:String(payload.id??""),url:String(payload.url??url),eventTypes:Array.isArray(payload.event_types)?payload.event_types.map((x:any)=>String(x?.name??"")).filter(Boolean):[]};
}

export async function listPayPalWebhooks(){
 const payload=await paypalFetch("/v1/notifications/webhooks",{method:"GET"});
 return Array.isArray(payload.webhooks)?payload.webhooks as any[]:[];
}

export async function verifyPayPalWebhookSignature(input:{webhookId:string;event:any;transmissionId:string;transmissionTime:string;transmissionSig:string;certUrl:string;authAlgo:string}){
 if(!input.webhookId)return false;
 const payload=await paypalFetch("/v1/notifications/verify-webhook-signature",{method:"POST",body:JSON.stringify({
  auth_algo:input.authAlgo,
  cert_url:input.certUrl,
  transmission_id:input.transmissionId,
  transmission_sig:input.transmissionSig,
  transmission_time:input.transmissionTime,
  webhook_id:input.webhookId,
  webhook_event:input.event,
 })});
 return String(payload.verification_status??"").toUpperCase()==="SUCCESS";
}

export async function deletePayPalWebhook(webhookId:string){await paypalFetch(`/v1/notifications/webhooks/${encodeURIComponent(webhookId)}`,{method:"DELETE"});return{ok:true}}