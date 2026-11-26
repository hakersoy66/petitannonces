import {prisma} from "@pa/database";
import {createHash} from "node:crypto";
import type {FastifyInstance} from "fastify";
import {z} from "zod";
import {requireAdminRoles} from "./rbac.js";
const roles=["SUPER_ADMIN","ADMIN","MODERATOR","SUPPORT","COMPLIANCE","FINANCE","MARKETING"] as const;
const metric=(key:string,label:string,sql:string,unit="count")=>({key,label,sql,unit});
const groups=[
 {key:"users",label:"Utilisateurs",roles:["SUPPORT","COMPLIANCE","MARKETING"],metrics:[
 metric("registrations","Nouveaux comptes",`(SELECT COUNT(*) FROM "User" WHERE "createdAt">=start_utc AND "createdAt"<end_utc)`),
 metric("professionals","Nouveaux comptes professionnels",`(SELECT COUNT(*) FROM "User" WHERE kind='PROFESSIONNEL' AND "createdAt">=start_utc AND "createdAt"<end_utc)`)]},
 {key:"listings",label:"Annonces",roles:["MODERATOR","SUPPORT","COMPLIANCE","MARKETING"],metrics:[
 metric("createdListings","Annonces créées",`(SELECT COUNT(*) FROM "Listing" WHERE "createdAt">=start_utc AND "createdAt"<end_utc)`),
 metric("publishedListings","Dernière publication enregistrée",`(SELECT COUNT(*) FROM "Listing" WHERE "publishedAt">=start_utc AND "publishedAt"<end_utc)`)]},
 {key:"support",label:"Support",roles:["SUPPORT"],metrics:[
 metric("tickets","Demandes créées",`(SELECT COUNT(*) FROM "SupportTicket" WHERE "createdAt">=start_utc AND "createdAt"<end_utc)`),
 metric("resolved","Dernière résolution enregistrée",`(SELECT COUNT(*) FROM "SupportTicket" WHERE "resolvedAt">=start_utc AND "resolvedAt"<end_utc AND status IN ('RESOLVED','CLOSED'))`)]},
 {key:"finance",label:"Finance",roles:["FINANCE"],metrics:[
 metric("orders","Commandes créées",`(SELECT COUNT(*) FROM "MarketplaceOrder" WHERE "createdAt">=start_utc AND "createdAt"<end_utc)`),
 metric("paidOrders","Commandes payées (statuts retenus)",`(SELECT COUNT(*) FROM "MarketplaceOrder" WHERE "paidAt">=start_utc AND "paidAt"<end_utc AND status IN ('PAID','PROCESSING','SHIPPED','DELIVERED','COMPLETED','DISPUTED','REFUNDED'))`),
 metric("gross","Montant brut des commandes EUR",`(SELECT COALESCE(SUM("totalAmountMinor"),0) FROM "MarketplaceOrder" WHERE currency='EUR' AND "paidAt">=start_utc AND "paidAt"<end_utc AND status IN ('PAID','PROCESSING','SHIPPED','DELIVERED','COMPLETED','DISPUTED','REFUNDED'))`,"EUR_MINOR"),
 metric("commissions","Commissions brutes EUR",`(SELECT COALESCE(SUM("platformCommissionMinor"),0) FROM "MarketplaceOrder" WHERE currency='EUR' AND "paidAt">=start_utc AND "paidAt"<end_utc AND status IN ('PAID','PROCESSING','SHIPPED','DELIVERED','COMPLETED','DISPUTED','REFUNDED'))`,"EUR_MINOR")]},
 {key:"audience",label:"Audience consentie",roles:["MARKETING"],metrics:[
 metric("sessions","Sessions commencées",`(SELECT COUNT(*) FROM "SiteAnalyticsSession" WHERE "startedAt">=start_utc AND "startedAt"<end_utc)`),
 metric("pageViews","Pages vues des sessions commencées",`(SELECT COALESCE(SUM("pageViews"),0) FROM "SiteAnalyticsSession" WHERE "startedAt">=start_utc AND "startedAt"<end_utc)`)]},
 {key:"operations",label:"Administration",roles:[],metrics:[
 metric("audit","Événements administratifs enregistrés",`(SELECT COUNT(*) FROM "AdminAuditEvent" WHERE "createdAt">=start_utc AND "createdAt"<end_utc)`),
 metric("tasksCreated","Tâches créées",`(SELECT COUNT(*) FROM "AdminTask" WHERE "createdAt">=start_utc AT TIME ZONE 'UTC' AND "createdAt"<end_utc AT TIME ZONE 'UTC')`),
 metric("tasksCompleted","Tâches actuellement terminées",`(SELECT COUNT(*) FROM "AdminTask" WHERE status='DONE' AND "completedAt">=start_utc AT TIME ZONE 'UTC' AND "completedAt"<end_utc AT TIME ZONE 'UTC')`)]}
];
export async function readCentralReport(days:number,assigned:string[]){
 if(![1,7,30].includes(days))throw Error("invalid_period");
 const top=assigned.some(r=>["SUPER_ADMIN","ADMIN"].includes(r));
 const visible=groups.filter(g=>top||g.roles.some(r=>assigned.includes(r)));
 if(!visible.length)return {groups:[],current:[],previous:[],timezone:"Europe/Paris",generatedAt:new Date().toISOString()};
 const columns=visible.flatMap(g=>g.metrics).map(m=>m.sql+'::text AS "'+m.key+'"').join(", ");
 // Only constant server-defined SQL expressions enter columns; days remains parameterized.
 const rows=await prisma.$transaction(async tx=>{
 await tx.$executeRaw`SET LOCAL statement_timeout='8000ms'`;
 return tx.$queryRawUnsafe<Array<Record<string,string>>>(`WITH days AS (
 SELECT d::date AS day,((d::date::timestamp AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'UTC') AS start_utc,(((d::date+1)::timestamp AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'UTC') AS end_utc
 FROM generate_series((CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Paris')::date-2*$1::int,(CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Paris')::date-1,INTERVAL '1 day') d
 ) SELECT TO_CHAR(day,'YYYY-MM-DD') AS day,${columns} FROM days ORDER BY day`,days);
 },{timeout:12000});
 return {groups:visible.map(g=>({key:g.key,label:g.label,metrics:g.metrics.map(({key,label,unit})=>({key,label,unit}))})),current:rows.slice(days),previous:rows.slice(0,days),timezone:"Europe/Paris",generatedAt:new Date().toISOString()};
}
export async function registerCentralReports(app:FastifyInstance){
 app.get("/admin/reports/overview",{preHandler:requireAdminRoles([...roles])},async(req,reply)=>{
 const q=z.object({days:z.coerce.number().int().refine(n=>[1,7,30].includes(n)).default(7)}).safeParse(req.query);
 if(!q.success)return reply.code(400).send({error:"invalid_period"});
 const token=req.cookies.pa_session;if(!token)return reply.code(401).send({error:"unauthorized"});
 const session=await prisma.session.findUnique({where:{tokenHash:createHash("sha256").update(token).digest("hex")},select:{user:{select:{roles:{select:{role:true}}}}}});
 if(!session)return reply.code(401).send({error:"unauthorized"});
 return reply.header("Cache-Control","private, no-store").send(await readCentralReport(q.data.days,session.user.roles.map(r=>r.role)));
 });
}
