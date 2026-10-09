import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { lookupPublicCompany } from "./company-registry.js";
import { saveSensitiveEvidence, downloadSensitiveEvidence, removeSensitiveEvidence } from "./private-evidence.js";
import { getProReverificationState } from "./pro-reverification.js";

const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" } as const;
type EvidenceMime = keyof typeof TYPES;
type DocumentRow = { id:string; userId:string; kind:string; objectKey:string; mimeType:string; fileName:string; applicantRole:string; applicantName:string; createdAt:Date };
const hash = (value:string) => createHash("sha256").update(value).digest("hex");

export async function ensureProfessionalVerificationSchema() {
  await prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS "ProVerificationDocument" ("id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE, "kind" TEXT NOT NULL, "objectKey" TEXT NOT NULL UNIQUE, "mimeType" TEXT NOT NULL, "fileName" TEXT NOT NULL, "applicantRole" TEXT NOT NULL, "applicantName" TEXT NOT NULL, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "ProVerificationDocument_kind_check" CHECK ("kind" IN (\'REGISTRY\',\'AUTHORITY\')))');
  await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "ProVerificationDocument_user_idx" ON "ProVerificationDocument"("userId","createdAt" DESC)');
}

async function sessionUser(req:FastifyRequest, reply:FastifyReply) {
  const bearer = /^Bearer\s+([A-Za-z0-9_-]{20,300})$/i.exec(String(req.headers.authorization ?? ""))?.[1];
  const token = bearer ?? req.cookies.pa_session;
  if (!token) { reply.code(401).send({error:"unauthorized"}); return null; }
  const session = await prisma.session.findUnique({where:{tokenHash:hash(token)},include:{user:{include:{roles:true}}}});
  if (!session || session.revokedAt || session.expiresAt<=new Date() || session.user.status!=="ACTIVE") {reply.code(401).send({error:"unauthorized"});return null;}
  return session.user;
}
async function admin(req:FastifyRequest,reply:FastifyReply) {
  const u=await sessionUser(req,reply);if(!u)return null;
  if(!u.roles.some(r=>["SUPER_ADMIN","ADMIN","COMPLIANCE"].includes(r.role))) {reply.code(403).send({error:"forbidden"});return null;}
  return u;
}
function matchesMime(bytes:Buffer,mime:EvidenceMime) {
  if(mime==="application/pdf") return bytes.subarray(0,5).toString("ascii")==="%PDF-";
  if(mime==="image/jpeg") return bytes[0]===0xff && bytes[1]===0xd8 && bytes[2]===0xff;
  return bytes.subarray(0,8).equals(Buffer.from("89504e470d0a1a0a","hex"));
}
async function documents(userId:string) {
  return prisma.$queryRawUnsafe<DocumentRow[]>('SELECT "id","userId","kind","objectKey","mimeType","fileName","applicantRole","applicantName","createdAt" FROM "ProVerificationDocument" WHERE "userId"=$1 ORDER BY "createdAt" DESC',userId);
}
const publicDoc = (d:DocumentRow) => ({id:d.id,kind:d.kind,fileName:d.fileName,applicantRole:d.applicantRole,applicantName:d.applicantName,createdAt:d.createdAt});
const idSchema=z.object({id:z.string().min(1).max(120)});
export async function registerProfessionalVerificationRoutes(app:FastifyInstance) {
  await ensureProfessionalVerificationSchema();
  if (!app.hasContentTypeParser("application/vnd.petitannonces.pro-document"))
    app.addContentTypeParser("application/vnd.petitannonces.pro-document",{parseAs:"buffer",bodyLimit:MAX_BYTES},(_req,body,done)=>done(null,body));

  app.get("/pro/business/verification",async(req,reply)=>{
    const u=await sessionUser(req,reply);if(!u)return;
    const b=await prisma.businessProfile.findUnique({where:{userId:u.id},select:{verificationStatus:true,legalName:true,siret:true,siren:true}});
    return reply.send({business:b,documents:(await documents(u.id)).map(publicDoc),requirements:["REGISTRY","AUTHORITY"],reverification:await getProReverificationState(u.id)});
  });

  app.post("/pro/business/verification/documents",{bodyLimit:MAX_BYTES},async(req,reply)=>{
    const u=await sessionUser(req,reply);if(!u)return;
    if(u.kind!=="PROFESSIONNEL")return reply.code(403).send({error:"professional_account_required"});
    const b=await prisma.businessProfile.findUnique({where:{userId:u.id},select:{id:true,verificationStatus:true}});
    if(!b)return reply.code(404).send({error:"business_not_found"});
    if(b.verificationStatus==="VERIFIED"||b.verificationStatus==="SUSPENDED")return reply.code(409).send({error:"verification_locked"});
    const fields=z.object({
      kind:z.enum(["REGISTRY","AUTHORITY"]),
      role:z.enum(["LEGAL_REPRESENTATIVE","AUTHORIZED_EMPLOYEE"]),
      name:z.string().trim().min(4).max(120),
      mime:z.enum(["application/pdf","image/jpeg","image/png"]),
    }).safeParse({kind:req.headers["x-document-kind"],role:req.headers["x-applicant-role"],name:typeof req.headers["x-applicant-name"]==="string"?decodeURIComponent(req.headers["x-applicant-name"]):undefined,mime:req.headers["x-document-mime"]});
    if(!fields.success)return reply.code(400).send({error:"invalid_document_details"});
    const bytes=req.body;
    if(!Buffer.isBuffer(bytes)||bytes.length<100||bytes.length>MAX_BYTES||!matchesMime(bytes,fields.data.mime))
      return reply.code(415).send({error:"invalid_document_file"});
    const recent=await documents(u.id);
    if(recent.length>=8)return reply.code(429).send({error:"document_limit_reached"});
    const id=randomUUID();
    const ext=TYPES[fields.data.mime];
    const objectKey="private/pro-business/"+u.id+"/"+id+"."+ext;
    try {
      await saveSensitiveEvidence(objectKey,bytes);
      await prisma.$executeRawUnsafe('INSERT INTO "ProVerificationDocument" ("id","userId","kind","objectKey","mimeType","fileName","applicantRole","applicantName") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',id,u.id,fields.data.kind,objectKey,fields.data.mime,fields.data.kind.toLowerCase()+"-"+id.slice(0,8)+"."+ext,fields.data.role,fields.data.name);
      await prisma.businessProfile.update({where:{userId:u.id},data:{verificationStatus:"PENDING",verifiedAt:null}});
    }catch(err){await removeSensitiveEvidence(objectKey).catch(()=>undefined);req.log.error(err);return reply.code(500).send({error:"document_upload_failed"});}
    return reply.code(201).send({uploaded:true,documents:(await documents(u.id)).map(publicDoc),status:"PENDING"});
  });

  app.get("/admin/professionals/:id/verification",async(req,reply)=>{
    const a=await admin(req,reply);if(!a)return;
    const params=idSchema.safeParse(req.params);if(!params.success)return reply.code(400).send({error:"invalid_request"});
    const business=await prisma.businessProfile.findUnique({where:{userId:params.data.id},select:{verificationStatus:true,siret:true,siren:true,legalName:true,lastRegistryCheckAt:true}});
    if(!business)return reply.code(404).send({error:"business_not_found"});
    return reply.send({business,documents:(await documents(params.data.id)).map(publicDoc),reverification:await getProReverificationState(params.data.id)});
  });

  app.get("/admin/professionals/:id/verification/documents/:documentId",async(req,reply)=>{
    const a=await admin(req,reply);if(!a)return;
    const params=z.object({id:z.string().min(1),documentId:z.string().uuid()}).safeParse(req.params);
    if(!params.success)return reply.code(400).send({error:"invalid_request"});
    const rows=await prisma.$queryRawUnsafe<DocumentRow[]>('SELECT * FROM "ProVerificationDocument" WHERE "id"=$1 AND "userId"=$2 LIMIT 1',params.data.documentId,params.data.id);
    if(!rows[0])return reply.code(404).send({error:"document_not_found"});
    await prisma.$executeRawUnsafe('INSERT INTO "AdminAuditEvent" ("id","actorUserId","action","entityType","entityId","metadata") VALUES ($1,$2,$3,$4,$5,$6::jsonb)',randomUUID(),a.id,"PRO_VERIFICATION_DOCUMENT_VIEW","USER",params.data.id,JSON.stringify({documentId:params.data.documentId}));
    return downloadSensitiveEvidence(reply,rows[0].objectKey,rows[0].fileName);
  });

  app.post("/admin/professionals/:id/verification/decision",async(req,reply)=>{
    const a=await admin(req,reply);if(!a)return;
    const params=idSchema.safeParse(req.params);
    const body=z.object({decision:z.enum(["APPROVE","REJECT"]),reason:z.string().trim().min(10).max(500)}).safeParse(req.body);
    if(!params.success||!body.success)return reply.code(400).send({error:"invalid_request"});
    const business=await prisma.businessProfile.findUnique({where:{userId:params.data.id}});
    if(!business)return reply.code(404).send({error:"business_not_found"});
    if(business.verificationStatus==="SUSPENDED")return reply.code(409).send({error:"account_suspended"});
    const rows=await documents(params.data.id);
    if(body.data.decision==="APPROVE"){
      if(!rows.some(d=>d.kind==="REGISTRY")||!rows.some(d=>d.kind==="AUTHORITY"))
        return reply.code(409).send({error:"required_documents_missing"});
      const roles=new Set(rows.map(d=>d.applicantRole));
      const names=new Set(rows.map(d=>d.applicantName.trim().toLocaleLowerCase("fr-FR")));
      if(roles.size!==1||names.size!==1)return reply.code(409).send({error:"applicant_identity_mismatch"});
      let current;
      try{current=await lookupPublicCompany(business.siret??business.siren??"");}catch{return reply.code(502).send({error:"registry_unavailable"});}
      if(!current||current.active===false||current.siren!==(business.siren??business.siret?.slice(0,9)))
        return reply.code(409).send({error:"registry_check_failed"});
    }
    const approved=body.data.decision==="APPROVE";
    await prisma.$transaction(async tx=>{
      await tx.businessProfile.update({where:{id:business.id},data:{verificationStatus:approved?"VERIFIED":"REJECTED",verifiedAt:approved?new Date():null,verificationProvider:approved?"manual_authority_and_registry":business.verificationProvider,lastRegistryCheckAt:approved?new Date():business.lastRegistryCheckAt}});
      if(approved){await tx.store.updateMany({where:{ownerId:params.data.id,status:"DRAFT"},data:{status:"ACTIVE",isVerified:true,publishedAt:new Date()}});await tx.store.updateMany({where:{ownerId:params.data.id,status:"ACTIVE"},data:{isVerified:true}});}
      else await tx.store.updateMany({where:{ownerId:params.data.id,status:"ACTIVE"},data:{status:"SUSPENDED",isVerified:false}});
      await tx.$executeRawUnsafe('UPDATE "ProReverification" SET "status"=$2,"completedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "userId"=$1',params.data.id,approved?"APPROVED":"REJECTED");
      await tx.$executeRawUnsafe('INSERT INTO "AdminAuditEvent" ("id","actorUserId","action","entityType","entityId","metadata") VALUES ($1,$2,$3,$4,$5,$6::jsonb)',randomUUID(),a.id,approved?"PRO_BUSINESS_APPROVED":"PRO_BUSINESS_REJECTED","USER",params.data.id,JSON.stringify({reason:body.data.reason,documentIds:rows.map(r=>r.id),previousStatus:business.verificationStatus}));
    });
    // Identity evidence is short lived: remove bytes after decision. Audit metadata remains.
    for(const doc of rows)await removeSensitiveEvidence(doc.objectKey).catch(err=>req.log.error(err));
    await prisma.$executeRawUnsafe('DELETE FROM "ProVerificationDocument" WHERE "userId"=$1',params.data.id);
    return reply.send({ok:true,status:approved?"VERIFIED":"REJECTED"});
  });
}
