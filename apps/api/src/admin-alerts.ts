import {createHash} from "node:crypto";
import {prisma} from "@pa/database";
import type {FastifyInstance} from "fastify";
import {requireAdminRoles} from "./rbac.js";
const roles=["SUPER_ADMIN","ADMIN","MODERATOR","SUPPORT","COMPLIANCE","FINANCE","MARKETING"] as const;
type Alert={key:string;count:number;urgent:number};
export async function registerAdminAlertRoutes(app:FastifyInstance){
 app.get("/admin/alerts",{preHandler:requireAdminRoles([...roles])},async(request,reply)=>{
  const token=request.cookies.pa_session;
  if(!token)return reply.code(401).send({error:"unauthorized"});
  const session=await prisma.session.findUnique({where:{tokenHash:createHash("sha256").update(token).digest("hex")},select:{userId:true,user:{select:{roles:{select:{role:true}}}}}});
  if(!session)return reply.code(401).send({error:"unauthorized"});
  const assigned=session.user.roles.map(r=>r.role);
  const allow=(...extra:string[])=>assigned.some(r=>["SUPER_ADMIN","ADMIN",...extra].includes(r));
  const results=await prisma.$transaction(async tx=>{
   await tx.$executeRaw`SET LOCAL statement_timeout='5000ms'`;
   const alerts:Alert[]=[];
   if(allow("MODERATOR","SUPPORT","COMPLIANCE")){
    const a=await tx.$queryRaw<Alert[]>`SELECT 'listings' AS key,COUNT(*)::int AS count,COUNT(*) FILTER(WHERE "updatedAt"<CURRENT_TIMESTAMP-INTERVAL '24 hours')::int AS urgent FROM "Listing" WHERE "status"='PENDING' UNION ALL SELECT 'reports',COUNT(*)::int,0 FROM "TrustReport" WHERE "status" NOT IN ('DISMISSED','CLOSED')`;
    alerts.push(...a);
   }
   if(allow("SUPPORT")){
    alerts.push(...await tx.$queryRaw<Alert[]>`SELECT 'support' AS key,COUNT(*)::int AS count,COUNT(*) FILTER(WHERE "priority" IN ('HIGH','URGENT') OR "lastMessageAt"<CURRENT_TIMESTAMP-INTERVAL '24 hours')::int AS urgent FROM "SupportTicket" WHERE "status" IN ('OPEN','PENDING_INTERNAL')`);
   }
   if(allow("FINANCE","SUPPORT")){
    alerts.push(...await tx.$queryRaw<Alert[]>`SELECT 'payments' AS key,COUNT(DISTINCT p."orderId")::int AS count,0 AS urgent FROM "MarketplacePayment" p JOIN "MarketplaceOrder" o ON o.id=p."orderId" WHERE p."status"='FAILED' AND p."updatedAt">=CURRENT_TIMESTAMP-INTERVAL '24 hours' AND o."status"='PENDING_PAYMENT' AND NOT EXISTS(SELECT 1 FROM "MarketplacePayment" n WHERE n."orderId"=p."orderId" AND n."updatedAt">p."updatedAt" AND n."status" IN ('AUTHORIZED','CAPTURED')) UNION ALL SELECT 'disputes',COUNT(*)::int,COUNT(*)::int FROM "MarketplaceDispute" WHERE "status" NOT IN ('RESOLVED_BUYER','RESOLVED_SELLER','CLOSED')`);
   }
   if(allow("MARKETING","SUPPORT")){
    alerts.push(...await tx.$queryRaw<Alert[]>`SELECT 'emails' AS key,COUNT(*)::int AS count,0 AS urgent FROM "NotificationDeliveryOutbox" WHERE "channel"='EMAIL' AND "status"='FAILED' AND "createdAt">=CURRENT_TIMESTAMP-INTERVAL '24 hours'`);
   }
   if(allow("MODERATOR","COMPLIANCE")){
    alerts.push(...await tx.$queryRaw<Alert[]>`SELECT 'risk' AS key,COUNT(*)::int AS count,COUNT(*) FILTER(WHERE p.level='CRITICAL')::int AS urgent FROM "UserRiskProfile" p JOIN "User" u ON u.id=p."userId" WHERE u."status"='ACTIVE' AND p.level IN ('HIGH','CRITICAL')`);
   }
   const actorId=session.userId;
   alerts.push(...await tx.$queryRaw<Alert[]>`SELECT 'task_due' AS key,COUNT(*)::int AS count,COUNT(*) FILTER(WHERE "dueAt"<NOW())::int AS urgent FROM "AdminTask" WHERE status IN ('OPEN','IN_PROGRESS') AND "dueAt"<=NOW()+INTERVAL '1 hour' AND (${allow()} OR "assigneeId"=${actorId})`);
   return alerts;
  },{timeout:10000});
  return reply.header("Cache-Control","no-store").send({alerts:results,total:results.reduce((n,a)=>n+a.count,0),generatedAt:new Date().toISOString()});
 });
}
