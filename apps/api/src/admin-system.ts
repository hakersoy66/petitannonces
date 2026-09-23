import net from "node:net";
import { readdir, readFile, stat } from "node:fs/promises";
import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { requireAdminRoles } from "./rbac.js";
import { getRuntimeIntegration, getTwilioVerifyRuntime, resolveStripeBillingIntegration } from "./admin-control.js";
import { storageConfigured } from "./storage.js";
import { ensureJobTables } from "./job-observability.js";
import { ensurePayoutReconciliationSchema } from "./marketplace-stripe.js";

const ROLES=["SUPER_ADMIN","ADMIN"] as const;
async function redisCheck(){const raw=process.env.REDIS_URL;if(!raw)return{ok:true,skipped:true};try{const u=new URL(raw);const started=Date.now();return await new Promise<{ok:boolean;latencyMs?:number;error?:string}>(resolve=>{const socket=net.createConnection({host:u.hostname,port:Number(u.port||6379)});const done=(x:any)=>{socket.destroy();resolve(x)};socket.setTimeout(1200);socket.once("connect",()=>done({ok:true,latencyMs:Date.now()-started}));socket.once("timeout",()=>done({ok:false,error:"timeout"}));socket.once("error",e=>done({ok:false,error:e.message}))})}catch{return{ok:false,error:"invalid_redis_url"}}}
function envConfigured(...names:string[]){return names.every(name=>Boolean(process.env[name]))}
async function httpCheck(url:string){
  const started=Date.now();const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),1600);
  try{const response=await fetch(url,{signal:controller.signal,redirect:"manual"});return{ok:response.status>=200&&response.status<500,status:response.status,latencyMs:Date.now()-started}}
  catch(error){return{ok:false,latencyMs:Date.now()-started,error:error instanceof Error?error.message:"http_check_failed"}}
  finally{clearTimeout(timer)}
}
function runtimePorts(){const apiPort=Number(process.env.API_PORT||0);const color=process.env.APP_COLOR||(apiPort===4100?"green":apiPort===4000?"blue":"unknown");return{color,web:Number(process.env.WEB_PORT||(color==="green"?3100:3000)),admin:Number(process.env.ADMIN_PORT||(color==="green"?3101:3001)),api:apiPort||(color==="green"?4100:4000)}}
async function drStatus(){
  const healthDir="/var/www/petitannonces/shared/health";
  const now=Date.now();
  async function marker(name:string,maxAgeMs:number){
    try{const raw=JSON.parse(await readFile(`${healthDir}/${name}.json`,"utf8"));const completedAt=String(raw.completedAt??"");const ageMs=completedAt?Math.max(0,now-new Date(completedAt).getTime()):Number.POSITIVE_INFINITY;return{...raw,completedAt,ageMs,fresh:Boolean(raw.ok)&&ageMs<=maxAgeMs}}catch{return{ok:false,fresh:false,completedAt:null,ageMs:null}}
  }
  let local:any={ok:false,fresh:false,completedAt:null,ageMs:null};
  try{const dir="/var/www/petitannonces/backups";const files=(await readdir(dir)).filter(x=>/^petitannonces-.*\.dump$/.test(x));let latest:{name:string;mtimeMs:number;size:number}|null=null;for(const name of files){const st=await stat(`${dir}/${name}`);if(!latest||st.mtimeMs>latest.mtimeMs)latest={name,mtimeMs:st.mtimeMs,size:st.size}}if(latest){local={ok:true,fresh:now-latest.mtimeMs<=26*60*60*1000,completedAt:new Date(latest.mtimeMs).toISOString(),ageMs:now-latest.mtimeMs,backup:latest.name,sizeBytes:latest.size}}}catch{}
  const [offsite,media,restore]=await Promise.all([marker("offsite-backup",30*60*60*1000),marker("media-inventory",30*60*60*1000),marker("restore-drill",40*24*60*60*1000)]);
  return{local,offsite,mediaInventory:media,restoreDrill:restore,ok:[local,offsite,media,restore].every(x=>x.fresh)};
}

