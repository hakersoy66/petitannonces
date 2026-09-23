import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { getRuntimeIntegration } from "./admin-control.js";
import { requireAdminRoles } from "./rbac.js";

const ADMIN_ROLES=["SUPER_ADMIN","ADMIN"] as const;
const eventSchema=z.object({
 eventName:z.enum(["PageView","CompleteRegistration","ListingSubmitted","InitiateCheckout","Purchase","StartTrial"]),
 eventId:z.string().trim().min(8).max(160),
 eventSourceUrl:z.string().url().max(1200),
 advertisingConsent:z.literal(true),
 fbp:z.string().trim().max(255).optional(),
 fbc:z.string().trim().max(255).optional(),
 customData:z.record(z.string(),z.union([z.string(),z.number(),z.boolean(),z.null()])).optional(),
});

type MetaConfig={pixelId:string;accessToken:string;apiVersion:string;testEventCode:string;configured:boolean;source:"admin"|"env"|"none"};
function sha(value:string){return createHash("sha256").update(value).digest("hex")}
function normalizedEmail(value:string){return value.trim().toLowerCase()}
async function currentUser(request:FastifyRequest){
 const token=request.cookies?.pa_session;if(!token)return null;
 const session=await prisma.session.findUnique({where:{tokenHash:sha(token)},select:{userId:true,revokedAt:true,expiresAt:true}});
 if(!session||session.revokedAt||session.expiresAt<=new Date())return null;
 return prisma.user.findUnique({where:{id:session.userId},select:{id:true,email:true}});
}
async function metaConfig():Promise<MetaConfig>{
 const runtime=await getRuntimeIntegration("meta-ads");
 if(runtime?.enabled){
 const pixelId=String(runtime.config.pixelId??"").trim();
 const accessToken=String(runtime.secrets.accessToken??"").trim();
 const apiVersion=String(runtime.config.apiVersion??"v23.0").trim()||"v23.0";
 const testEventCode=String(runtime.config.testEventCode??"").trim();
 return{pixelId,accessToken,apiVersion,testEventCode,configured:Boolean(pixelId&&accessToken),source:"admin"};
 }
 const pixelId=(process.env.META_PIXEL_ID??"").trim();
 const accessToken=(process.env.META_CAPI_ACCESS_TOKEN??"").trim();
 const apiVersion=(process.env.META_CAPI_API_VERSION??"v23.0").trim()||"v23.0";
 const testEventCode=(process.env.META_TEST_EVENT_CODE??"").trim();
 if(pixelId||accessToken)return{pixelId,accessToken,apiVersion,testEventCode,configured:Boolean(pixelId&&accessToken),source:"env"};
 return{pixelId:"",accessToken:"",apiVersion:"v23.0",testEventCode:"",configured:false,source:"none"};
}
function endpoint(cfg:MetaConfig){return`https://graph.facebook.com/${encodeURIComponent(cfg.apiVersion)}/${encodeURIComponent(cfg.pixelId)}/events?access_token=${encodeURIComponent(cfg.accessToken)}`}
async function postMetaEvent(cfg:MetaConfig,payload:Record<string,unknown>){
 const response=await fetch(endpoint(cfg),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload),signal:AbortSignal.timeout(7000)});
 const result=await response.json().catch(()=>({})) as {events_received?:number;fbtrace_id?:string;error?:{message?:string;code?:number}};
 return{response,result};
}

export async function registerMetaConversionRoutes(app:FastifyInstance){
 app.get("/meta/config",async()=>{
 const cfg=await metaConfig();
 return{pixelId:cfg.pixelId||null,pixelConfigured:Boolean(cfg.pixelId),capiConfigured:cfg.configured};
 });

 app.post("/meta/events",async(request,reply)=>{
 const parsed=eventSchema.safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:"invalid_meta_event"});
 const cfg=await metaConfig();if(!cfg.configured)return reply.code(202).send({accepted:false,configured:false});
 const x=parsed.data;const user=await currentUser(request);
 const userData:Record<string,unknown>={client_ip_address:request.ip,client_user_agent:String(request.headers["user-agent"]??"")};
 if(x.fbp)userData.fbp=x.fbp;if(x.fbc)userData.fbc=x.fbc;
 if(user?.email)userData.em=[sha(normalizedEmail(user.email))];
 if(user?.id)userData.external_id=[sha(user.id)];
 const payload:Record<string,unknown>={data:[{event_name:x.eventName,event_time:Math.floor(Date.now()/1000),event_id:x.eventId,event_source_url:x.eventSourceUrl,action_source:"website",user_data:userData,custom_data:x.customData??{}}]};
 if(cfg.testEventCode)payload.test_event_code=cfg.testEventCode;
 try{
 const{response,result}=await postMetaEvent(cfg,payload);
 if(!response.ok){app.log.warn({status:response.status,metaError:result.error?.message,metaCode:result.error?.code},"Meta CAPI event rejected");return reply.code(502).send({error:"meta_capi_rejected"})}
 return reply.send({accepted:true,configured:true});
 }catch(error){app.log.warn({error:error instanceof Error?error.message:"meta_capi_failed"},"Meta CAPI unavailable");return reply.code(502).send({error:"meta_capi_unavailable"})}
 });

 app.post("/admin/integrations/meta-ads/test",{preHandler:requireAdminRoles([...ADMIN_ROLES])},async(request,reply)=>{
 const cfg=await metaConfig();
 if(!cfg.configured)return reply.code(409).send({error:"meta_ads_not_configured"});
 if(!cfg.testEventCode)return reply.code(409).send({error:"meta_test_event_code_required"});
 const payload={data:[{event_name:"PageView",event_time:Math.floor(Date.now()/1000),event_id:`admin-test-${randomUUID()}`,event_source_url:"https://petitannonces.fr/",action_source:"website",user_data:{client_ip_address:request.ip,client_user_agent:String(request.headers["user-agent"]??"")},custom_data:{integration_test:true}}],test_event_code:cfg.testEventCode};
 try{
 const{response,result}=await postMetaEvent(cfg,payload);
 if(!response.ok)return reply.code(502).send({error:"meta_connection_failed",status:response.status,metaCode:result.error?.code,detail:result.error?.message??null});
 return reply.send({ok:true,pixelId:cfg.pixelId,eventsReceived:Number(result.events_received??0),testMode:true});
 }catch{return reply.code(502).send({error:"meta_connection_failed"})}
 });
}

export async function getMetaConversionStatus(){const cfg=await metaConfig();return{pixelId:cfg.pixelId||null,pixelConfigured:Boolean(cfg.pixelId),capiConfigured:cfg.configured,testMode:Boolean(cfg.testEventCode),source:cfg.source}}
