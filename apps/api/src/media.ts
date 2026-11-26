import { animalCessionRequiresProductionApproval } from "./animal-cession-gate.js";
import { execFile } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { z } from "zod";
import { requireListingUser } from "./listing-auth.js";
import { getSiteSettings } from "./admin-control.js";
import { compareFingerprintBits, embedInvisibleFingerprint, expectedFingerprintBits, imageFingerprintSecret, observeInvisibleFingerprint } from "./image-fingerprint.js";
import { requireAdminRoles } from "./rbac.js";
import { createPresignedUpload, deleteStoredObject, makeStoredObjectPublic, publicObjectUrl, readStoredObjectBuffer, storageConfigured, uploadStoredObject, verifyStoredObject } from "./storage.js";

const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/heic", "image/heif"]);
const HEIC_MIME_TYPES = new Set(["image/heic", "image/heif"]);
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_IMAGES_PER_LISTING = 20;
const execFileAsync = promisify(execFile);

async function decodeHeicToJpeg(input: Buffer) {
  const dir = await mkdtemp(join(tmpdir(), "pa-heic-"));
  const source = join(dir, "source.heic");
  const output = join(dir, "decoded.jpg");
  try {
    await writeFile(source, input);
    await execFileAsync("/usr/bin/heif-convert", ["-q", "90", source, output], { timeout: 15_000, maxBuffer: 1024 * 1024 });
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function normalizeListingImage(input: Buffer, mimeType: string) {
  let decodable = input;
  if (HEIC_MIME_TYPES.has(mimeType)) decodable = await decodeHeicToJpeg(input);
  try {
    const body = await sharp(decodable, { failOn: "none", limitInputPixels: 80_000_000 })
      .rotate()
      .resize({ width: 2560, height: 2560, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 84, effort: 4 })
      .toBuffer();
    if (!body.length) throw new Error("empty_normalized_image");
    return { body, mimeType: "image/webp" };
  } catch (error) {
    if (HEIC_MIME_TYPES.has(mimeType)) throw error;
    return { body: input, mimeType };
  }
}

function extensionForMime(mimeType: string) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/avif") return "avif";
  if (mimeType === "image/heic") return "heic";
  if (mimeType === "image/heif") return "heif";
  return "webp";
}

export async function registerMediaRoutes(app: FastifyInstance) {
  app.get("/media/watermark/:mediaId", async (request, reply) => {
    const parsed=z.object({mediaId:z.string().uuid()}).safeParse(request.params);
    if(!parsed.success)return reply.code(400).send({error:"invalid_media_id"});
    const rows=await prisma.$queryRawUnsafe<Array<{objectKey:string;mimeType:string;listingId:string}>>(
      `SELECT m."objectKey",m."mimeType",m."listingId" FROM "ListingMedia" m JOIN "Listing" l ON l."id"=m."listingId" WHERE m."id"=$1 AND m."status"='READY' AND l."status"='PUBLISHED' LIMIT 1`,parsed.data.mediaId,
    );
    const row=rows[0];if(!row)return reply.code(404).send({error:"image_not_found"});
    const input=await readStoredObjectBuffer(row.objectKey,MAX_IMAGE_BYTES).catch(()=>null);if(!input)return reply.code(404).send({error:"image_unavailable"});
    const settings=await getSiteSettings().catch(()=>({watermarkEnabled:true,watermarkReinforced:true,watermarkOpacity:.88,fingerprintEnabled:true,fingerprintStrength:2,fingerprintVersion:1} as any));
    const secret=imageFingerprintSecret();
    const fingerprintEnabled=settings.fingerprintEnabled!==false&&Boolean(secret);
    if(!settings.watermarkEnabled&&!fingerprintEnabled){reply.header("Cache-Control","public, max-age=3600, s-maxage=3600");return reply.type(row.mimeType).send(input);}
    const image=sharp(input,{failOn:"none",limitInputPixels:80_000_000}).rotate();
    const metadata=await image.metadata();const width=Math.max(1,Number(metadata.width??1200)),height=Math.max(1,Number(metadata.height??900));
    const opacity=Math.max(.35,Math.min(1,Number(settings.watermarkOpacity??.88)));
    const unit=Math.max(10,Math.round(Math.min(width,height)*.018)),pad=Math.max(14,Math.round(unit*.9));
    const badgeW=Math.min(Math.round(width*.34),unit*17),badgeH=Math.round(unit*3.15),x=pad,y=height-pad-badgeH;
    const ghost=settings.watermarkReinforced?`<text x="${width/2}" y="${height/2}" text-anchor="middle" dominant-baseline="middle" transform="rotate(-14 ${width/2} ${height/2})" font-family="Arial,Helvetica,sans-serif" font-size="${Math.round(Math.min(width,height)*.085)}" font-weight="800" fill="white" fill-opacity="${(0.09*opacity).toFixed(3)}">petitannonces.fr</text>`:"";
    const overlay=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${ghost}<g opacity="${opacity.toFixed(2)}"><rect x="${x}" y="${y}" width="${badgeW}" height="${badgeH}" rx="${badgeH/2}" fill="#171522" fill-opacity=".42" stroke="white" stroke-opacity=".28"/><rect x="${x+unit*.55}" y="${y+unit*.55}" width="${unit*2.05}" height="${unit*2.05}" rx="${unit*.62}" fill="white" fill-opacity=".18"/><text x="${x+unit*1.58}" y="${y+badgeH/2}" text-anchor="middle" dominant-baseline="middle" font-family="Arial,Helvetica,sans-serif" font-size="${unit*.82}" font-weight="900" fill="white">PA</text><text x="${x+unit*3.25}" y="${y+badgeH/2}" dominant-baseline="middle" font-family="Arial,Helvetica,sans-serif" font-size="${unit}" font-weight="800" fill="white">petitannonces.fr</text></g></svg>`);
    let protectedImage=settings.watermarkEnabled?image.composite([{input:overlay,top:0,left:0}]):image;
    const raw=await protectedImage.removeAlpha().raw().toBuffer({resolveWithObject:true});
    if(fingerprintEnabled&&secret){
      embedInvisibleFingerprint({data:raw.data,width:raw.info.width,height:raw.info.height,channels:raw.info.channels,mediaId:parsed.data.mediaId,listingId:row.listingId,secret,strength:Number(settings.fingerprintStrength??2),version:Math.max(2,Number(settings.fingerprintVersion??2))});
    }
    const output=await sharp(raw.data,{raw:{width:raw.info.width,height:raw.info.height,channels:raw.info.channels}}).webp({quality:84,effort:3}).toBuffer();
    reply.header("Cache-Control","public, max-age=300, s-maxage=3600, stale-while-revalidate=3600");
    reply.header("X-Content-Type-Options","nosniff");
    return reply.type("image/webp").send(output);
  });

  for (const mime of IMAGE_MIME_TYPES) {
    if (!app.hasContentTypeParser(mime)) app.addContentTypeParser(mime, { parseAs: "buffer", bodyLimit: MAX_IMAGE_BYTES }, (_request, body, done) => done(null, body));
  }

  async function adminActor(request:any){
    const token=request.cookies.pa_session;
    if(!token)return null;
    const session=await prisma.session.findUnique({where:{tokenHash:createHash("sha256").update(token).digest("hex")},select:{userId:true}});
    return session?.userId??null;
  }
  async function editableMedia(tx:any,id:string){
    await tx.$queryRaw`SELECT "id" FROM "Listing" WHERE "id"=${id} FOR UPDATE`;
    const l=await tx.listing.findUnique({where:{id},select:{id:true,status:true,category:{select:{domain:true,slug:true}}}});
    if(!l||!["DRAFT","PENDING","PUBLISHED"].includes(l.status)||animalCessionRequiresProductionApproval(l.category))return false;
    const rows=await tx.$queryRaw`SELECT 1 FROM "MarketplaceOrder" WHERE "listingId"=${id} UNION ALL SELECT 1 FROM "ListingEditSession" WHERE "originalListingId"=${id} OR "workingListingId"=${id} UNION ALL SELECT 1 FROM "AdminListingArchive" WHERE "listingId"=${id} LIMIT 1`;
    return rows.length===0;
  }
  app.post("/admin/listings/:id/media/upload",{preHandler:requireAdminRoles(["SUPER_ADMIN","ADMIN"]),bodyLimit:MAX_IMAGE_BYTES},async(request,reply)=>{
    const params=z.object({id:z.string().min(1)}).safeParse(request.params);
    const query=z.object({reason:z.string().trim().min(5).max(500)}).safeParse(request.query);
    if(!params.success||!query.success)return reply.code(400).send({error:"invalid_request"});
    const actor=await adminActor(request);if(!actor)return reply.code(401).send({error:"unauthorized"});
    if(!storageConfigured())return reply.code(503).send({error:"object_storage_not_configured"});
    const mime=String(request.headers["content-type"]??"").split(";")[0]?.trim().toLowerCase();
    if(!mime||!IMAGE_MIME_TYPES.has(mime))return reply.code(415).send({error:"unsupported_media_type"});
    if(!Buffer.isBuffer(request.body)||!request.body.length)return reply.code(400).send({error:"empty_media"});
    let normalized:Buffer;
    try{
      const input=HEIC_MIME_TYPES.has(mime)?await decodeHeicToJpeg(request.body):request.body;
      normalized=await sharp(input,{failOn:"error",limitInputPixels:80_000_000}).rotate().resize({width:2560,height:2560,fit:"inside",withoutEnlargement:true}).webp({quality:84}).toBuffer();
      if(!normalized.length||normalized.length>MAX_IMAGE_BYTES)throw new Error("invalid_image");
    }catch{return reply.code(422).send({error:"image_processing_failed"});}
    const id=randomUUID();const key=`listings/${params.data.id}/${id}.webp`;
    let uploaded=false;
    try{
      const result=await prisma.$transaction(async tx=>{
        if(!await editableMedia(tx,params.data.id))return {error:"listing_media_protected"} as const;
        const rows=await tx.$queryRaw<Array<{count:number;maxOrder:number;hasCover:boolean}>>`SELECT COUNT(*)::int AS count,COALESCE(MAX("sortOrder"),-10)::int AS "maxOrder",COALESCE(BOOL_OR("isCover" AND "status"='READY'),FALSE) AS "hasCover" FROM "ListingMedia" WHERE "listingId"=${params.data.id} AND "status"<>'FAILED'`;
        const row=rows[0];if(!row||row.count>=MAX_IMAGES_PER_LISTING)return {error:"media_limit_reached"} as const;
        const url=await uploadStoredObject(key,"image/webp",normalized);uploaded=true;
        await tx.$executeRaw`INSERT INTO "ListingMedia" ("id","listingId","objectKey","publicUrl","mimeType","sizeBytes","status","sortOrder","isCover","createdAt","updatedAt") VALUES (${id},${params.data.id},${key},${url},'image/webp',${normalized.length},'READY',${row.maxOrder+10},${!row.hasCover},NOW(),NOW())`;
        await tx.$executeRaw`INSERT INTO "AdminAuditEvent" ("id","actorUserId","action","entityType","entityId","metadata") VALUES (${randomUUID()},${actor},'LISTING_MEDIA_ADDED','LISTING',${params.data.id},${JSON.stringify({mediaId:id,reason:query.data.reason})}::jsonb)`;
        return {id,url};
      },{timeout:30000});
      if("error" in result)return reply.code(409).send(result);
      return reply.code(201).send(result);
    }catch(error){if(uploaded){const refs=await prisma.$queryRaw<Array<{count:number}>>`SELECT COUNT(*)::int AS count FROM "ListingMedia" WHERE "objectKey"=${key}`.catch(()=>null);if(refs?.[0]?.count===0)await deleteStoredObject(key).catch(()=>undefined);}throw error;}
  });
  app.delete("/admin/listings/:id/media/:mediaId",{preHandler:requireAdminRoles(["SUPER_ADMIN","ADMIN"])},async(request,reply)=>{
    const params=z.object({id:z.string().min(1),mediaId:z.string().uuid()}).safeParse(request.params);
    const body=z.object({reason:z.string().trim().min(5).max(500)}).safeParse(request.body);
    if(!params.success||!body.success)return reply.code(400).send({error:"invalid_request"});
    const actor=await adminActor(request);if(!actor)return reply.code(401).send({error:"unauthorized"});
    const result=await prisma.$transaction(async tx=>{
      if(!await editableMedia(tx,params.data.id))return {error:"listing_media_protected"} as const;
      const rows=await tx.$queryRaw<Array<{id:string;objectKey:string;isCover:boolean}>>`SELECT "id","objectKey","isCover" FROM "ListingMedia" WHERE "listingId"=${params.data.id} AND "status"='READY' ORDER BY "sortOrder","createdAt" FOR UPDATE`;
      const media=rows.find(m=>m.id===params.data.mediaId);if(!media)return {error:"media_not_found"} as const;
      if(rows.length<=1)return {error:"last_photo_protected"} as const;
      await tx.$executeRaw`DELETE FROM "ListingMedia" WHERE "id"=${media.id} AND "listingId"=${params.data.id}`;
      if(media.isCover){const next=rows.find(m=>m.id!==media.id);if(next)await tx.$executeRaw`UPDATE "ListingMedia" SET "isCover"=TRUE,"updatedAt"=NOW() WHERE "id"=${next.id}`;}
      await tx.$executeRaw`INSERT INTO "AdminAuditEvent" ("id","actorUserId","action","entityType","entityId","metadata") VALUES (${randomUUID()},${actor},'LISTING_MEDIA_REMOVED','LISTING',${params.data.id},${JSON.stringify({mediaId:media.id,reason:body.data.reason})}::jsonb)`;
      return {objectKey:media.objectKey};
    });
    if("error" in result)return reply.code(409).send(result);
    const refs=await prisma.$queryRaw<Array<{count:number}>>`SELECT COUNT(*)::int AS count FROM "ListingMedia" WHERE "objectKey"=${result.objectKey}`.catch(()=>null);
    if(refs?.[0]?.count===0)await deleteStoredObject(result.objectKey).catch(()=>undefined);
    return reply.send({removed:true});
  });

  app.post("/admin/media/fingerprint/verify",{preHandler:requireAdminRoles(["SUPER_ADMIN","ADMIN","MODERATOR","COMPLIANCE"]),bodyLimit:MAX_IMAGE_BYTES},async(request,reply)=>{
    const mimeType=String(request.headers["content-type"]??"").split(";")[0]?.trim().toLowerCase();
    if(!mimeType||!IMAGE_MIME_TYPES.has(mimeType))return reply.code(415).send({error:"unsupported_media_type"});
    if(!Buffer.isBuffer(request.body)||request.body.length<1)return reply.code(400).send({error:"empty_media"});
    const secret=imageFingerprintSecret();if(!secret)return reply.code(503).send({error:"fingerprint_key_unavailable"});
    let decodable=Buffer.from(request.body);if(HEIC_MIME_TYPES.has(mimeType))decodable=await decodeHeicToJpeg(decodable);
    let raw;
    try{raw=await sharp(decodable,{failOn:"none",limitInputPixels:80_000_000}).rotate().removeAlpha().raw().toBuffer({resolveWithObject:true})}
    catch{return reply.code(422).send({error:"image_processing_failed"})}
    const settings=await getSiteSettings().catch(()=>({fingerprintVersion:2} as any));
    const currentVersion=Math.max(2,Number(settings.fingerprintVersion??2));
    const versions=Array.from({length:Math.min(3,currentVersion-1)},(_,i)=>currentVersion-i).filter(v=>v>=2);
    const observations=versions.map(version=>({version,...observeInvisibleFingerprint({data:raw.data,width:raw.info.width,height:raw.info.height,channels:raw.info.channels,secret,version})}));
    const candidates=await prisma.$queryRawUnsafe<Array<{mediaId:string;listingId:string;title:string|null;slug:string|null;status:string;createdAt:Date}>>(
      `SELECT m."id" AS "mediaId",m."listingId",l."title",l."slug",l."status"::text AS "status",m."createdAt"
       FROM "ListingMedia" m JOIN "Listing" l ON l."id"=m."listingId"
       WHERE m."status"='READY' ORDER BY m."createdAt" DESC LIMIT 50000`
    );
    const matches:Array<{mediaId:string;listingId:string;title:string|null;slug:string|null;status:string;version:number;matchRate:number;confidence:number;signal:number;createdAt:Date}>=[];
    for(const candidate of candidates)for(const observation of observations){
      const expected=expectedFingerprintBits(secret,candidate.mediaId,candidate.listingId,observation.version);
      const compared=compareFingerprintBits(observation.bits,expected);
      const confidence=Math.max(0,Math.min(1,(compared.matchRate-.5)*2));
      matches.push({...candidate,version:observation.version,matchRate:compared.matchRate,confidence,signal:observation.signal});
    }
    matches.sort((a,b)=>b.matchRate-a.matchRate||b.signal-a.signal);
    const top=matches.slice(0,5);
    const best=top[0]??null;
    return reply.send({
      matched:Boolean(best&&best.matchRate>=.78),
      image:{width:raw.info.width,height:raw.info.height,channels:raw.info.channels},
      candidateCount:candidates.length,
      best,
      matches:top,
    });
  });

  app.get("/listings/:id/media", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    const listing = await prisma.listing.findFirst({ where: { id: params.data.id, sellerId: user.id }, select: { id: true } });
    if (!listing) return reply.code(404).send({ error: "listing_not_found" });

    const media = await prisma.$queryRawUnsafe<Array<{
      id: string; publicUrl: string | null; mimeType: string; sizeBytes: number; width: number | null; height: number | null;
      sortOrder: number; isCover: boolean; status: string; altText: string | null;
    }>>(
      `SELECT "id","publicUrl","mimeType","sizeBytes","width","height","sortOrder","isCover","status","altText"
       FROM "ListingMedia" WHERE "listingId"=$1 AND "status" <> 'FAILED' ORDER BY "sortOrder" ASC, "createdAt" ASC`,
      listing.id,
    );
    return reply.send({ media });
  });

  app.post("/listings/:id/media/upload-direct", { bodyLimit: MAX_IMAGE_BYTES }, async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    if (!storageConfigured()) return reply.code(503).send({ error: "object_storage_not_configured" });

    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    const mimeType = String(request.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
    if (!mimeType || !IMAGE_MIME_TYPES.has(mimeType)) return reply.code(415).send({ error: "unsupported_media_type" });
    const body = request.body;
    if (!Buffer.isBuffer(body) || body.length < 1) return reply.code(400).send({ error: "empty_media" });
    if (body.length > MAX_IMAGE_BYTES) return reply.code(413).send({ error: "media_too_large", maxBytes: MAX_IMAGE_BYTES });

    const listing = await prisma.listing.findFirst({ where: { id: params.data.id, sellerId: user.id, status: { in: ["DRAFT", "PENDING", "PUBLISHED"] } }, select: { id: true } });
    if (!listing) return reply.code(404).send({ error: "listing_not_found" });
    const countRows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT COUNT(*)::bigint AS count FROM "ListingMedia" WHERE "listingId" = $1 AND "status" <> 'FAILED'`, listing.id);
    const count = Number(countRows[0]?.count ?? 0n);
    if (count >= MAX_IMAGES_PER_LISTING) return reply.code(409).send({ error: "media_limit_reached", limit: MAX_IMAGES_PER_LISTING });

    let normalized: { body: Buffer; mimeType: string };
    try {
      normalized = await normalizeListingImage(Buffer.from(body), mimeType);
    } catch (error) {
      request.log.warn({ error, listingId: listing.id, mimeType }, "listing image normalization failed");
      return reply.code(422).send({ error: HEIC_MIME_TYPES.has(mimeType) ? "heic_conversion_failed" : "image_processing_failed" });
    }
    if (normalized.body.length > MAX_IMAGE_BYTES) return reply.code(413).send({ error: "media_too_large", maxBytes: MAX_IMAGE_BYTES });

    const mediaId = randomUUID();
    const objectKey = `listings/${listing.id}/${mediaId}.${extensionForMime(normalized.mimeType)}`;
    const sortOrder = count * 10;
    const altTextHeader = request.headers["x-file-name"];
    const altText = typeof altTextHeader === "string" ? decodeURIComponent(altTextHeader).slice(0, 180) : null;
    const publicUrl = await uploadStoredObject(objectKey, normalized.mimeType, normalized.body);
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ListingMedia" ("id","listingId","objectKey","publicUrl","mimeType","sizeBytes","status","sortOrder","isCover","altText","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,'READY',$7,$8,$9,NOW(),NOW())`,
      mediaId, listing.id, objectKey, publicUrl, normalized.mimeType, normalized.body.length, sortOrder, count === 0, altText,
    );
    return reply.code(201).send({ media: { id: mediaId, url: publicUrl, width: null, height: null } });
  });

  app.post("/listings/:id/media/upload-intent", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    if (!storageConfigured()) return reply.code(503).send({ error: "object_storage_not_configured" });

    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ mimeType: z.string().min(1), sizeBytes: z.number().int().positive(), altText: z.string().trim().max(180).nullish() }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    if (!IMAGE_MIME_TYPES.has(body.data.mimeType)) return reply.code(415).send({ error: "unsupported_media_type" });
    if (HEIC_MIME_TYPES.has(body.data.mimeType)) return reply.code(409).send({ error: "heic_requires_direct_upload" });
    if (body.data.sizeBytes > MAX_IMAGE_BYTES) return reply.code(413).send({ error: "media_too_large", maxBytes: MAX_IMAGE_BYTES });

    const listing = await prisma.listing.findFirst({ where: { id: params.data.id, sellerId: user.id, status: { in: ["DRAFT", "PENDING", "PUBLISHED"] } }, select: { id: true } });
    if (!listing) return reply.code(404).send({ error: "listing_not_found" });

    const countRows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT COUNT(*)::bigint AS count FROM "ListingMedia" WHERE "listingId" = $1 AND "status" <> 'FAILED'`, listing.id);
    const count = Number(countRows[0]?.count ?? 0n);
    if (count >= MAX_IMAGES_PER_LISTING) return reply.code(409).send({ error: "media_limit_reached", limit: MAX_IMAGES_PER_LISTING });

    const mediaId = randomUUID();
    const objectKey = `listings/${listing.id}/${mediaId}.${extensionForMime(body.data.mimeType)}`;
    const sortOrder = count * 10;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ListingMedia" ("id","listingId","objectKey","mimeType","sizeBytes","status","sortOrder","isCover","altText","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,'PENDING',$6,$7,$8,NOW(),NOW())`,
      mediaId, listing.id, objectKey, body.data.mimeType, body.data.sizeBytes, sortOrder, count === 0, body.data.altText ?? null,
    );

    return reply.code(201).send({
      mediaId,
      uploadUrl: await createPresignedUpload(objectKey, body.data.mimeType),
      method: "PUT",
      headers: { "content-type": body.data.mimeType },
      expiresInSeconds: 600,
    });
  });

  app.post("/listings/:id/media/:mediaId/confirm", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    if (!storageConfigured()) return reply.code(503).send({ error: "object_storage_not_configured" });

    const params = z.object({ id: z.string().min(1), mediaId: z.string().uuid() }).safeParse(request.params);
    const body = z.object({ width: z.number().int().positive().max(30000).nullish(), height: z.number().int().positive().max(30000).nullish() }).safeParse(request.body ?? {});
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });

    const rows = await prisma.$queryRawUnsafe<Array<{ objectKey: string; mimeType: string; sizeBytes: number }>>(
      `SELECT m."objectKey", m."mimeType", m."sizeBytes" FROM "ListingMedia" m JOIN "Listing" l ON l."id" = m."listingId" WHERE m."id" = $1 AND m."listingId" = $2 AND l."sellerId" = $3 LIMIT 1`,
      params.data.mediaId, params.data.id, user.id,
    );
    const media = rows[0];
    if (!media) return reply.code(404).send({ error: "media_not_found" });

    const stored = await verifyStoredObject(media.objectKey);
    if (!stored.sizeBytes || stored.sizeBytes > MAX_IMAGE_BYTES || stored.mimeType !== media.mimeType) {
      await prisma.$executeRawUnsafe(`UPDATE "ListingMedia" SET "status"='FAILED', "updatedAt"=NOW() WHERE "id"=$1`, params.data.mediaId);
      return reply.code(422).send({ error: "stored_media_mismatch" });
    }

    await makeStoredObjectPublic(media.objectKey);
    const publicUrl = publicObjectUrl(media.objectKey);
    await prisma.$executeRawUnsafe(
      `UPDATE "ListingMedia" SET "status"='READY', "publicUrl"=$2, "sizeBytes"=$3, "width"=$4, "height"=$5, "updatedAt"=NOW() WHERE "id"=$1`,
      params.data.mediaId, publicUrl, stored.sizeBytes, body.data.width ?? null, body.data.height ?? null,
    );
    return reply.send({ media: { id: params.data.mediaId, url: publicUrl, width: body.data.width ?? null, height: body.data.height ?? null } });
  });

  app.put("/listings/:id/media/order", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ mediaIds: z.array(z.string().uuid()).min(1).max(MAX_IMAGES_PER_LISTING), coverMediaId: z.string().uuid() }).safeParse(request.body);
    if (!params.success || !body.success || !body.data.mediaIds.includes(body.data.coverMediaId)) return reply.code(400).send({ error: "invalid_request" });

    const listing = await prisma.listing.findFirst({ where: { id: params.data.id, sellerId: user.id }, select: { id: true } });
    if (!listing) return reply.code(404).send({ error: "listing_not_found" });
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(`SELECT "id" FROM "ListingMedia" WHERE "listingId"=$1 AND "status"='READY'`, listing.id);
    const allowed = new Set(rows.map((row) => row.id));
    if (body.data.mediaIds.some((id) => !allowed.has(id))) return reply.code(400).send({ error: "media_not_in_listing" });

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`UPDATE "ListingMedia" SET "isCover"=FALSE WHERE "listingId"=$1`, listing.id);
      for (const [index, id] of body.data.mediaIds.entries()) {
        await tx.$executeRawUnsafe(`UPDATE "ListingMedia" SET "sortOrder"=$2, "isCover"=$3, "updatedAt"=NOW() WHERE "id"=$1`, id, index * 10, id === body.data.coverMediaId);
      }
    });
    return reply.send({ saved: true });
  });

  app.delete("/listings/:id/media/:mediaId", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const params = z.object({ id: z.string().min(1), mediaId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    const listing = await prisma.listing.findFirst({ where: { id: params.data.id, sellerId: user.id }, select: { id: true } });
    if (!listing) return reply.code(404).send({ error: "listing_not_found" });
    const rows = await prisma.$queryRawUnsafe<Array<{ objectKey:string }>>(`SELECT "objectKey" FROM "ListingMedia" WHERE "id"=$1 AND "listingId"=$2 LIMIT 1`, params.data.mediaId, listing.id);
    const media = rows[0];
    if (!media) return reply.code(404).send({ error: "media_not_found" });
    await prisma.$executeRawUnsafe(`DELETE FROM "ListingMedia" WHERE "id"=$1 AND "listingId"=$2`, params.data.mediaId, listing.id);
    const refs=await prisma.$queryRawUnsafe<Array<{count:bigint}>>(`SELECT COUNT(*)::bigint AS count FROM "ListingMedia" WHERE "objectKey"=$1`,media.objectKey).catch(()=>[]);
    if(Number(refs[0]?.count??0n)===0)await deleteStoredObject(media.objectKey).catch(()=>{});
    return reply.code(204).send();
  });
}