export async function registerAdminSystemRoutes(app:FastifyInstance){
  app.get("/admin/system/status",{preHandler:requireAdminRoles([...ROLES])},async(_request,reply)=>{
    await ensureJobTables();await ensurePayoutReconciliationSchema();
    const dbStart=Date.now();let database:any={ok:false};
    try{await prisma.$queryRaw`SELECT 1`;database={ok:true,latencyMs:Date.now()-dbStart}}catch(e){database={ok:false,error:e instanceof Error?e.message:"database_error"}}
    const ports=runtimePorts();
    const [redis,outbox,moderation,support,integrations,jobs,webhooks,unmatchedProviderEvents,recentNotificationFailures,staleNotifications,recentJobFailures,runtimeWeb,runtimeAdmin,runtimeApi]=await Promise.all([
      redisCheck(),
      prisma.$queryRawUnsafe<Array<{status:string;channel:string;count:bigint}>>(`SELECT "status","channel",COUNT(*)::bigint AS count FROM "NotificationDeliveryOutbox" GROUP BY "status","channel"`),
      prisma.$queryRawUnsafe<Array<{count:bigint}>>(`SELECT COUNT(*)::bigint AS count FROM "ModerationCase" mc JOIN "Listing" l ON l."id"=mc."targetId" WHERE mc."targetType"='LISTING' AND mc."status" NOT IN ('RESOLVED','CLOSED') AND l."status"='PENDING'`),
      prisma.$queryRawUnsafe<Array<{count:bigint}>>(`SELECT COUNT(*)::bigint AS count FROM "SupportTicket" WHERE "status" NOT IN ('RESOLVED','CLOSED')`),
      Promise.all(["marketplace-payment","paypal-checkout","stripe-billing","sendcloud","hostinger-mail","twilio-verify","openai","vehicle-data"].map(async provider=>[provider,await getRuntimeIntegration(provider as any)] as const)),
      prisma.$queryRawUnsafe<Array<Record<string,unknown>>>(`SELECT "id","jobName","status","startedAt","finishedAt","processed","failed","result","error" FROM "MarketplaceJobRun" ORDER BY "startedAt" DESC LIMIT 30`),
      prisma.$queryRawUnsafe<Array<Record<string,unknown>>>(`SELECT "provider","providerEventId","eventType","processedAt","createdAt","attemptCount","lastAttemptAt","lastError" FROM "PaymentWebhookEvent" ORDER BY "createdAt" DESC LIMIT 40`),
      prisma.$queryRawUnsafe<Array<Record<string,unknown>>>(`SELECT "providerEventId","eventType","providerObjectId","accountId","reason","createdAt" FROM "MarketplaceUnmatchedProviderEvent" ORDER BY "createdAt" DESC LIMIT 30`),
      prisma.$queryRawUnsafe<Array<{count:bigint}>>(`SELECT COUNT(*)::bigint AS count FROM "NotificationDeliveryOutbox" WHERE "status"='FAILED' AND "updatedAt">CURRENT_TIMESTAMP-INTERVAL '24 hours'`),
      prisma.$queryRawUnsafe<Array<{count:bigint}>>(`SELECT COUNT(*)::bigint AS count FROM "NotificationDeliveryOutbox" WHERE "status" IN ('PENDING','PROCESSING') AND "updatedAt"<CURRENT_TIMESTAMP-INTERVAL '30 minutes'`),
      prisma.$queryRawUnsafe<Array<{count:bigint}>>(`SELECT COUNT(*)::bigint AS count FROM "MarketplaceJobRun" WHERE "status"='FAILED' AND "startedAt">CURRENT_TIMESTAMP-INTERVAL '24 hours'`),
      httpCheck(`http://127.0.0.1:${ports.web}/`),
      httpCheck(`http://127.0.0.1:${ports.admin}/`),
      httpCheck(`http://127.0.0.1:${ports.api}/health/ready`),
    ]);
    const map=Object.fromEntries(integrations.map(([name,row])=>[name,{enabled:Boolean(row?.enabled),configured:Boolean(row&&(Object.keys(row.secrets).length||Object.keys(row.config).length))}]));
    const stripeRuntime=resolveStripeBillingIntegration(integrations.find(([name])=>name==="stripe-billing")?.[1]??null);
    const vehicleRuntime=integrations.find(([name])=>name==="vehicle-data")?.[1]??null;
    const vehicleAdminReady=Boolean(vehicleRuntime?.enabled&&(vehicleRuntime.secrets.openApiToken||vehicleRuntime.secrets.apiToken||vehicleRuntime.secrets.regcheckUsername));
    const vehicleEnvReady=Boolean(process.env.VEHICLE_DATA_OPENAPI_TOKEN||process.env.VEHICLE_DATA_API_TOKEN||process.env.VEHICLE_DATA_REGCHECK_USERNAME);
    const stripeWebhookSecret=stripeRuntime?.webhookSecret??"";const stripeWebhookToken=stripeRuntime?.webhookToken??"";const paypalRuntime=integrations.find(([name])=>name==="paypal-checkout")?.[1]??null;const paypalWebhookId=String(paypalRuntime?.config.webhookId??"");
    const paymentFallback=envConfigured("MARKETPLACE_PAYMENT_API_URL","MARKETPLACE_PAYMENT_API_TOKEN")||process.env.MARKETPLACE_PAYMENT_PROVIDER==="mock";
    const twilioVerifyReady=Boolean(await getTwilioVerifyRuntime());const smsGatewayReady=Boolean(process.env.SMS_GATEWAY_URL);
    const notificationWorkerEnabled=process.env.NOTIFICATION_WORKER_ENABLED==="true";
    const serviceStatus={
      database:{...database,critical:true},
      redis:{...redis,critical:process.env.REQUIRE_REDIS_READY==="true",optional:process.env.REQUIRE_REDIS_READY!=="true"},
      objectStorage:{ok:storageConfigured(),critical:true},
      notificationWorker:{ok:notificationWorkerEnabled,enabled:notificationWorkerEnabled,critical:true},
      payment:{ok:Boolean((map["marketplace-payment"] as any)?.enabled)||paymentFallback,critical:false,optional:true,mode:(map["marketplace-payment"] as any)?.enabled?"admin":(process.env.MARKETPLACE_PAYMENT_PROVIDER??"non configuré")},
      stripeWebhook:{ok:Boolean(stripeWebhookSecret&&stripeWebhookToken),critical:false,optional:true,tokenConfigured:Boolean(stripeWebhookToken),signatureConfigured:Boolean(stripeWebhookSecret),note:stripeWebhookSecret&&stripeWebhookToken?undefined:"Webhook Stripe non configuré ou incomplet"},
      paypalCheckout:{ok:Boolean(paypalRuntime?.enabled&&paypalWebhookId),critical:false,optional:true,mode:String(paypalRuntime?.config.mode??"non configuré"),webhookConfigured:Boolean(paypalWebhookId),note:paypalRuntime?.enabled&&paypalWebhookId?undefined:"PayPal LIVE ou son webhook n’est pas complètement configuré"},
      sendcloud:{ok:Boolean((map.sendcloud as any)?.enabled)||envConfigured("SENDCLOUD_PUBLIC_KEY","SENDCLOUD_PRIVATE_KEY"),critical:false,optional:true},
      hostingerMail:{ok:Boolean((map["hostinger-mail"] as any)?.enabled&&(map["hostinger-mail"] as any)?.configured)||envConfigured("SMTP_HOST","SMTP_USER","SMTP_PASS"),critical:true},
      smsVerification:{ok:twilioVerifyReady||smsGatewayReady,critical:false,optional:true,provider:twilioVerifyReady?"twilio-verify":smsGatewayReady?"gateway":"non configuré"},
      openai:{ok:Boolean((map.openai as any)?.enabled)||envConfigured("OPENAI_API_KEY"),critical:false,optional:true},
      vehicleData:{ok:vehicleAdminReady||vehicleEnvReady,critical:false,optional:true,mode:vehicleAdminReady?String(vehicleRuntime?.config.provider??"configuré"):vehicleEnvReady?String(process.env.VEHICLE_DATA_PROVIDER??"env"):"non configuré"},
    };
    const disasterRecovery=await drStatus();
    const runtime={color:ports.color,web:runtimeWeb,admin:runtimeAdmin,api:runtimeApi};
    const recentFailedNotifications=Number(recentNotificationFailures[0]?.count??0);const staleNotificationCount=Number(staleNotifications[0]?.count??0);const recentFailedJobs=Number(recentJobFailures[0]?.count??0);
    const webhookFailed=webhooks.filter((x:any)=>x.lastError&&!x.processedAt).length;const webhookPending=webhooks.filter((x:any)=>!x.processedAt).length;
    const criticalIssues:string[]=[];const warnings:string[]=[];
    for(const [key,value] of Object.entries(serviceStatus)){const row=value as any;if(row.critical&&!row.ok)criticalIssues.push(`service:${key}`)}
    if(!runtimeWeb.ok)criticalIssues.push("runtime:web");if(!runtimeAdmin.ok)criticalIssues.push("runtime:admin");if(!runtimeApi.ok)criticalIssues.push("runtime:api");
    if(!disasterRecovery.local.fresh)criticalIssues.push("backup:local");if(!disasterRecovery.offsite.fresh)criticalIssues.push("backup:offsite");
    if(!disasterRecovery.mediaInventory.fresh)warnings.push("backup:media-inventory");if(!disasterRecovery.restoreDrill.fresh)warnings.push("backup:restore-drill");
    if(recentFailedNotifications>0)warnings.push("notifications:failed-24h");if(staleNotificationCount>0)warnings.push("notifications:stale");if(recentFailedJobs>0)warnings.push("jobs:failed-24h");if(webhookFailed>0)warnings.push("webhooks:failed");if(unmatchedProviderEvents.length>0)warnings.push("finance:unmatched-events");
    const status=criticalIssues.length?"degraded":warnings.length?"attention":"operational";
    const memory=process.memoryUsage();
    return reply.send({status,timestamp:new Date().toISOString(),health:{criticalIssues,warnings,recentFailedNotifications,staleNotifications:staleNotificationCount,recentFailedJobs},disasterRecovery,runtime:{...runtime,node:process.version,uptimeSeconds:Math.round(process.uptime()),rssBytes:memory.rss,heapUsedBytes:memory.heapUsed,appVersion:process.env.APP_VERSION??"dev",environment:process.env.NODE_ENV??"development"},services:serviceStatus,queues:{notifications:outbox.map(x=>({...x,count:Number(x.count)})),moderation:Number(moderation[0]?.count??0),support:Number(support[0]?.count??0)},jobs,webhooks:{items:webhooks,failed:webhookFailed,pending:webhookPending},unmatchedProviderEvents})
  })
}
