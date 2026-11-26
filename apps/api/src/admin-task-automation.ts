import {prisma} from "@pa/database";
import {randomUUID,createHash,timingSafeEqual} from "node:crypto";
import type {FastifyInstance} from "fastify";
import {z} from "zod";
import {requireAdminRoles} from "./rbac.js";
const RULES={
 LISTING_OVERDUE:{title:"Examiner les annonces en attente depuis plus de 24 h",priority:"HIGH",description:"Consultez la file Modération. Aucun statut d’annonce n’a été modifié automatiquement."},
 SUPPORT_URGENT:{title:"Traiter les demandes de support prioritaires",priority:"URGENT",description:"Consultez les tickets ouverts urgents, prioritaires ou sans réponse depuis 24 h."},
 DISPUTE_OPEN:{title:"Examiner les litiges de la marketplace",priority:"URGENT",description:"Consultez les litiges ouverts dans Finance. Aucun remboursement ni paiement automatique."}
} as const;
type Key=keyof typeof RULES;
type Rule={key:Key;enabled:boolean;revision:number;lastRunAt:Date|null;lastCount:number;lastOutcome:string|null};
async function counts(tx:any):Promise<Record<Key,number>>{
 const rows=await tx.$queryRaw`SELECT (SELECT COUNT(*)::int FROM "Listing" WHERE status='PENDING' AND "updatedAt"<NOW()-INTERVAL '24 hours') AS "LISTING_OVERDUE",(SELECT COUNT(*)::int FROM "SupportTicket" WHERE status IN ('OPEN','PENDING_INTERNAL') AND (priority IN ('HIGH','URGENT') OR "lastMessageAt"<NOW()-INTERVAL '24 hours')) AS "SUPPORT_URGENT",(SELECT COUNT(*)::int FROM "MarketplaceDispute" WHERE status NOT IN ('RESOLVED_BUYER','RESOLVED_SELLER','CLOSED')) AS "DISPUTE_OPEN"`;
 return rows[0];
}
export async function sweepTaskRules(){
 return prisma.$transaction(async tx=>{
 await tx.$executeRaw`SET LOCAL statement_timeout='5000ms'`;
 const rules=await tx.$queryRaw<Rule[]>`SELECT * FROM "AdminTaskRule" ORDER BY key FOR UPDATE`;
 const observed=await counts(tx);let created=0;
 for(const rule of rules){
  const n=observed[rule.key]??0;let outcome="DISABLED";
  if(rule.enabled){
   outcome=n===0?"CLEAR":"EXISTING_OR_COOLDOWN";
   if(n>0){
    const def=RULES[rule.key];const id=randomUUID();
    const inserted=await tx.$executeRaw`INSERT INTO "AdminTask" (id,title,description,priority,"dueAt","automationKey") SELECT ${id},${def.title},${def.description},${def.priority},NOW()+INTERVAL '4 hours',${rule.key} WHERE NOT EXISTS(SELECT 1 FROM "AdminTask" WHERE "automationKey"=${rule.key} AND (status IN ('OPEN','IN_PROGRESS') OR "updatedAt">NOW()-INTERVAL '24 hours')) ON CONFLICT DO NOTHING`;
    if(inserted){created++;outcome="CREATED";await tx.$executeRaw`INSERT INTO "AdminAuditEvent" (id,action,"entityType","entityId",metadata) VALUES (${randomUUID()},'ADMIN_TASK_AUTOMATIC_CREATED','ADMIN_TASK',${id},${JSON.stringify({rule:rule.key,count:n,priority:def.priority})}::jsonb)`;}
   }
  }
  await tx.$executeRaw`UPDATE "AdminTaskRule" SET "lastRunAt"=NOW(),"lastCount"=${n},"lastOutcome"=${outcome} WHERE key=${rule.key}`;
 }
 return {created,checked:rules.length};
 },{timeout:15000});
}
export async function registerAdminTaskAutomation(app:FastifyInstance){
 const guard=requireAdminRoles(["SUPER_ADMIN","ADMIN"]);
 app.get("/admin/task-automation",{preHandler:guard},async(_req,reply)=>{
  const [rules,current]=await prisma.$transaction(async tx=>[await tx.$queryRaw<Rule[]>`SELECT * FROM "AdminTaskRule" ORDER BY key`,await counts(tx)] as const,{timeout:10000});
  return reply.header("Cache-Control","private, no-store").send({rules:rules.map(r=>({...r,currentCount:current[r.key]}))});
 });
 app.put("/admin/task-automation/:key",{preHandler:guard},async(req,reply)=>{
  const p=z.object({key:z.enum(["LISTING_OVERDUE","SUPPORT_URGENT","DISPUTE_OPEN"])}).safeParse(req.params);
  const q=z.object({enabled:z.boolean(),revision:z.number().int().positive(),reason:z.string().trim().min(5).max(500)}).safeParse(req.body);
  if(!p.success||!q.success)return reply.code(400).send({error:"invalid_request"});
  const token=req.cookies.pa_session;if(!token)return reply.code(401).send({error:"unauthorized"});
  const actor=await prisma.session.findUnique({where:{tokenHash:createHash("sha256").update(token).digest("hex")},select:{userId:true}});
  if(!actor)return reply.code(401).send({error:"unauthorized"});
  const updated=await prisma.$transaction(async tx=>{
   const changed=await tx.$executeRaw`UPDATE "AdminTaskRule" SET enabled=${q.data.enabled},revision=revision+1 WHERE key=${p.data.key} AND revision=${q.data.revision}`;
   if(!changed)return false;
   await tx.$executeRaw`INSERT INTO "AdminAuditEvent" (id,"actorUserId",action,"entityType","entityId",metadata) VALUES (${randomUUID()},${actor.userId},'ADMIN_TASK_RULE_UPDATED','ADMIN_TASK_RULE',${p.data.key},${JSON.stringify(q.data)}::jsonb)`;return true;
  });
  if(!updated)return reply.code(409).send({error:"settings_changed"});return reply.send({updated:true});
 });
 app.post("/internal/admin-task-automation/sweep",async(req,reply)=>{
  const secret=process.env.INTERNAL_CRON_SECRET,provided=req.headers["x-internal-secret"];
  if(!secret||typeof provided!=="string"||!timingSafeEqual(createHash("sha256").update(secret).digest(),createHash("sha256").update(provided).digest()))return reply.code(401).send({error:"unauthorized"});
  return reply.send(await sweepTaskRules());
 });
}
