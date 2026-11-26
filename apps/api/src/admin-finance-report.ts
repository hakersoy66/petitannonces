import {prisma} from "@pa/database";
import {z} from "zod";
import type {FastifyInstance} from "fastify";
import {requireAdminRoles} from "./rbac.js";
export async function registerAdminFinanceReportRoutes(app:FastifyInstance){
 app.get("/admin/finance/report",{preHandler:requireAdminRoles(["SUPER_ADMIN","ADMIN","FINANCE","SUPPORT"])},async(request,reply)=>{
 const q=z.object({days:z.coerce.number().int().refine(n=>[7,30,90,365].includes(n)).default(30)}).safeParse(request.query);
 if(!q.success)return reply.code(400).send({error:"invalid_period"});
 const days=q.data.days;
 const [summary,commissions,payouts]=await prisma.$transaction(async tx=>{
 await tx.$executeRaw`SET LOCAL statement_timeout='8000ms'`;
 return Promise.all([
 tx.$queryRaw<Array<Record<string,unknown>>>`WITH bounds AS (SELECT (((CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Paris')::date-(${days}::int-1))::timestamp AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'UTC' AS start_utc), paid AS (SELECT o.* FROM "MarketplaceOrder" o,bounds b WHERE o."paidAt">=b.start_utc AND o."paidAt"<=CURRENT_TIMESTAMP AT TIME ZONE 'UTC' AND o."status" IN ('PAID','PROCESSING','SHIPPED','DELIVERED','COMPLETED','DISPUTED','REFUNDED')), refunds AS (SELECT r.* FROM "MarketplaceRefund" r,bounds b WHERE r."status"='SUCCEEDED' AND r."updatedAt">=b.start_utc)
 SELECT currency,SUM("paidOrders")::int AS "paidOrders",SUM("grossMinor")::text AS "grossMinor",SUM("commissionMinor")::text AS "commissionMinor",SUM("refundMinor")::text AS "refundMinor",SUM("refundCount")::int AS "refundCount" FROM (
 SELECT currency,COUNT(*)::int AS "paidOrders",SUM("totalAmountMinor") AS "grossMinor",SUM("platformCommissionMinor") AS "commissionMinor",0::bigint AS "refundMinor",0 AS "refundCount" FROM paid GROUP BY currency
 UNION ALL SELECT currency,0,0,0,SUM("amountMinor"),COUNT(*)::int FROM refunds GROUP BY currency) x GROUP BY currency ORDER BY currency`,
 tx.$queryRaw<Array<Record<string,unknown>>>`SELECT currency,"commissionRateBps","commissionPayer",COUNT(*)::int AS orders,SUM("platformCommissionMinor")::text AS "commissionMinor",SUM("itemAmountMinor")::text AS "itemMinor" FROM "MarketplaceOrder" WHERE "paidAt">=((((CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Paris')::date-(${days}::int-1))::timestamp AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'UTC') AND "paidAt"<=CURRENT_TIMESTAMP AT TIME ZONE 'UTC' AND "status" IN ('PAID','PROCESSING','SHIPPED','DELIVERED','COMPLETED','DISPUTED','REFUNDED') GROUP BY currency,"commissionRateBps","commissionPayer" ORDER BY currency,"commissionRateBps","commissionPayer"`,
 tx.$queryRaw<Array<Record<string,unknown>>>`SELECT currency,status::text AS status,COUNT(*)::int AS count,COALESCE(SUM("amountMinor"),0)::text AS "amountMinor" FROM "MarketplacePayout" WHERE status IN ('PENDING','BLOCKED','PROCESSING','FAILED') GROUP BY currency,status ORDER BY currency,status`
 ]);
 },{timeout:12000});
 return reply.header("Cache-Control","no-store").send({days,summary,commissions,payouts,timezone:"Europe/Paris",generatedAt:new Date().toISOString()});
 });
 app.get("/admin/finance/wallets",{preHandler:requireAdminRoles(["SUPER_ADMIN","ADMIN","FINANCE"])},async(request,reply)=>{
 const q=z.object({q:z.string().trim().max(120).default("")}).safeParse(request.query);if(!q.success)return reply.code(400).send({error:"invalid_request"});
 const search=q.data.q;
 const [wallets,summary]=await prisma.$transaction(async tx=>{await tx.$executeRaw`SET LOCAL statement_timeout='5000ms'`;return Promise.all([
 tx.$queryRaw<Array<Record<string,unknown>>>`SELECT w."userId",u.email,COALESCE(p."displayName",p."firstName",u.email) AS name,w."balanceMinor",w.currency,w."updatedAt" FROM "SiteCreditWallet" w JOIN "User" u ON u.id=w."userId" LEFT JOIN "UserProfile" p ON p."userId"=u.id WHERE NOT EXISTS(SELECT 1 FROM "UserAdminRole" r WHERE r."userId"=u.id AND r.role='SUPER_ADMIN') AND (${search}='' OR u.email ILIKE '%'||${search}||'%' OR COALESCE(p."displayName",p."firstName",'') ILIKE '%'||${search}||'%') ORDER BY w."balanceMinor" DESC,w."updatedAt" DESC LIMIT 100`,
 tx.$queryRaw<Array<{currency:string;totalMinor:string;wallets:number;positiveWallets:number}>>`SELECT w.currency,COALESCE(SUM(w."balanceMinor"),0)::text AS "totalMinor",COUNT(*)::int AS wallets,COUNT(*) FILTER(WHERE w."balanceMinor">0)::int AS "positiveWallets" FROM "SiteCreditWallet" w WHERE NOT EXISTS(SELECT 1 FROM "UserAdminRole" r WHERE r."userId"=w."userId" AND r.role='SUPER_ADMIN') GROUP BY w.currency ORDER BY w.currency`
 ]);},{timeout:10000});
 return reply.header("Cache-Control","no-store").send({wallets,summary});
 });
 app.get("/admin/finance/wallets/:userId/history",{preHandler:requireAdminRoles(["SUPER_ADMIN","ADMIN","FINANCE"])},async(request,reply)=>{
 const p=z.object({userId:z.string().min(1).max(128)}).safeParse(request.params);if(!p.success)return reply.code(400).send({error:"invalid_request"});
 const rows=await prisma.$queryRaw<Array<{id:string;balanceMinor:number;currency:string}>>`SELECT w.id,w."balanceMinor",w.currency FROM "SiteCreditWallet" w WHERE w."userId"=${p.data.userId} AND NOT EXISTS(SELECT 1 FROM "UserAdminRole" r WHERE r."userId"=w."userId" AND r.role='SUPER_ADMIN') LIMIT 1`;
 if(!rows[0])return reply.code(404).send({error:"wallet_not_found"});
 const transactions=await prisma.$queryRaw<Array<Record<string,unknown>>>`SELECT id,type,"amountMinor","referenceType","createdAt" FROM "SiteCreditTransaction" WHERE "walletId"=${rows[0].id} ORDER BY "createdAt" DESC,id LIMIT 100`;
 return reply.header("Cache-Control","no-store").send({wallet:{balanceMinor:rows[0].balanceMinor,currency:rows[0].currency},transactions});
 });
}
