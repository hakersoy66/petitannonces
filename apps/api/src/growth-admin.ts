import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { ensureSiteCreditSchema } from "./site-credit.js";

const SESSION_COOKIE = "pa_session";
const ROLES = new Set(["SUPER_ADMIN", "ADMIN", "MARKETING", "FINANCE"]);
const CREDIT_ADJUST_ROLES = new Set(["SUPER_ADMIN","ADMIN","FINANCE"]);
const CREDIT_PACKAGE_ROLES = new Set(["SUPER_ADMIN","ADMIN","FINANCE"]);

function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }

async function requireGrowthAdmin(request: FastifyRequest, reply: FastifyReply) {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) { reply.code(401).send({ error: "unauthorized" }); return null; }
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: { include: { roles: true } } } });
  if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== "ACTIVE") { reply.code(401).send({ error: "unauthorized" }); return null; }
  if (!session.user.roles.some((r: { role: string }) => ROLES.has(r.role))) { reply.code(403).send({ error: "forbidden" }); return null; }
  return session.user;
}

export async function registerGrowthAdminRoutes(app: FastifyInstance) {
  app.get("/admin/growth/coupons", async (request, reply) => {
    const admin = await requireGrowthAdmin(request, reply); if (!admin) return;
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT "id","code","type","value","currency","maxRedemptions","redemptions","startsAt","endsAt","isActive","createdAt" FROM "Coupon" ORDER BY "createdAt" DESC LIMIT 100`);
    return reply.send({ coupons: rows });
  });

  app.post("/admin/growth/coupons", async (request, reply) => {
    const admin = await requireGrowthAdmin(request, reply); if (!admin) return;
    const parsed = z.object({
      code: z.string().trim().min(3).max(40).transform((v) => v.toUpperCase()),
      type: z.enum(["PERCENT","FIXED"]),
      value: z.number().int().positive().max(100000),
      currency: z.string().length(3).default("EUR"),
      maxRedemptions: z.number().int().positive().max(1_000_000).optional(),
      startsAt: z.coerce.date().optional(),
      endsAt: z.coerce.date().optional(),
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    if (parsed.data.type === "PERCENT" && parsed.data.value > 100) return reply.code(400).send({ error: "percent_above_100" });
    if (parsed.data.startsAt && parsed.data.endsAt && parsed.data.endsAt <= parsed.data.startsAt) return reply.code(400).send({ error: "invalid_period" });
    try {
      const id = randomUUID();
      await prisma.$executeRawUnsafe(`INSERT INTO "Coupon" ("id","code","type","value","currency","maxRedemptions","startsAt","endsAt") VALUES ($1,$2,$3::"CouponType",$4,$5,$6,$7,$8)`, id, parsed.data.code, parsed.data.type, parsed.data.value, parsed.data.currency.toUpperCase(), parsed.data.maxRedemptions ?? null, parsed.data.startsAt ?? null, parsed.data.endsAt ?? null);
      await prisma.$executeRawUnsafe(`INSERT INTO "GrowthEvent" ("id","userId","eventName","channel","campaign","properties") VALUES ($1,$2,'COUPON_CREATED','ADMIN',$3,$4::jsonb)`, randomUUID(), admin.id, parsed.data.code, JSON.stringify({ type: parsed.data.type, value: parsed.data.value }));
      return reply.code(201).send({ coupon: { id, ...parsed.data, isActive: true } });
    } catch { return reply.code(409).send({ error: "coupon_code_exists" }); }
  });

  app.patch("/admin/growth/coupons/:id", async (request, reply) => {
    const admin = await requireGrowthAdmin(request, reply); if (!admin) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ isActive: z.boolean() }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    await prisma.$executeRawUnsafe(`UPDATE "Coupon" SET "isActive"=$1 WHERE "id"=$2`, body.data.isActive, params.data.id);
    return reply.send({ updated: true });
  });


  app.get("/admin/growth/site-credits", async (request, reply) => {
    const admin = await requireGrowthAdmin(request, reply); if (!admin) return;
    await ensureSiteCreditSchema();
    const q = z.object({ q: z.string().trim().max(120).optional() }).safeParse(request.query);
    if (!q.success) return reply.code(400).send({ error: "invalid_request" });
    const search = q.data.q ?? "";
    const [wallets, summary, recent, packages] = await Promise.all([
      prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
        SELECT u."id" AS "userId",u."email",COALESCE(p."displayName",p."firstName",u."email") AS "name",
               COALESCE(w."balanceMinor",0)::int AS "balanceMinor",COALESCE(w."currency",'EUR') AS "currency",w."updatedAt"
        FROM "User" u
        LEFT JOIN "UserProfile" p ON p."userId"=u."id"
        LEFT JOIN "SiteCreditWallet" w ON w."userId"=u."id"
        WHERE ($1='' OR u."email" ILIKE '%'||$1||'%' OR COALESCE(p."displayName",p."firstName",'') ILIKE '%'||$1||'%')
          AND NOT EXISTS (SELECT 1 FROM "UserAdminRole" r WHERE r."userId"=u."id" AND r."role"='SUPER_ADMIN')
        ORDER BY COALESCE(w."balanceMinor",0) DESC,u."createdAt" DESC LIMIT 100`, search),
      prisma.$queryRawUnsafe<Array<{totalMinor:bigint;wallets:bigint;positiveWallets:bigint}>>(`
        SELECT COALESCE(SUM(w."balanceMinor"),0)::bigint AS "totalMinor",COUNT(*)::bigint AS wallets,
               COUNT(*) FILTER (WHERE w."balanceMinor">0)::bigint AS "positiveWallets"
        FROM "SiteCreditWallet" w
        WHERE NOT EXISTS (SELECT 1 FROM "UserAdminRole" r WHERE r."userId"=w."userId" AND r."role"='SUPER_ADMIN')`),
      prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
        SELECT t."id",t."type",t."amountMinor",t."referenceType",t."createdAt",u."email",
               COALESCE(p."displayName",p."firstName",u."email") AS "name"
        FROM "SiteCreditTransaction" t
        JOIN "SiteCreditWallet" w ON w."id"=t."walletId"
        JOIN "User" u ON u."id"=w."userId"
        LEFT JOIN "UserProfile" p ON p."userId"=u."id"
        WHERE NOT EXISTS (SELECT 1 FROM "UserAdminRole" r WHERE r."userId"=u."id" AND r."role"='SUPER_ADMIN')
        ORDER BY t."createdAt" DESC LIMIT 40`),
      prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT "id","name","description","badge","creditMinor","priceMinor","currency","sortOrder","isActive","updatedAt" FROM "SiteCreditPackage" ORDER BY "sortOrder" ASC,"creditMinor" ASC`)
    ]);
    const roles = admin.roles.map((r:{role:string})=>r.role);
    return reply.send({
      wallets, recent, packages,
      canAdjust: roles.some((role:string)=>CREDIT_ADJUST_ROLES.has(role)),
      canManagePackages: roles.some((role:string)=>CREDIT_PACKAGE_ROLES.has(role)),
      summary:{ totalMinor:Number(summary[0]?.totalMinor??0n), wallets:Number(summary[0]?.wallets??0n), positiveWallets:Number(summary[0]?.positiveWallets??0n) }
    });
  });

  app.post("/admin/growth/site-credit-packages", async (request, reply) => {
    const admin=await requireGrowthAdmin(request,reply);if(!admin)return;
    if(!admin.roles.some((r:{role:string})=>CREDIT_PACKAGE_ROLES.has(r.role)))return reply.code(403).send({error:"forbidden"});
    await ensureSiteCreditSchema();
    const body=z.object({name:z.string().trim().min(2).max(80),description:z.string().trim().max(240).nullable().optional(),badge:z.string().trim().max(40).nullable().optional(),creditMinor:z.number().int().min(100).max(500000),priceMinor:z.number().int().min(100).max(500000),sortOrder:z.number().int().min(0).max(1000).default(100),isActive:z.boolean().default(true)}).safeParse(request.body);
    if(!body.success)return reply.code(400).send({error:"invalid_request",details:body.error.flatten()});
    const id=randomUUID();
    await prisma.$executeRawUnsafe(`INSERT INTO "SiteCreditPackage" ("id","name","description","badge","creditMinor","priceMinor","currency","sortOrder","isActive") VALUES ($1,$2,$3,$4,$5,$6,'EUR',$7,$8)`,id,body.data.name,body.data.description??null,body.data.badge??null,body.data.creditMinor,body.data.priceMinor,body.data.sortOrder,body.data.isActive);
    await prisma.$executeRawUnsafe(`INSERT INTO "AdminAuditEvent" ("id","actorUserId","action","entityType","entityId","metadata") VALUES ($1,$2,'SITE_CREDIT_PACKAGE_CREATED','SITE_CREDIT_PACKAGE',$3,$4::jsonb)`,randomUUID(),admin.id,id,JSON.stringify(body.data));
    return reply.code(201).send({created:true,id});
  });

  app.patch("/admin/growth/site-credit-packages/:id", async (request, reply) => {
    const admin=await requireGrowthAdmin(request,reply);if(!admin)return;
    if(!admin.roles.some((r:{role:string})=>CREDIT_PACKAGE_ROLES.has(r.role)))return reply.code(403).send({error:"forbidden"});
    await ensureSiteCreditSchema();
    const params=z.object({id:z.string().min(1).max(120)}).safeParse(request.params);
    const body=z.object({name:z.string().trim().min(2).max(80),description:z.string().trim().max(240).nullable().optional(),badge:z.string().trim().max(40).nullable().optional(),creditMinor:z.number().int().min(100).max(500000),priceMinor:z.number().int().min(100).max(500000),sortOrder:z.number().int().min(0).max(1000),isActive:z.boolean()}).safeParse(request.body);
    if(!params.success||!body.success)return reply.code(400).send({error:"invalid_request"});
    const changed=await prisma.$queryRawUnsafe<Array<{id:string}>>(`UPDATE "SiteCreditPackage" SET "name"=$2,"description"=$3,"badge"=$4,"creditMinor"=$5,"priceMinor"=$6,"sortOrder"=$7,"isActive"=$8,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 RETURNING "id"`,params.data.id,body.data.name,body.data.description??null,body.data.badge??null,body.data.creditMinor,body.data.priceMinor,body.data.sortOrder,body.data.isActive);
    if(!changed.length)return reply.code(404).send({error:"site_credit_package_not_found"});
    await prisma.$executeRawUnsafe(`INSERT INTO "AdminAuditEvent" ("id","actorUserId","action","entityType","entityId","metadata") VALUES ($1,$2,'SITE_CREDIT_PACKAGE_UPDATED','SITE_CREDIT_PACKAGE',$3,$4::jsonb)`,randomUUID(),admin.id,params.data.id,JSON.stringify(body.data));
    return reply.send({updated:true});
  });

  app.post("/admin/growth/site-credits/adjust", async (request, reply) => {
    const admin = await requireGrowthAdmin(request, reply); if (!admin) return;
    if (!admin.roles.some((r:{role:string})=>CREDIT_ADJUST_ROLES.has(r.role))) return reply.code(403).send({ error:"forbidden" });
    await ensureSiteCreditSchema();
    const body = z.object({
      userId:z.string().min(1),
      amountMinor:z.number().int().min(-50000).max(50000).refine(v=>v!==0),
      reason:z.string().trim().min(3).max(300)
    }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error:"invalid_request", details:body.error.flatten() });
    const target = await prisma.user.findUnique({ where:{id:body.data.userId}, include:{roles:true} });
    if (!target || target.roles.some((r:{role:string})=>r.role==="SUPER_ADMIN")) return reply.code(404).send({ error:"user_not_found" });
    const result = await prisma.$transaction(async(tx:any)=>{
      await tx.$executeRawUnsafe(`INSERT INTO "SiteCreditWallet" ("id","userId") VALUES ($1,$2) ON CONFLICT ("userId") DO NOTHING`,randomUUID(),target.id);
      const rows = await tx.$queryRawUnsafe(`SELECT "id","balanceMinor" FROM "SiteCreditWallet" WHERE "userId"=$1 FOR UPDATE`,target.id) as Array<{id:string;balanceMinor:number}>;
      const wallet=rows[0]; if(!wallet) throw new Error("wallet_unavailable");
      const next=Number(wallet.balanceMinor)+body.data.amountMinor; if(next<0) throw new Error("insufficient_site_credit");
      const referenceId=randomUUID();
      await tx.$executeRawUnsafe(`UPDATE "SiteCreditWallet" SET "balanceMinor"=$2,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,wallet.id,next);
      await tx.$executeRawUnsafe(`INSERT INTO "SiteCreditTransaction" ("id","walletId","type","amountMinor","referenceType","referenceId","metadata") VALUES ($1,$2,'ADJUSTMENT',$3,'ADMIN_ADJUSTMENT',$4,$5::jsonb)`,randomUUID(),wallet.id,body.data.amountMinor,referenceId,JSON.stringify({reason:body.data.reason,actorUserId:admin.id}));
      await tx.$executeRawUnsafe(`INSERT INTO "AdminAuditEvent" ("id","actorUserId","action","entityType","entityId","metadata") VALUES ($1,$2,'SITE_CREDIT_ADJUSTED','USER',$3,$4::jsonb)`,randomUUID(),admin.id,target.id,JSON.stringify({amountMinor:body.data.amountMinor,balanceMinor:next,reason:body.data.reason}));
      await tx.$executeRawUnsafe(`INSERT INTO "UserNotification" ("id","userId","kind","title","body","actionUrl","metadata") VALUES ($1,$2,'SYSTEM',$3,$4,$5,$6::jsonb)`,randomUUID(),target.id,"Mise à jour de votre crédit Petit Annonces",body.data.amountMinor>0?`${(body.data.amountMinor/100).toFixed(2).replace('.',',')} € ont été ajoutés à votre crédit Petit Annonces.`:`${Math.abs(body.data.amountMinor/100).toFixed(2).replace('.',',')} € ont été retirés de votre crédit Petit Annonces.`,"/mon-compte/portefeuille",JSON.stringify({amountMinor:body.data.amountMinor,reason:body.data.reason}));
      return {balanceMinor:next};
    }).catch((error:any)=>{ if(error instanceof Error&&error.message==="insufficient_site_credit") return null; throw error; });
    if(!result) return reply.code(409).send({ error:"insufficient_site_credit" });
    return reply.send({ adjusted:true, amountMinor:body.data.amountMinor, balanceMinor:result.balanceMinor, currency:"EUR" });
  });

  app.post("/admin/growth/referrals/:id/qualify", async (_request, reply) => reply.code(410).send({ error: "referral_rewards_disabled" }));

  app.get("/admin/growth/wallets", async (_request, reply) => reply.code(410).send({ error: "pa_credits_disabled" }));
  app.post("/admin/growth/credits/adjust", async (_request, reply) => reply.code(410).send({ error: "pa_credits_disabled" }));
  app.post("/internal/growth/grant-professional-credits", async (_request, reply) => reply.send({ disabled:true, grantedUsers:0, credits:0 }));
}
