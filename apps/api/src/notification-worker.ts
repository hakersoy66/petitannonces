import { sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { prisma } from "@pa/database";
import webpush from "web-push";
import { sendApplicationEmail, type EmailSendResult } from "./email-provider.js";
import { getNotificationPresentation } from "./admin-notifications.js";

const MAX_ATTEMPTS = 5;
const DEFAULT_BATCH_SIZE = 25;
const STALE_PROCESSING_MINUTES = 10;

type Channel = "EMAIL" | "PUSH";
type OutboxRow = { id:string; userId:string; notificationId:string|null; eventKind:string; channel:Channel; payload:unknown; attempts:number };
type DeliveryPayload = { title:string; body:string; actionUrl?:string|null; metadata?:Record<string,unknown> };
type PushSubscriptionRow = { id:string; platform:"WEB"|"IOS"|"ANDROID"; endpoint:string|null; p256dh:string|null; auth:string|null; nativeToken:string|null; deviceLabel:string|null };
class ProviderUnavailableError extends Error {}
function payloadOf(value:unknown):DeliveryPayload{if(!value||typeof value!=="object")throw new Error("invalid_notification_payload");const p=value as Record<string,unknown>;if(typeof p.title!=="string"||typeof p.body!=="string")throw new Error("invalid_notification_payload");return{title:p.title,body:p.body,actionUrl:typeof p.actionUrl==="string"?p.actionUrl:null,metadata:p.metadata&&typeof p.metadata==="object"?p.metadata as Record<string,unknown>:{}};}
function retryDelayMs(attempts:number){const s=[60000,300000,1800000,7200000,43200000];return s[Math.min(Math.max(attempts-1,0),s.length-1)]??43200000;}
function absoluteActionUrl(actionUrl?:string|null){if(!actionUrl)return null;if(/^https?:\/\//i.test(actionUrl))return actionUrl;const base=(process.env.PUBLIC_WEB_URL??"https://petitannonces.fr").replace(/\/$/,"");return `${base}${actionUrl.startsWith("/")?actionUrl:`/${actionUrl}`}`;}
function escapeHtml(value:string){return value.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]??c));}
async function sendEmail(row:OutboxRow,payload:DeliveryPayload):Promise<EmailSendResult>{
  const user=await prisma.user.findUnique({where:{id:row.userId},select:{email:true}});
  if(!user?.email)throw new Error("recipient_email_missing");
  const actionUrl=absoluteActionUrl(payload.actionUrl);
  const transactional=payload.metadata?.transactional===true;
  const presentation=await getNotificationPresentation();
  const footer=transactional?presentation.transactionalFooter:presentation.generalFooter;
  const html=`<!doctype html><html><body style="margin:0;background:#f6f5fb;font-family:Arial,Helvetica,sans-serif;color:#252033"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f5fb;padding:32px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #ebe8f4"><tr><td style="padding:24px 30px;background:#5b21b6;color:#ffffff"><div style="font-size:22px;font-weight:800;letter-spacing:-.3px">Petit Annonces</div><div style="margin-top:4px;font-size:13px;opacity:.9">Achetez, vendez et échangez simplement en France</div></td></tr><tr><td style="padding:32px 30px"><h1 style="margin:0 0 18px;font-size:26px;line-height:1.25;color:#24163d">${escapeHtml(payload.title)}</h1><p style="margin:0;font-size:16px;line-height:1.7;color:#494052">${escapeHtml(payload.body)}</p>${actionUrl?`<div style="margin:28px 0 8px"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:14px 22px;background:#6d28d9;color:#ffffff;text-decoration:none;border-radius:12px;font-weight:700;font-size:15px">${escapeHtml(presentation.buttonLabel)}</a></div>`:""}<div style="height:1px;background:#ece8f2;margin:30px 0 20px"></div><p style="margin:0;color:#756d80;font-size:12px;line-height:1.6">${escapeHtml(footer)}</p><p style="margin:12px 0 0;color:#9a93a3;font-size:11px;line-height:1.5">© ${new Date().getFullYear()} Petit Annonces · petitannonces.fr</p></td></tr></table></td></tr></table></body></html>`;
  const text=`${payload.title}

${payload.body}${actionUrl?`

${actionUrl}`:""}`;
  return sendApplicationEmail({to:user.email,subject:payload.title,html,text,idempotencyKey:row.id,tags:[{name:"event_kind",value:row.eventKind.slice(0,256)},{name:"outbox_id",value:row.id.slice(0,256)}]});
}
function configureWebPush(){const publicKey=process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY;const privateKey=process.env.WEB_PUSH_PRIVATE_KEY;const subject=process.env.WEB_PUSH_SUBJECT??"mailto:support@petitannonces.fr";if(!publicKey||!privateKey)throw new ProviderUnavailableError("web_push_not_configured");webpush.setVapidDetails(subject,publicKey,privateKey);}
async function sendWebPush(subscription:PushSubscriptionRow,payload:DeliveryPayload,badgeCount:number,notificationId:string|null){if(!subscription.endpoint||!subscription.p256dh||!subscription.auth)throw new Error("invalid_web_push_subscription");configureWebPush();try{await webpush.sendNotification({endpoint:subscription.endpoint,keys:{p256dh:subscription.p256dh,auth:subscription.auth}},JSON.stringify({title:payload.title,body:payload.body,actionUrl:payload.actionUrl??null,url:absoluteActionUrl(payload.actionUrl),metadata:payload.metadata??{},badgeCount,notificationId}));}catch(error){const statusCode=typeof error==="object"&&error&&"statusCode" in error?Number((error as {statusCode?:unknown}).statusCode):0;if(statusCode===404||statusCode===410){await prisma.$executeRawUnsafe(`UPDATE "PushSubscription" SET "isActive"=FALSE,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,subscription.id);return;}throw error;}}
function isExpoToken(value:string){return /^(ExponentPushToken|ExpoPushToken)\[.+\]$/.test(value);}
type FcmServiceAccount={project_id:string;client_email:string;private_key:string};
let fcmCredentialCache:FcmServiceAccount|null=null;
let fcmAccessCache:{token:string;expiresAt:number}|null=null;
function b64url(value:string|Buffer){return Buffer.from(value).toString("base64url");}
async function fcmCredential(){
  if(fcmCredentialCache)return fcmCredentialCache;
  const file=process.env.FCM_SERVICE_ACCOUNT_FILE??"/var/www/petitannonces/shared/android-firebase/fcm-service-account.json";
  try{
    const parsed=JSON.parse(await readFile(file,"utf8")) as Partial<FcmServiceAccount>;
    if(!parsed.project_id||!parsed.client_email||!parsed.private_key)throw new Error("invalid_fcm_service_account");
    fcmCredentialCache={project_id:parsed.project_id,client_email:parsed.client_email,private_key:parsed.private_key};
    return fcmCredentialCache;
  }catch(error){throw new ProviderUnavailableError(`fcm_service_account_unavailable:${error instanceof Error?error.message:"read_failed"}`);}
}
async function fcmAccessToken(){
  const now=Math.floor(Date.now()/1000);
  if(fcmAccessCache&&fcmAccessCache.expiresAt>now+90)return fcmAccessCache.token;
  const credential=await fcmCredential();
  const header=b64url(JSON.stringify({alg:"RS256",typ:"JWT"}));
  const claims=b64url(JSON.stringify({iss:credential.client_email,scope:"https://www.googleapis.com/auth/firebase.messaging",aud:"https://oauth2.googleapis.com/token",iat:now,exp:now+3600}));
  const unsigned=`${header}.${claims}`;
  const signature=sign("RSA-SHA256",Buffer.from(unsigned),credential.private_key).toString("base64url");
  const assertion=`${unsigned}.${signature}`;
  const response=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion})});
  const result=await response.json().catch(()=>({})) as {access_token?:unknown;expires_in?:unknown;error?:unknown;error_description?:unknown};
  if(!response.ok||typeof result.access_token!=="string")throw new ProviderUnavailableError(`fcm_oauth_${response.status}_${String(result.error??result.error_description??"token_error").slice(0,180)}`);
  const expiresIn=Math.max(300,Number(result.expires_in??3600));
  fcmAccessCache={token:result.access_token,expiresAt:now+expiresIn};
  return result.access_token;
}
function fcmData(payload:DeliveryPayload,badgeCount:number,notificationId:string|null){
  const out:Record<string,string>={badgeCount:String(badgeCount)};
  const url=absoluteActionUrl(payload.actionUrl); if(url)out.url=url;
  if(notificationId)out.notificationId=notificationId;
  if(payload.metadata&&Object.keys(payload.metadata).length)out.metadata=JSON.stringify(payload.metadata).slice(0,3500);
  return out;
}
function androidChannelId(subscription:PushSubscriptionRow,eventKind:string){
  const v3=subscription.deviceLabel?.includes("pa-channels-v3");
  return eventKind==="MESSAGE"?(v3?"pa-messages-v3":"pa-messages-v2"):(v3?"pa-general-v3":"pa-general-v2");
}
async function sendFcmV1(subscription:PushSubscriptionRow,payload:DeliveryPayload,badgeCount:number,notificationId:string|null,eventKind:string){
  if(!subscription.nativeToken)throw new Error("native_push_token_missing");
  const credential=await fcmCredential();
  const access=await fcmAccessToken();
  const channelId=androidChannelId(subscription,eventKind);
  const response=await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(credential.project_id)}/messages:send`,{
    method:"POST",headers:{authorization:`Bearer ${access}`,"content-type":"application/json"},
    body:JSON.stringify({message:{token:subscription.nativeToken,notification:{title:payload.title,body:payload.body},data:fcmData(payload,badgeCount,notificationId),android:{priority:"high",notification:{sound:"default",channel_id:channelId,notification_count:badgeCount}}}}),
  });
  if(response.ok)return;
  const text=(await response.text()).slice(0,700);
  let status="";try{const parsed=JSON.parse(text) as {error?:{status?:string;details?:Array<Record<string,unknown>>}};status=String(parsed.error?.status??"");const details=parsed.error?.details??[];if(details.some(d=>String(d.errorCode??"")==="UNREGISTERED"))status="UNREGISTERED";}catch{}
  if(response.status===404||status==="UNREGISTERED"||status==="NOT_FOUND"){
    await prisma.$executeRawUnsafe(`UPDATE "PushSubscription" SET "isActive"=FALSE,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,subscription.id);
    throw new Error("fcm_device_not_registered");
  }
  if(response.status===401||response.status===403)throw new ProviderUnavailableError(`fcm_auth_${response.status}_${text}`);
  throw new Error(`fcm_${response.status}_${text}`);
}
async function sendNativePush(subscription:PushSubscriptionRow,payload:DeliveryPayload,badgeCount:number,notificationId:string|null,eventKind:string){
  if(!subscription.nativeToken)throw new Error("native_push_token_missing");
  const data={url:absoluteActionUrl(payload.actionUrl),...(payload.metadata??{}),badgeCount,notificationId};
  if(subscription.platform==="ANDROID"&&!isExpoToken(subscription.nativeToken)){await sendFcmV1(subscription,payload,badgeCount,notificationId,eventKind);return;}
  if(isExpoToken(subscription.nativeToken)){
    const channelId=subscription.platform==="ANDROID"&&(subscription.deviceLabel?.includes("pa-channels-v2")||subscription.deviceLabel?.includes("pa-channels-v3"))?androidChannelId(subscription,eventKind):undefined;
    const response=await fetch("https://exp.host/--/api/v2/push/send",{method:"POST",headers:{"content-type":"application/json",accept:"application/json","accept-encoding":"gzip, deflate"},body:JSON.stringify({to:subscription.nativeToken,title:payload.title,body:payload.body,data,sound:"default",badge:badgeCount,priority:"high",...(channelId?{channelId}:{})})});
    if(!response.ok)throw new Error(`expo_${response.status}_${(await response.text()).slice(0,300)}`);
    const result=await response.json() as {data?:{status?:string;details?:{error?:string}}};
    if(result.data?.status==="error"){
      if(result.data.details?.error==="DeviceNotRegistered"){await prisma.$executeRawUnsafe(`UPDATE "PushSubscription" SET "isActive"=FALSE,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,subscription.id);throw new Error("expo_device_not_registered");}
      throw new Error(`expo_${result.data.details?.error??"delivery_error"}`);
    }
    return;
  }
  const gateway=process.env.PUSH_NATIVE_GATEWAY_URL;
  if(!gateway)throw new ProviderUnavailableError("native_push_gateway_not_configured");
  const response=await fetch(gateway,{method:"POST",headers:{"content-type":"application/json",...(process.env.PUSH_NATIVE_GATEWAY_TOKEN?{authorization:`Bearer ${process.env.PUSH_NATIVE_GATEWAY_TOKEN}`}:{}) ,"idempotency-key":subscription.id},body:JSON.stringify({platform:subscription.platform,token:subscription.nativeToken,title:payload.title,body:payload.body,actionUrl:absoluteActionUrl(payload.actionUrl),metadata:payload.metadata??{},badgeCount,notificationId,priority:"high"})});
  if(!response.ok)throw new Error(`native_gateway_${response.status}_${(await response.text()).slice(0,300)}`);
}
async function sendPush(row:OutboxRow,payload:DeliveryPayload){const subscriptions=await prisma.$queryRawUnsafe<PushSubscriptionRow[]>(`SELECT "id","platform","endpoint","p256dh","auth","nativeToken","deviceLabel" FROM "PushSubscription" WHERE "userId"=$1 AND "isActive"=TRUE ORDER BY "updatedAt" DESC`,row.userId);if(subscriptions.length===0)return;const unreadRows=await prisma.$queryRawUnsafe<Array<{count:bigint}>>(`SELECT COUNT(*)::bigint AS "count" FROM "UserNotification" WHERE "userId"=$1 AND "readAt" IS NULL`,row.userId);const explicit=Number(payload.metadata?.badgeCount);const badgeCount=Number.isFinite(explicit)&&explicit>=0?Math.floor(explicit):Number(unreadRows[0]?.count??0n);let delivered=0,unavailable=0;let lastError:unknown=null;for(const subscription of subscriptions){try{if(subscription.platform==="WEB")await sendWebPush(subscription,payload,badgeCount,row.notificationId);else await sendNativePush(subscription,payload,badgeCount,row.notificationId,row.eventKind);delivered+=1;}catch(error){lastError=error;if(error instanceof ProviderUnavailableError)unavailable+=1;}}if(delivered>0)return;if(unavailable===subscriptions.length)throw new ProviderUnavailableError("push_provider_not_configured");if(lastError instanceof Error)throw lastError;throw new Error("push_delivery_failed");}
async function recoverStaleRows(){await prisma.$executeRawUnsafe(`UPDATE "NotificationDeliveryOutbox" SET "status"='FAILED',"lastError"='password_reset_expired_before_delivery',"updatedAt"=CURRENT_TIMESTAMP WHERE "eventKind"='AUTH_PASSWORD_RESET' AND "status" IN ('PENDING','PROCESSING') AND "createdAt" < CURRENT_TIMESTAMP - INTERVAL '30 minutes'`);await prisma.$executeRawUnsafe(`UPDATE "NotificationDeliveryOutbox" SET "status"='PENDING',"updatedAt"=CURRENT_TIMESTAMP,"lastError"=COALESCE("lastError",'worker_recovered_stale_claim') WHERE "status"='PROCESSING' AND "updatedAt" < CURRENT_TIMESTAMP - INTERVAL '${STALE_PROCESSING_MINUTES} minutes'`);await prisma.$executeRawUnsafe(`UPDATE "PushSubscription" SET "isActive"=FALSE,"updatedAt"=CURRENT_TIMESTAMP WHERE "isActive"=TRUE AND "lastSeenAt" < CURRENT_TIMESTAMP - INTERVAL '120 days'`);}
async function claimBatch(limit:number):Promise<OutboxRow[]>{return prisma.$queryRawUnsafe<OutboxRow[]>(`WITH picked AS (SELECT "id" FROM "NotificationDeliveryOutbox" WHERE "status"='PENDING' AND "availableAt"<=CURRENT_TIMESTAMP ORDER BY "createdAt" ASC LIMIT $1 FOR UPDATE SKIP LOCKED) UPDATE "NotificationDeliveryOutbox" o SET "status"='PROCESSING',"attempts"=o."attempts"+1,"updatedAt"=CURRENT_TIMESTAMP FROM picked WHERE o."id"=picked."id" RETURNING o."id",o."userId",o."notificationId",o."eventKind",o."channel",o."payload",o."attempts"`,limit);}
async function markSent(id:string,email?:EmailSendResult|null){await prisma.$executeRawUnsafe(`UPDATE "NotificationDeliveryOutbox" SET "status"='SENT',"sentAt"=CURRENT_TIMESTAMP,"lastError"=NULL,"provider"=COALESCE($2,"provider"),"providerMessageId"=COALESCE($3,"providerMessageId"),"deliveryStatus"=COALESCE($4,"deliveryStatus"),"acceptedAt"=CASE WHEN $4 IS NOT NULL THEN COALESCE("acceptedAt",CURRENT_TIMESTAMP) ELSE "acceptedAt" END,"lastProviderEventAt"=CASE WHEN $4 IS NOT NULL THEN CURRENT_TIMESTAMP ELSE "lastProviderEventAt" END,"providerError"=NULL,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,id,email?.provider??null,email?.providerMessageId??null,email?.deliveryStatus??null);}
async function markRetry(row:OutboxRow,error:unknown){const message=error instanceof Error?error.message.slice(0,1000):String(error).slice(0,1000);if(error instanceof ProviderUnavailableError){await prisma.$executeRawUnsafe(`UPDATE "NotificationDeliveryOutbox" SET "status"='PENDING',"attempts"=GREATEST("attempts"-1,0),"availableAt"=CURRENT_TIMESTAMP + INTERVAL '15 minutes',"lastError"=$2,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,row.id,message);return;}if(row.attempts>=MAX_ATTEMPTS){await prisma.$executeRawUnsafe(`UPDATE "NotificationDeliveryOutbox" SET "status"='FAILED',"lastError"=$2,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,row.id,message);return;}const next=new Date(Date.now()+retryDelayMs(row.attempts));await prisma.$executeRawUnsafe(`UPDATE "NotificationDeliveryOutbox" SET "status"='PENDING',"availableAt"=$2,"lastError"=$3,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,row.id,next,message);}
export async function processNotificationOutbox(batchSize=DEFAULT_BATCH_SIZE){await recoverStaleRows();const rows=await claimBatch(Math.min(Math.max(batchSize,1),100));let sent=0,retried=0,failed=0;for(const row of rows){try{const payload=payloadOf(row.payload);let emailResult:EmailSendResult|null=null;if(row.channel==="EMAIL")emailResult=await sendEmail(row,payload);else await sendPush(row,payload);await markSent(row.id,emailResult);sent+=1;}catch(error){await markRetry(row,error);if(!(error instanceof ProviderUnavailableError)&&row.attempts>=MAX_ATTEMPTS)failed+=1;else retried+=1;}}return{claimed:rows.length,sent,retried,failed};}
export function startNotificationWorker(log?:{info:(value:unknown,message?:string)=>void;error:(value:unknown,message?:string)=>void}){if(process.env.NOTIFICATION_WORKER_ENABLED!=="true")return null;const intervalMs=Math.max(Number(process.env.NOTIFICATION_WORKER_INTERVAL_MS??15000),5000);let running=false;const tick=async()=>{if(running)return;running=true;try{const result=await processNotificationOutbox(Number(process.env.NOTIFICATION_WORKER_BATCH_SIZE??DEFAULT_BATCH_SIZE));if(result.claimed>0)log?.info(result,"notification delivery batch processed");}catch(error){log?.error(error,"notification delivery worker failed");}finally{running=false;}};void tick();const timer=setInterval(()=>void tick(),intervalMs);timer.unref();return timer;}
