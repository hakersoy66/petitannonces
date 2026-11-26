import {createHash,randomUUID} from "node:crypto";
import {prisma} from "@pa/database";
import type {FastifyInstance,FastifyRequest,FastifyReply} from "fastify";
import {z} from "zod";
import {requireAdminRoles} from "./rbac.js";
import {getSiteSettings} from "./admin-control.js";
import {getAutoApprovalSettings} from "./auto-approval.js";
const KEY="system.feature_controls";
const schema=z.object({listingSubmission:z.boolean(),listingImport:z.boolean(),newMessages:z.boolean(),storeCreation:z.boolean(),newPromotions:z.boolean()}).strict();
type Features=z.infer<typeof schema>;
const defaults:Features={listingSubmission:true,listingImport:true,newMessages:true,storeCreation:true,newPromotions:true};
const paths:Record<string,keyof Features>={
 "/listings/:id/publish":"listingSubmission",
 "/listings/:id/submit":"listingSubmission",
 "/listing-import/preview":"listingImport",
 "/listing-import/create-draft":"listingImport",
 "/pro/import/csv":"listingImport",
 "/pro/feed/v1/listings":"listingImport",
 "/pro/feed/v1/xml":"listingImport",
 "/pro/feed/v2/listings":"listingImport",
 "/pro/feed/v2/xml":"listingImport",
 "/conversations":"newMessages",
 "/conversations/:id/messages":"newMessages",
 "/conversations/:id/offers":"newMessages",
 "/conversations/:id/attachments/upload-direct":"newMessages",
 "/pro/stores":"storeCreation",
 "/listings/:id/promotions":"newPromotions"
};
async function readFeatures(){
 const rows=await prisma.$queryRaw<Array<{value:unknown;updatedAt:Date}>>`SELECT "value","updatedAt" FROM "AdminSetting" WHERE "key"=${KEY}`;
 return {features:rows[0]?schema.parse(rows[0].value):{...defaults},revision:rows[0]?.updatedAt.toISOString()??null};
}
export async function systemFeaturePreHandler(request:FastifyRequest,reply:FastifyReply){
 if(request.method!=="POST")return;
 const feature=paths[request.routeOptions.url??""];
 if(!feature)return;
 const {features}=await readFeatures();
 if(!features[feature])return reply.code(503).send({error:"feature_temporarily_disabled",feature,message:"Cette fonctionnalité est temporairement indisponible. Réessayez ultérieurement."});
}
export async function registerSystemFeatureRoutes(app:FastifyInstance){
 app.get("/admin/system/features",{preHandler:requireAdminRoles(["SUPER_ADMIN","ADMIN"])},async(_request,reply)=>{
  const [current,site,auto,history]=await Promise.all([readFeatures(),getSiteSettings(),getAutoApprovalSettings(),prisma.$queryRaw<Array<{id:string;createdAt:Date;reason:string|null;actorEmail:string|null}>>`SELECT a."id",a."createdAt",a."metadata"->>'reason' AS reason,u."email" AS "actorEmail" FROM "AdminAuditEvent" a LEFT JOIN "User" u ON u."id"=a."actorUserId" WHERE a."action"='SYSTEM_FEATURE_CONTROLS_UPDATED' ORDER BY a."createdAt" DESC LIMIT 20`]);
  return reply.send({...current,maintenanceMode:site.maintenanceMode,allowRegistrations:site.allowRegistrations,autoApprovalEnabled:auto.enabled,history});
 });
 app.put("/admin/system/features",{preHandler:requireAdminRoles(["SUPER_ADMIN","ADMIN"])},async(request,reply)=>{
  const body=z.object({features:schema,revision:z.string().datetime().nullable(),reason:z.string().trim().min(5).max(500)}).safeParse(request.body);
  if(!body.success)return reply.code(400).send({error:"invalid_request"});
  const token=request.cookies.pa_session;
  if(!token)return reply.code(401).send({error:"unauthorized"});
  const session=await prisma.session.findUnique({where:{tokenHash:createHash("sha256").update(token).digest("hex")},select:{userId:true}});
  if(!session)return reply.code(401).send({error:"unauthorized"});
  const result=await prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${KEY}))::text`;
   const rows=await tx.$queryRaw<Array<{value:unknown;updatedAt:Date}>>`SELECT "value","updatedAt" FROM "AdminSetting" WHERE "key"=${KEY} FOR UPDATE`;
   const current=rows[0];
   if((current?.updatedAt.toISOString()??null)!==body.data.revision)return null;
   const previous=current?schema.parse(current.value):defaults;
   const saved=await tx.$queryRaw<Array<{updatedAt:Date}>>`INSERT INTO "AdminSetting" ("key","value","updatedByUserId","updatedAt") VALUES (${KEY},${JSON.stringify(body.data.features)}::jsonb,${session.userId},CURRENT_TIMESTAMP) ON CONFLICT ("key") DO UPDATE SET "value"=EXCLUDED."value","updatedByUserId"=EXCLUDED."updatedByUserId","updatedAt"=CURRENT_TIMESTAMP RETURNING "updatedAt"`;
   await tx.$executeRaw`INSERT INTO "AdminAuditEvent" ("id","actorUserId","action","entityType","entityId","metadata") VALUES (${randomUUID()},${session.userId},'SYSTEM_FEATURE_CONTROLS_UPDATED','SYSTEM',${KEY},${JSON.stringify({previous,features:body.data.features,reason:body.data.reason})}::jsonb)`;
   return {features:body.data.features,revision:saved[0]?.updatedAt.toISOString()??null};
  });
  if(!result)return reply.code(409).send({error:"settings_changed_reload_required"});
  return reply.send(result);
 });
}
