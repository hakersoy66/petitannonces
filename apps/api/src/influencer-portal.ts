import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '@pa/database';
import { z } from 'zod';
import { requireAdminRoles } from './rbac.js';
import { sendHostingerSmtpOnly } from './email-provider.js';
import { queueAdminRoleEmail } from './transactional-email.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const PRIVATE_ROOT='/var/www/petitannonces/shared/private/influencer-evidence';
function safeStoredPath(key:string){
 if(!/^[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.(?:png|jpg|webp|pdf)$/.test(key))throw new Error('invalid_private_key');
 const result=resolve(PRIVATE_ROOT,key);if(!result.startsWith(PRIVATE_ROOT+'/'))throw new Error('invalid_private_key');return result;
}
async function savePrivateProof(key:string,body:Buffer){
 const dest=safeStoredPath(key);await mkdir(resolve(dest,'..'),{recursive:true,mode:0o700});await writeFile(dest,body,{mode:0o600,flag:'wx'});
}
async function sendPrivateProof(reply:FastifyReply,key:string,fileName:string){
 const bytes=await readFile(safeStoredPath(key));const name=fileName.replace(/[^a-zA-Z0-9_.-]/g,'_').slice(0,100);
 reply.header('Content-Type','application/octet-stream');reply.header('X-Content-Type-Options','nosniff');reply.header('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(name)}`);reply.header('Cache-Control','private, no-store');return reply.send(bytes);
}


type R=Record<string,unknown>;
const admin=requireAdminRoles(['SUPER_ADMIN','ADMIN','MARKETING']);
const digest=(v:string)=>createHash('sha256').update(v).digest('hex');
const email=z.string().trim().toLowerCase().email().max(180);
const uuid=z.string().uuid();
const money=z.number().int().min(0).max(100000000);
const link=z.string().url().max(1000).refine(s=>s.startsWith('https://'));
const safe=(r:R)=>Object.fromEntries(Object.entries(r).filter(([key])=>!['tokenHash','codeHash','consentIpHash','signedDocumentKey'].includes(key)).map(([key,v])=>[key,typeof v==='bigint'?Number(v):v]));
const notifyAdmin=async(eventKind:string,title:string,body:string,id:string)=>{try{await queueAdminRoleEmail({roles:['SUPER_ADMIN','ADMIN','MARKETING'],eventKind,title,body,actionUrl:'https://admin.petitannonces.fr/influenceurs',metadata:{campaignId:id}})}catch(error){console.error('influencer_email_queue_error',error)}};
function sameOrigin(req:FastifyRequest,reply:FastifyReply){const origin=req.headers.origin;if(origin!=='https://petitannonces.fr' && !(process.env.NODE_ENV!=='production'&&/^http:\/\/(?:localhost|127\.0\.0\.1):3000$/.test(origin??''))){reply.code(403).send({error:'invalid_origin'});return false;}return true;}
const counters=new Map<string,{until:number,count:number}>();
function throttled(k:string,max:number,window=3600000){const now=Date.now();if(counters.size>4000){for(const [key,v] of counters){if(v.until<now)counters.delete(key);}}const x=counters.get(k);if(!x||x.until<now){counters.set(k,{count:1,until:now+window});return false;}x.count++;return x.count>max;}
function cookie(reply:FastifyReply,value:string,maxAge:number){reply.setCookie('pa_partner_session',value,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge});}
async function portalPartner(req:FastifyRequest){const token=req.cookies?.pa_partner_session??'';if(!/^[a-f0-9]{64}$/.test(token))return null;
 const rows=await prisma.$queryRawUnsafe<R[]>(`SELECT p."id",p."handle",p."platform",p."email",p."status" FROM "InfluencerPortalSession" s JOIN "InfluencerPartner" p ON p."id"=s."partnerId" WHERE s."tokenHash"=$1 AND s."expiresAt">NOW() AND s."revokedAt" IS NULL AND p."status"<>'ARCHIVED' LIMIT 1`,digest(token));return rows[0]??null;}
const requirePortal=async(req:FastifyRequest,reply:FastifyReply)=>{const p=await portalPartner(req);if(!p)return reply.code(401).send({error:'connexion_requise'});(req as FastifyRequest&{portal?:R}).portal=p};
function self(req:FastifyRequest){return (req as FastifyRequest&{portal?:R}).portal!;}
async function audit(campaignId:string,partnerId:string,action:string,actorKind:'ADMIN'|'PARTNER',details:Record<string,unknown>={}){await prisma.$executeRawUnsafe(`INSERT INTO "InfluencerAuditEvent"("campaignId","partnerId","action","actorKind","details")VALUES($1,$2,$3,$4,$5::jsonb)`,campaignId,partnerId,action,actorKind,JSON.stringify(details));}
function mailText(value:string){return value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c));}
async function mailPartner(to:string,subject:string,body:string){await sendHostingerSmtpOnly({to,subject,text:body,html:`<html><body style="background:#f5f4fa;font-family:Arial,sans-serif;padding:32px"><div style="max-width:560px;margin:auto;background:white;border-radius:16px;padding:30px"><h2 style="color:#5b4cf0">Petit Annonces · Partenariats</h2><h3>${mailText(subject)}</h3><p style="white-space:pre-line;line-height:1.7">${mailText(body)}</p><hr><small>Ce message concerne votre partenariat Petit Annonces. Ne partagez jamais vos codes de connexion.</small></div></body></html>`});}
const noStore=(reply:FastifyReply)=>reply.header('Cache-Control','private, no-store, max-age=0');
const emailReply={message:'Si ce courriel correspond à un partenaire actif, un code vous sera envoyé.'};
const id=z.object({id:uuid});
export async function registerInfluencerPortalRoutes(app:FastifyInstance){
 app.post('/partners/portal/login/request',async(req,reply)=>{
  noStore(reply);if(!sameOrigin(req,reply))return;
  const x=z.object({email}).safeParse(req.body);if(!x.success)return reply.code(400).send({error:'invalid_email'});
  if(throttled('login-ip:'+req.ip,12)||throttled('login-email:'+digest(x.data.email),3))return reply.code(429).send({error:'trop_de_tentatives'});
  const partners=await prisma.$queryRawUnsafe<R[]>(`SELECT "id","email" FROM "InfluencerPartner" WHERE lower("email")=$1 AND "status"<>'ARCHIVED' LIMIT 1`,x.data.email);
  if(!partners.length)return reply.code(202).send(emailReply);
  const prior=await prisma.$queryRawUnsafe<R[]>(`SELECT COUNT(*)::int AS n FROM "InfluencerAccessCode" WHERE "partnerId"=$1 AND "createdAt">NOW()-INTERVAL '1 hour'`,partners[0]?.id);
  if(Number(prior[0]?.n??0)>=3)return reply.code(202).send(emailReply);
  const p=partners[0]!,code=String(randomInt(0,100000000)).padStart(8,'0'),id=randomUUID();
  const secret=digest(id+':'+code);
  await prisma.$executeRawUnsafe(`INSERT INTO "InfluencerAccessCode"("id","partnerId","codeHash","expiresAt") VALUES ($1::uuid,$2,$3,NOW()+INTERVAL '10 minutes')`,id,String(p.id),secret);
  try{await mailPartner(x.data.email,'Votre code de connexion',`Votre code à usage unique : ${code}\nValable 10 minutes. Si vous n'avez pas demandé ce code, ignorez ce message.`);}catch(e){req.log.error({err:e},'partner_code_email_failed');return reply.code(503).send({error:'envoi_indisponible'});}
  return reply.code(202).send(emailReply);
 });
 app.post('/partners/portal/login/verify',async(req,reply)=>{
  noStore(reply);if(!sameOrigin(req,reply))return;
  const parsed=z.object({email,code:z.string().regex(/^\d{8}$/)}).safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:'code_invalide'});
  if(throttled('verify-ip:'+req.ip,18,600000))return reply.code(429).send({error:'trop_de_tentatives'});
  const rows=await prisma.$queryRawUnsafe<R[]>(`SELECT c."id",c."codeHash",c."partnerId",c."attempts" FROM "InfluencerAccessCode" c JOIN "InfluencerPartner" p ON p."id"=c."partnerId" WHERE lower(p."email")=$1 AND p."status"<>'ARCHIVED' AND c."usedAt" IS NULL AND c."expiresAt">NOW() AND c."attempts"<5 ORDER BY c."createdAt" DESC LIMIT 1`,parsed.data.email);
  if(!rows.length)return reply.code(401).send({error:'code_expire_ou_incorrect'});
  const row=rows[0]!,actual=Buffer.from(digest(String(row.id)+':'+parsed.data.code),'hex'),expected=Buffer.from(String(row.codeHash),'hex');
  if(expected.length!==actual.length||!timingSafeEqual(expected,actual)){await prisma.$executeRawUnsafe(`UPDATE "InfluencerAccessCode" SET "attempts"="attempts"+1 WHERE "id"=$1::uuid`,row.id);return reply.code(401).send({error:'code_expire_ou_incorrect'});}
  const token=randomBytes(32).toString('hex');
  const consumed=await prisma.$transaction(async(tx)=>{
    const updated=await tx.$queryRawUnsafe<R[]>(`UPDATE "InfluencerAccessCode" SET "usedAt"=NOW() WHERE "id"=$1::uuid AND "usedAt" IS NULL AND "expiresAt">NOW() AND "attempts"<5 RETURNING "partnerId"`,row.id);
    if(!updated.length)return false;
    await tx.$executeRawUnsafe(`INSERT INTO "InfluencerPortalSession"("partnerId","tokenHash","expiresAt")VALUES ($1,$2,NOW()+INTERVAL '7 days')`,row.partnerId,digest(token));return true;
  });
  if(!consumed)return reply.code(401).send({error:'code_expire_ou_incorrect'});
  cookie(reply,token,7*86400);return{ok:true};
 });
 app.post('/partners/portal/logout',{preHandler:requirePortal},async(req,reply)=>{if(!sameOrigin(req,reply))return;const token=req.cookies?.pa_partner_session??'';await prisma.$executeRawUnsafe(`UPDATE "InfluencerPortalSession" SET "revokedAt"=NOW() WHERE "tokenHash"=$1`,digest(token));reply.clearCookie('pa_partner_session',{path:'/'});return{ok:true}});
 app.get('/partners/portal/me',{preHandler:requirePortal},async(req,reply)=>{noStore(reply);const p=self(req),partnerId=String(p.id);
  const campaigns=await prisma.$queryRawUnsafe<R[]>(`SELECT c."id",c."title",c."slug",c."status",c."clickCount",c."paymentStatus",c."financeStatus",c."feeMinor",c."paymentReference",c."contentUrl",c."reportedViews",c."reportedLikes",c."publishedAt",
   (SELECT COUNT(DISTINCT s."visitorId")::int FROM "SiteAnalyticsSession" s WHERE s."trafficCampaign"='inf-'||c."slug") AS "visitorsConsented",
   (SELECT COUNT(DISTINCT s."userId")::int FROM "SiteAnalyticsSession" s JOIN "User" u ON u."id"=s."userId" WHERE s."trafficCampaign"='inf-'||c."slug" AND s."userId" IS NOT NULL AND u."createdAt" BETWEEN s."startedAt"-INTERVAL '1 hour' AND s."startedAt"+INTERVAL '30 days') AS "registrationsEstimated",
   (SELECT COUNT(DISTINCT l."id")::int FROM "SiteAnalyticsSession" s JOIN "Listing" l ON l."sellerId"=s."userId" WHERE s."trafficCampaign"='inf-'||c."slug" AND s."userId" IS NOT NULL AND l."publishedAt" BETWEEN s."startedAt" AND s."startedAt"+INTERVAL '30 days') AS "listingsEstimated"
   FROM "InfluencerCampaign" c WHERE c."partnerId"=$1 ORDER BY c."createdAt" DESC`,partnerId);
  const proposals=await prisma.$queryRawUnsafe<R[]>(`SELECT o."id",o."campaignId",o."revision",o."feeMinor",o."deliverables",o."terms",o."status",o."counterFeeMinor",o."counterMessage",o."expiresAt",o."consentAt",o."legalStatus",o."createdAt" FROM "InfluencerProposal" o WHERE o."partnerId"=$1 ORDER BY o."createdAt" DESC`,partnerId);
  const proof=await prisma.$queryRawUnsafe<R[]>(`SELECT "id","campaignId","kind","originalName","sizeBytes","createdAt" FROM "InfluencerEvidence" WHERE "partnerId"=$1 ORDER BY "createdAt" DESC LIMIT 100`,partnerId);
  return {partner:{handle:p.handle,platform:p.platform,email:p.email},campaigns:campaigns.map(safe),proposals:proposals.map(safe),evidence:proof.map(safe)};
 });
 app.post('/admin/influencer-campaigns/:id/offer',{preHandler:admin},async(req,reply)=>{
  const p=id.safeParse(req.params),x=z.object({feeMinor:money,deliverables:z.string().trim().min(10).max(1500),terms:z.string().trim().min(40).max(5000),expiresDays:z.number().int().min(1).max(30).default(14)}).strict().safeParse(req.body);
  if(!p.success||!x.success)return reply.code(400).send({error:'invalid_offer'});
  const rows=await prisma.$queryRawUnsafe<R[]>(`SELECT c."id",c."partnerId",c."title",p."email",p."handle" FROM "InfluencerCampaign" c JOIN "InfluencerPartner" p ON p."id"=c."partnerId" WHERE c."id"=$1 AND c."status"<>'CANCELLED' LIMIT 1`,p.data.id);
  if(!rows.length)return reply.code(404).send({error:'campaign_not_found'});
  const c=rows[0]!;
  if(!c.email)return reply.code(409).send({error:'partner_email_required'});
  const created=await prisma.$transaction(async tx=>{
   await tx.$executeRawUnsafe(`UPDATE "InfluencerProposal" SET "status"='EXPIRED',"updatedAt"=NOW() WHERE "campaignId"=$1 AND "status"='OFFERED' AND "expiresAt"<NOW()`,p.data.id);
   const existing=await tx.$queryRawUnsafe<R[]>(`SELECT "id","status" FROM "InfluencerProposal" WHERE "campaignId"=$1 ORDER BY "revision" DESC LIMIT 1 FOR UPDATE`,p.data.id);
   const previous=existing[0];
   if(previous&&!['COUNTERED','DECLINED','EXPIRED'].includes(String(previous.status)))return null;
   const latest=await tx.$queryRawUnsafe<R[]>(`SELECT COALESCE(MAX("revision"),0)+1 AS "n" FROM "InfluencerProposal" WHERE "campaignId"=$1`,p.data.id);
   const version=Number(latest[0]?.n??1);
   const offer=await tx.$queryRawUnsafe<R[]>(`INSERT INTO "InfluencerProposal"("campaignId","partnerId","revision","feeMinor","deliverables","terms","expiresAt") VALUES ($1,$2,$3,$4,$5,$6,NOW()+($7::int * INTERVAL '1 day')) RETURNING "id"`,c.id,c.partnerId,version,x.data.feeMinor,x.data.deliverables,x.data.terms,x.data.expiresDays);
   await tx.$executeRawUnsafe(`UPDATE "InfluencerCampaign" SET "status"='NEGOTIATING',"updatedAt"=NOW() WHERE "id"=$1`,c.id);
   await tx.$executeRawUnsafe(`INSERT INTO "InfluencerAuditEvent"("campaignId","partnerId","action","actorKind","details")VALUES($1,$2,'OFFER_SENT','ADMIN',$3::jsonb)`,c.id,c.partnerId,JSON.stringify({version,feeMinor:x.data.feeMinor}));
   return offer[0];
  });
  if(!created)return reply.code(409).send({error:'await_previous_offer_response'});
  let emailSent=true;
  try{await mailPartner(String(c.email),'Nouvelle proposition Petit Annonces',`Bonjour @${c.handle},\nVous avez reçu une proposition pour « ${c.title} » : ${(x.data.feeMinor/100).toFixed(2)} €.\nConsultez les livrables et les conditions, puis acceptez ou proposez un autre tarif depuis votre espace partenaire : https://petitannonces.fr/espace-partenaire`);}catch(e){emailSent=false;req.log.error({err:e},'offer_email_failed');}
  return reply.code(201).send({ok:true,proposalId:created.id,emailSent});
 });
 app.post('/partners/portal/proposals/:id/respond',{preHandler:requirePortal},async(req,reply)=>{
  noStore(reply);if(!sameOrigin(req,reply))return;
  const p=id.safeParse(req.params),x=z.discriminatedUnion('decision',[
    z.object({decision:z.literal('COUNTER'),feeMinor:money,reason:z.string().trim().min(5).max(1200)}).strict(),
    z.object({decision:z.literal('DECLINE'),reason:z.string().trim().max(1200).default('')}).strict(),
    z.object({decision:z.literal('ACCEPT'),identityName:z.string().trim().min(4).max(180),identityAddress:z.string().trim().min(12).max(360),taxResidence:z.string().trim().min(2).max(100),acceptTerms:z.literal(true),confirmPhrase:z.literal('J’accepte les conditions de cette proposition.')}).strict()
  ]).safeParse(req.body);
  if(!p.success||!x.success)return reply.code(400).send({error:'invalid_response'});
  const partner=self(req),partnerId=String(partner.id);
  const result=await prisma.$transaction(async tx=>{
   const rows=await tx.$queryRawUnsafe<R[]>(`SELECT * FROM "InfluencerProposal" WHERE "id"=$1::uuid AND "partnerId"=$2 FOR UPDATE`,p.data.id,partnerId);
   const prop=rows[0];if(!prop||prop.status!=='OFFERED'||new Date(String(prop.expiresAt)).getTime()<=Date.now())return null;
   let action='',legal='';
   if(x.data.decision==='COUNTER'){
    if(x.data.feeMinor===Number(prop.feeMinor))return null;
    await tx.$executeRawUnsafe(`UPDATE "InfluencerProposal" SET "status"='COUNTERED',"counterFeeMinor"=$2,"counterMessage"=$3,"updatedAt"=NOW() WHERE "id"=$1::uuid`,prop.id,x.data.feeMinor,x.data.reason);action='COUNTER_OFFER';
   }else if(x.data.decision==='DECLINE'){
    await tx.$executeRawUnsafe(`UPDATE "InfluencerProposal" SET "status"='DECLINED',"counterMessage"=$2,"updatedAt"=NOW() WHERE "id"=$1::uuid`,prop.id,x.data.reason);action='OFFER_DECLINED';
   }else{
    await tx.$queryRawUnsafe<R[]>(`SELECT "id" FROM "InfluencerPartner" WHERE "id"=$1 FOR UPDATE`,partnerId);
    const yearly=await tx.$queryRawUnsafe<R[]>(`SELECT COALESCE(SUM("feeMinor"),0)::bigint AS total FROM "InfluencerProposal" WHERE "partnerId"=$1 AND "status"='ACCEPTED' AND EXTRACT(YEAR FROM "consentAt")=EXTRACT(YEAR FROM NOW())`,partnerId);
    const cumulative=Number(yearly[0]?.total??0)+Number(prop.feeMinor);
    // Annual threshold conservative for a same-goal campaign (including multiple promotions).
    legal=cumulative>=100000?'NEEDS_FORMAL_SIGNATURE':'PENDING_VERIFICATION';
    const signedSnapshot=JSON.stringify({proposalId:prop.id,campaignId:prop.campaignId,partnerId,revision:prop.revision,feeMinor:prop.feeMinor,deliverables:prop.deliverables,terms:prop.terms,identityName:x.data.identityName,identityAddress:x.data.identityAddress,taxResidence:x.data.taxResidence,confirmedAt:new Date().toISOString()});
    const consentDigest=digest(signedSnapshot);
    const ipHash=process.env.IP_HASH_SALT?digest(process.env.IP_HASH_SALT+':'+req.ip):null;
    await tx.$executeRawUnsafe(`UPDATE "InfluencerProposal" SET "status"='ACCEPTED',"identityName"=$2,"identityAddress"=$3,"taxResidence"=$4,"consentDigest"=$5,"consentIpHash"=$6,"consentAt"=NOW(),"legalStatus"=$7,"consentSnapshot"=$8,"updatedAt"=NOW() WHERE "id"=$1::uuid`,prop.id,x.data.identityName,x.data.identityAddress,x.data.taxResidence,consentDigest,ipHash,legal,signedSnapshot);
    await tx.$executeRawUnsafe(`UPDATE "InfluencerCampaign" SET "feeMinor"=$2,"status"='SCHEDULED',"updatedAt"=NOW() WHERE "id"=$1`,prop.campaignId,prop.feeMinor);
    action='OFFER_ACCEPTED';
   }
   await tx.$executeRawUnsafe(`INSERT INTO "InfluencerAuditEvent"("campaignId","partnerId","action","actorKind","details")VALUES($1,$2,$3,'PARTNER',$4::jsonb)`,prop.campaignId,partnerId,action,JSON.stringify({proposalId:prop.id,decision:x.data.decision,legalStatus:legal||undefined}));
   return{campaignId:String(prop.campaignId),legalStatus:legal||null};
  });
  if(!result)return reply.code(409).send({error:'offer_not_available'});
  await notifyAdmin('INFLUENCER_OFFER_RESPONSE','Réponse à une proposition influenceur',`Le partenaire @${partner.handle} a répondu : ${x.data.decision}.`,result.campaignId);
  return{ok:true,...result};
 });
 app.post('/partners/portal/campaigns/:id/content',{preHandler:requirePortal},async(req,reply)=>{
  noStore(reply);if(!sameOrigin(req,reply))return;const p=id.safeParse(req.params),x=z.object({contentUrl:link,reportedViews:z.number().int().min(0).max(1000000000),reportedLikes:z.number().int().min(0).max(1000000000)}).strict().safeParse(req.body);
  if(!p.success||!x.success)return reply.code(400).send({error:'invalid_content'});
  const partner=self(req);
  const rows=await prisma.$queryRawUnsafe<R[]>(`UPDATE "InfluencerCampaign" SET "contentUrl"=$1,"reportedViews"=$2,"reportedLikes"=$3,"publishedAt"=COALESCE("publishedAt",NOW()),"updatedAt"=NOW() WHERE "id"=$4 AND "partnerId"=$5 AND "status" IN ('SCHEDULED','ACTIVE','COMPLETED') RETURNING "id"`,x.data.contentUrl,x.data.reportedViews,x.data.reportedLikes,p.data.id,partner.id);
  if(!rows.length)return reply.code(409).send({error:'campaign_not_ready'});
  await audit(p.data.id,String(partner.id),'CONTENT_SUBMITTED','PARTNER',{url:x.data.contentUrl,views:x.data.reportedViews,likes:x.data.reportedLikes});
  await notifyAdmin('INFLUENCER_CONTENT_SUBMITTED','Contenu influenceur publié',`@${partner.handle} a transmis un lien de publication.`,p.data.id);
  return{ok:true};
 });
 app.post('/partners/portal/campaigns/:id/evidence',{preHandler:requirePortal,bodyLimit:4*1024*1024},async(req,reply)=>{
  noStore(reply);if(!sameOrigin(req,reply))return;const p=id.safeParse(req.params);
  const x=z.object({kind:z.enum(['INSIGHTS_SCREENSHOT','MEDIA_KIT','SIGNED_CONTRACT']),name:z.string().trim().min(3).max(120),mimeType:z.enum(['image/png','image/jpeg','image/webp','application/pdf']),base64:z.string().min(10).max(4200000)}).strict().safeParse(req.body);
  if(!p.success||!x.success)return reply.code(400).send({error:'invalid_proof'});
  const partner=self(req);
  const c=await prisma.$queryRawUnsafe<R[]>(`SELECT "id" FROM "InfluencerCampaign" WHERE "id"=$1 AND "partnerId"=$2 LIMIT 1`,p.data.id,partner.id);
  if(!c.length)return reply.code(404).send({error:'campaign_not_found'});

  let bytes:Buffer;
  try{bytes=Buffer.from(x.data.base64,'base64');if(bytes.length<20||bytes.length>3145728||bytes.toString('base64').replace(/=+$/,'')!==x.data.base64.replace(/=+$/,''))throw Error('size');}catch{return reply.code(400).send({error:'invalid_file'});}
  const magic=x.data.mimeType==='image/png'?bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')):x.data.mimeType==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:x.data.mimeType==='image/webp'?bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP':bytes.toString('ascii',0,5)==='%PDF-';
  if(!magic)return reply.code(400).send({error:'file_type_mismatch'});
  const count=await prisma.$queryRawUnsafe<R[]>(`SELECT COUNT(*)::int AS n FROM "InfluencerEvidence" WHERE "campaignId"=$1`,p.data.id);
  if(Number(count[0]?.n??0)>=15)return reply.code(409).send({error:'proof_limit_reached'});
  const ext=x.data.mimeType==='application/pdf'?'pdf':x.data.mimeType==='image/png'?'png':x.data.mimeType==='image/jpeg'?'jpg':'webp';
  const objectKey=`${String(partner.id)}/${p.data.id}/${randomUUID()}.${ext}`;
  try{await savePrivateProof(objectKey,bytes);}catch(e){req.log.error({err:e},'influencer_proof_storage_failed');return reply.code(503).send({error:'upload_unavailable'});}
  const record=await prisma.$queryRawUnsafe<R[]>(`INSERT INTO "InfluencerEvidence"("campaignId","partnerId","kind","objectKey","originalName","mimeType","sizeBytes") VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING "id"`,p.data.id,partner.id,x.data.kind,objectKey,x.data.name,x.data.mimeType,bytes.byteLength);
  await audit(p.data.id,String(partner.id),'PROOF_UPLOADED','PARTNER',{kind:x.data.kind,proofId:record[0]?.id});
  await notifyAdmin('INFLUENCER_PROOF_UPLOADED','Justificatif de campagne reçu',`@${partner.handle} a ajouté un justificatif privé.`,p.data.id);
  return reply.code(201).send({ok:true,id:record[0]?.id});
 });
 app.get('/partners/portal/evidence/:id/download',{preHandler:requirePortal},async(req,reply)=>{
  noStore(reply);const p=id.safeParse(req.params);if(!p.success)return reply.code(400).send({error:'invalid_id'});const partner=self(req);
  const rows=await prisma.$queryRawUnsafe<R[]>(`SELECT "objectKey","originalName" FROM "InfluencerEvidence" WHERE "id"=$1::uuid AND "partnerId"=$2 LIMIT 1`,p.data.id,partner.id);
  if(!rows.length)return reply.code(404).send({error:'not_found'});
  return sendPrivateProof(reply,String(rows[0]!.objectKey),String(rows[0]!.originalName));
 });
 app.get('/admin/influencer-workflow',{preHandler:admin},async(_req,reply)=>{
  noStore(reply);const [proposals,proof,events]=await Promise.all([
   prisma.$queryRawUnsafe<R[]>(`SELECT o."id",o."campaignId",o."partnerId",o."revision",o."feeMinor",o."deliverables",o."terms",o."status",o."counterFeeMinor",o."counterMessage",o."expiresAt",o."consentAt",o."legalStatus",o."identityName",o."identityAddress",o."taxResidence",o."consentDigest",o."verifiedAt",c."title" AS "campaignTitle",c."financeStatus",c."paymentReference",c."status" AS "campaignStatus",p."handle",p."email" FROM "InfluencerProposal" o JOIN "InfluencerCampaign" c ON c."id"=o."campaignId" JOIN "InfluencerPartner" p ON p."id"=o."partnerId" ORDER BY o."createdAt" DESC LIMIT 150`),
   prisma.$queryRawUnsafe<R[]>(`SELECT e."id",e."campaignId",e."partnerId",e."kind",e."originalName",e."sizeBytes",e."createdAt" FROM "InfluencerEvidence" e ORDER BY e."createdAt" DESC LIMIT 150`),
   prisma.$queryRawUnsafe<R[]>(`SELECT e."campaignId",e."action",e."actorKind",e."createdAt" FROM "InfluencerAuditEvent" e ORDER BY e."createdAt" DESC LIMIT 150`)
  ]);
  return{proposals:proposals.map(safe),evidence:proof.map(safe),events:events.map(safe)};
 });
 app.get('/admin/influencer-evidence/:id/download',{preHandler:admin},async(req,reply)=>{
  noStore(reply);const p=id.safeParse(req.params);if(!p.success)return reply.code(400).send({error:'invalid_id'});
  const rows=await prisma.$queryRawUnsafe<R[]>(`SELECT "objectKey","originalName" FROM "InfluencerEvidence" WHERE "id"=$1::uuid LIMIT 1`,p.data.id);
  if(!rows.length)return reply.code(404).send({error:'not_found'});
  return sendPrivateProof(reply,String(rows[0]!.objectKey),String(rows[0]!.originalName));
 });
 app.post('/admin/influencer-proposals/:id/verify-contract',{preHandler:admin},async(req,reply)=>{
  const p=id.safeParse(req.params),body=z.object({attestation:z.literal(true)}).strict().safeParse(req.body);
  if(!p.success||!body.success)return reply.code(400).send({error:'invalid_request'});
  const prop=await prisma.$queryRawUnsafe<R[]>(`SELECT "id","campaignId","partnerId","status","legalStatus","consentDigest" FROM "InfluencerProposal" WHERE "id"=$1::uuid LIMIT 1`,p.data.id);
  if(!prop.length||prop[0]!.status!=='ACCEPTED'||!prop[0]!.consentDigest)return reply.code(409).send({error:'partner_acceptance_required'});
  const item=prop[0]!;
  if(item.legalStatus==='NEEDS_FORMAL_SIGNATURE'){
    const proof=await prisma.$queryRawUnsafe<R[]>(`SELECT "id" FROM "InfluencerEvidence" WHERE "campaignId"=$1 AND "partnerId"=$2 AND "kind"='SIGNED_CONTRACT' LIMIT 1`,item.campaignId,item.partnerId);
    if(!proof.length)return reply.code(409).send({error:'signed_contract_upload_required'});
  }
  await prisma.$executeRawUnsafe(`UPDATE "InfluencerProposal" SET "legalStatus"='VERIFIED',"verifiedAt"=NOW(),"updatedAt"=NOW() WHERE "id"=$1::uuid AND "status"='ACCEPTED'`,p.data.id);
  await audit(String(item.campaignId),String(item.partnerId),'CONTRACT_REVIEWED','ADMIN',{proposalId:p.data.id,manualAttestation:true});
  return{ok:true};
 });
 app.post('/admin/influencer-campaigns/:id/activate',{preHandler:admin},async(req,reply)=>{
  const p=id.safeParse(req.params);if(!p.success)return reply.code(400).send({error:'invalid_id'});
  const rows=await prisma.$queryRawUnsafe<R[]>(`UPDATE "InfluencerCampaign" c SET "status"='ACTIVE',"updatedAt"=NOW() WHERE c."id"=$1 AND c."status" IN ('SCHEDULED','NEGOTIATING') AND EXISTS(SELECT 1 FROM "InfluencerProposal" o WHERE o."campaignId"=c."id" AND o."status"='ACCEPTED' AND o."legalStatus"='VERIFIED') RETURNING c."partnerId"`,p.data.id);
  if(!rows.length)return reply.code(409).send({error:'verified_contract_required'});
  await audit(p.data.id,String(rows[0]?.partnerId),'CAMPAIGN_ACTIVATED','ADMIN');return{ok:true};
 });
 app.get('/partners/portal/proposals/:id/receipt',{preHandler:requirePortal},async(req,reply)=>{
  noStore(reply);const p=id.safeParse(req.params);if(!p.success)return reply.code(400).send({error:'invalid_id'});
  const rows=await prisma.$queryRawUnsafe<R[]>(`SELECT "consentSnapshot","consentDigest","consentAt","legalStatus" FROM "InfluencerProposal" WHERE "id"=$1::uuid AND "partnerId"=$2 AND "status"='ACCEPTED' LIMIT 1`,p.data.id,self(req).id);
  if(!rows[0]?.consentSnapshot)return reply.code(404).send({error:'receipt_unavailable'});
  const x=JSON.parse(String(rows[0].consentSnapshot)) as Record<string,unknown>;
  const str=`ATTESTATION DE CONSENTEMENT - PETIT ANNONCES\nDocument de suivi, et non signature électronique qualifiée.\n\nCréateur : ${x.identityName}\nAdresse : ${x.identityAddress}\nRésidence fiscale : ${x.taxResidence}\nProposition : ${x.proposalId}\nRémunération : ${(Number(x.feeMinor)/100).toFixed(2)} EUR\nPrestations : ${x.deliverables}\n\nCONDITIONS :\n${x.terms}\n\nDate de confirmation : ${x.confirmedAt}\nEmpreinte SHA-256 : ${rows[0].consentDigest}\nÉtat de vérification : ${rows[0].legalStatus}\n`;
  reply.header('Content-Type','text/plain; charset=utf-8');reply.header('Content-Disposition','attachment; filename="attestation-petitannonces.txt"');return reply.send(str);
 });
 app.get('/admin/influencer-proposals/:id/receipt',{preHandler:admin},async(req,reply)=>{
  noStore(reply);const p=id.safeParse(req.params);if(!p.success)return reply.code(400).send({error:'invalid_id'});
  const rows=await prisma.$queryRawUnsafe<R[]>(`SELECT "consentSnapshot","consentDigest","legalStatus" FROM "InfluencerProposal" WHERE "id"=$1::uuid AND "status"='ACCEPTED' LIMIT 1`,p.data.id);
  if(!rows[0]?.consentSnapshot)return reply.code(404).send({error:'receipt_unavailable'});
  const x=JSON.parse(String(rows[0].consentSnapshot)) as Record<string,unknown>;
  const str=`ATTESTATION DE CONSENTEMENT - PETIT ANNONCES\nDocument non qualifié\n\n${JSON.stringify(x,null,2)}\n\nEmpreinte SHA-256 : ${rows[0].consentDigest}\nÉtat de vérification : ${rows[0].legalStatus}\n`;
  reply.header('Content-Type','text/plain; charset=utf-8');reply.header('Content-Disposition','attachment; filename="attestation-petitannonces.txt"');return reply.send(str);
 });
 app.post('/admin/influencer-campaigns/:id/finance',{preHandler:admin},async(req,reply)=>{
  const p=id.safeParse(req.params),x=z.discriminatedUnion('action',[
   z.object({action:z.literal('APPROVE'),confirmed:z.literal(true)}).strict(),
   z.object({action:z.literal('MARK_PAID'),reference:z.string().trim().min(4).max(120),confirmed:z.literal(true)}).strict()
  ]).safeParse(req.body);
  if(!p.success||!x.success)return reply.code(400).send({error:'invalid_request'});
  const c=await prisma.$queryRawUnsafe<R[]>(`SELECT "id","partnerId","financeStatus","status","contentUrl" FROM "InfluencerCampaign" WHERE "id"=$1`,p.data.id);
  if(!c.length)return reply.code(404).send({error:'campaign_not_found'});
  const row=c[0]!;
  if(x.data.action==='APPROVE'){
    if(row.status!=='COMPLETED'||!row.contentUrl||row.financeStatus!=='NOT_REQUESTED')return reply.code(409).send({error:'campaign_must_be_completed'});
    const checks=await prisma.$queryRawUnsafe<R[]>(`SELECT (SELECT COUNT(*)::int FROM "InfluencerEvidence" WHERE "campaignId"=$1 AND "kind"='INSIGHTS_SCREENSHOT') AS proofs,(SELECT COUNT(*)::int FROM "InfluencerProposal" WHERE "campaignId"=$1 AND "status"='ACCEPTED' AND "legalStatus"='VERIFIED') AS accepted`,p.data.id);
    if(Number(checks[0]?.proofs??0)<1||Number(checks[0]?.accepted??0)<1)return reply.code(409).send({error:'verified_contract_and_insights_required'});
    await prisma.$executeRawUnsafe(`UPDATE "InfluencerCampaign" SET "financeStatus"='APPROVED',"paymentStatus"='PENDING',"paymentApprovedAt"=NOW(),"updatedAt"=NOW() WHERE "id"=$1`,p.data.id);
    await audit(p.data.id,String(row.partnerId),'PAYMENT_APPROVED_MANUAL','ADMIN');
  }else{
    if(row.financeStatus!=='APPROVED')return reply.code(409).send({error:'approval_required'});
    await prisma.$executeRawUnsafe(`UPDATE "InfluencerCampaign" SET "financeStatus"='PAID',"paymentStatus"='PAID',"paymentReference"=$2,"paymentPaidAt"=NOW(),"updatedAt"=NOW() WHERE "id"=$1`,p.data.id,x.data.reference);
    await audit(p.data.id,String(row.partnerId),'PAYMENT_MARKED_EXTERNAL','ADMIN',{reference:x.data.reference});
  }
  let emailSent=true;
  try {
    const contacts=await prisma.$queryRawUnsafe<R[]>(`SELECT p."email",c."title" FROM "InfluencerCampaign" c JOIN "InfluencerPartner" p ON p."id"=c."partnerId" WHERE c."id"=$1 LIMIT 1`,p.data.id);
    if(contacts[0]?.email){await mailPartner(String(contacts[0].email),x.data.action==='APPROVE'?'Paiement en préparation':'Votre paiement a été enregistré',x.data.action==='APPROVE'?`Votre campagne « ${String(contacts[0].title)} » a passé la vérification administrative. Le versement n'a pas encore été effectué.`:`Nous avons enregistré un versement externe pour « ${String(contacts[0].title)} ». Référence : ${x.data.action==='MARK_PAID'?x.data.reference:''}. Consultez votre espace : https://petitannonces.fr/espace-partenaire`);}
  } catch(e){emailSent=false;req.log.error({err:e},'influencer_finance_email_failed');}
  return{ok:true,transferInitiated:false,emailSent};
 });
}
