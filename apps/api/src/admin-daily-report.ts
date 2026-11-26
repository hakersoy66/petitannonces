import {prisma} from "@pa/database";
import type {FastifyInstance} from "fastify";
import {requireAdminRoles} from "./rbac.js";
export async function registerAdminDailyReportRoutes(app:FastifyInstance){
 app.get("/admin/dashboard/daily-report",{preHandler:requireAdminRoles(["SUPER_ADMIN","ADMIN"])},async(_request,reply)=>{
 const rows=await prisma.$transaction(async tx=>{
  await tx.$executeRaw`SET LOCAL statement_timeout='8000ms'`;
  return tx.$queryRaw<Array<{day:string;newUsers:number;newListings:number;publishedListings:number;newTickets:number;newOrders:number;paidOrders:number;paidOrderValueMinor:string;paidCommissionMinor:string}>>`
  WITH days AS (
   SELECT d::date AS day, ((d::date::timestamp AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'UTC') AS start_utc,
   (((d::date+1)::timestamp AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'UTC') AS end_utc
   FROM generate_series((CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Paris')::date-6,(CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Paris')::date,INTERVAL '1 day') d
  )
  SELECT TO_CHAR(day,'YYYY-MM-DD') AS day,
   (SELECT COUNT(*)::int FROM "User" WHERE "createdAt">=start_utc AND "createdAt"<end_utc) AS "newUsers",
   (SELECT COUNT(*)::int FROM "Listing" WHERE "createdAt">=start_utc AND "createdAt"<end_utc) AS "newListings",
   (SELECT COUNT(*)::int FROM "Listing" WHERE "publishedAt">=start_utc AND "publishedAt"<end_utc) AS "publishedListings",
   (SELECT COUNT(*)::int FROM "SupportTicket" WHERE "createdAt">=start_utc AND "createdAt"<end_utc) AS "newTickets",
   (SELECT COUNT(*)::int FROM "MarketplaceOrder" WHERE "createdAt">=start_utc AND "createdAt"<end_utc) AS "newOrders",
   (SELECT COUNT(*)::int FROM "MarketplaceOrder" WHERE "paidAt">=start_utc AND "paidAt"<end_utc AND "status" IN ('PAID','PROCESSING','SHIPPED','DELIVERED','COMPLETED','DISPUTED','REFUNDED')) AS "paidOrders",
   (SELECT COALESCE(SUM("totalAmountMinor"),0)::text FROM "MarketplaceOrder" WHERE "paidAt">=start_utc AND "paidAt"<end_utc AND "currency"='EUR' AND "status" IN ('PAID','PROCESSING','SHIPPED','DELIVERED','COMPLETED','DISPUTED','REFUNDED')) AS "paidOrderValueMinor",
   (SELECT COALESCE(SUM("platformCommissionMinor"),0)::text FROM "MarketplaceOrder" WHERE "paidAt">=start_utc AND "paidAt"<end_utc AND "currency"='EUR' AND "status" IN ('PAID','PROCESSING','SHIPPED','DELIVERED','COMPLETED','DISPUTED','REFUNDED')) AS "paidCommissionMinor"
   FROM days ORDER BY day`;
 },{timeout:12000});
 return reply.header("Cache-Control","no-store").send({days:rows,timezone:"Europe/Paris",generatedAt:new Date().toISOString()});
 });
}
