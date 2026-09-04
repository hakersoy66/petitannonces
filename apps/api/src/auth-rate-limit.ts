import { createHash } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyReply, FastifyRequest } from "fastify";

function sha256(value:string){return createHash("sha256").update(value).digest("hex")}
function clientIp(request:FastifyRequest){const forwarded=request.headers["x-forwarded-for"];const first=Array.isArray(forwarded)?forwarded[0]:forwarded?.split(",")[0];return (first?.trim()||request.ip||"unknown").slice(0,120)}

export async function enforceAuthRateLimit(args:{request:FastifyRequest;reply:FastifyReply;action:string;identity?:string;limit:number;windowMs:number;blockMs?:number}){
  const keyHash=sha256(`${clientIp(args.request)}|${(args.identity??"").trim().toLowerCase()}`);
  const now=new Date();
  const rows=await prisma.$queryRawUnsafe<Array<{count:number;windowStartedAt:Date;blockedUntil:Date|null}>>(`SELECT "count","windowStartedAt","blockedUntil" FROM "AuthRateLimit" WHERE "action"=$1 AND "keyHash"=$2 LIMIT 1`,args.action,keyHash);
  const row=rows[0];
  if(row?.blockedUntil&&row.blockedUntil>now){const retryAfter=Math.max(1,Math.ceil((row.blockedUntil.getTime()-Date.now())/1000));args.reply.header("Retry-After",String(retryAfter)).code(429).send({error:"rate_limited",retryAfterSeconds:retryAfter});return false}
  const windowExpired=!row||now.getTime()-new Date(row.windowStartedAt).getTime()>=args.windowMs;
  const nextCount=windowExpired?1:(row.count+1);
  const blockedUntil=nextCount>args.limit?new Date(Date.now()+(args.blockMs??args.windowMs)):null;
  if(!row){await prisma.$executeRawUnsafe(`INSERT INTO "AuthRateLimit" ("action","keyHash","count","windowStartedAt","blockedUntil","updatedAt") VALUES ($1,$2,$3,CURRENT_TIMESTAMP,$4,CURRENT_TIMESTAMP)`,args.action,keyHash,nextCount,blockedUntil)}
  else if(windowExpired){await prisma.$executeRawUnsafe(`UPDATE "AuthRateLimit" SET "count"=1,"windowStartedAt"=CURRENT_TIMESTAMP,"blockedUntil"=NULL,"updatedAt"=CURRENT_TIMESTAMP WHERE "action"=$1 AND "keyHash"=$2`,args.action,keyHash)}
  else{await prisma.$executeRawUnsafe(`UPDATE "AuthRateLimit" SET "count"=$3,"blockedUntil"=$4,"updatedAt"=CURRENT_TIMESTAMP WHERE "action"=$1 AND "keyHash"=$2`,args.action,keyHash,nextCount,blockedUntil)}
  if(blockedUntil){const retryAfter=Math.max(1,Math.ceil((blockedUntil.getTime()-Date.now())/1000));args.reply.header("Retry-After",String(retryAfter)).code(429).send({error:"rate_limited",retryAfterSeconds:retryAfter});return false}
  return true
}

export async function clearAuthRateLimit(action:string,request:FastifyRequest,identity?:string){const keyHash=sha256(`${clientIp(request)}|${(identity??"").trim().toLowerCase()}`);await prisma.$executeRawUnsafe(`DELETE FROM "AuthRateLimit" WHERE "action"=$1 AND "keyHash"=$2`,action,keyHash)}
