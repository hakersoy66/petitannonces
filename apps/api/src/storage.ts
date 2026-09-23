import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectAclCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
}

function client() {
  return new S3Client({
    region: process.env.OBJECT_STORAGE_REGION ?? "auto",
    endpoint: required("OBJECT_STORAGE_ENDPOINT"),
    forcePathStyle: process.env.OBJECT_STORAGE_FORCE_PATH_STYLE === "true",
    credentials: {
      accessKeyId: required("OBJECT_STORAGE_ACCESS_KEY_ID"),
      secretAccessKey: required("OBJECT_STORAGE_SECRET_ACCESS_KEY"),
    },
  });
}

export function storageConfigured() {
  return Boolean(
    process.env.OBJECT_STORAGE_ENDPOINT &&
    process.env.OBJECT_STORAGE_BUCKET &&
    process.env.OBJECT_STORAGE_ACCESS_KEY_ID &&
    process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY &&
    process.env.OBJECT_STORAGE_PUBLIC_BASE_URL,
  );
}

export async function createPresignedUpload(objectKey: string, mimeType: string) {
  const bucket = required("OBJECT_STORAGE_BUCKET");
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: objectKey,
    ContentType: mimeType,
    CacheControl: "public, max-age=31536000, immutable",
  });
  return getSignedUrl(client(), command, { expiresIn: 600 });
}

export async function verifyStoredObject(objectKey: string) {
  const result = await client().send(new HeadObjectCommand({
    Bucket: required("OBJECT_STORAGE_BUCKET"),
    Key: objectKey,
  }));
  return { sizeBytes: Number(result.ContentLength ?? 0), mimeType: result.ContentType ?? null };
}


export async function readStoredObjectText(objectKey: string, maxBytes = 1024 * 1024) {
  const result = await client().send(new GetObjectCommand({ Bucket: required("OBJECT_STORAGE_BUCKET"), Key: objectKey }));
  if (!result.Body) throw new Error("stored_object_empty");
  const text = await result.Body.transformToString();
  if (Buffer.byteLength(text, "utf8") > maxBytes) throw new Error("stored_object_too_large");
  return text;
}

export async function readStoredObjectBuffer(objectKey: string, maxBytes = 5 * 1024 * 1024) {
  const result = await client().send(new GetObjectCommand({ Bucket: required("OBJECT_STORAGE_BUCKET"), Key: objectKey }));
  if (!result.Body) throw new Error("stored_object_empty");
  const bytes = await result.Body.transformToByteArray();
  if (bytes.byteLength > maxBytes) throw new Error("stored_object_too_large");
  return Buffer.from(bytes);
}

export function publicObjectUrl(objectKey: string) {
  return `${required("OBJECT_STORAGE_PUBLIC_BASE_URL").replace(/\/$/, "")}/${objectKey.split("/").map(encodeURIComponent).join("/")}`;
}

export async function createPresignedDownload(objectKey: string, fileName?: string | null, expiresIn = 120) {
  const safeName=(fileName ?? "justificatif").replace(/[\r\n"]/g,"_").slice(0,180);
  const command=new GetObjectCommand({
    Bucket: required("OBJECT_STORAGE_BUCKET"),
    Key: objectKey,
    ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`,
  });
  return getSignedUrl(client(),command,{expiresIn:Math.max(30,Math.min(300,expiresIn))});
}

export async function makeStoredObjectPrivate(objectKey:string){
  if(!objectAclEnabled())return;
  await client().send(new PutObjectAclCommand({Bucket:required("OBJECT_STORAGE_BUCKET"),Key:objectKey,ACL:"private"}));
}

function objectAclEnabled() {
  return process.env.OBJECT_STORAGE_USE_ACL === "true";
}

export async function makeStoredObjectPublic(objectKey: string) {
  if (!objectAclEnabled()) return;
  await client().send(new PutObjectAclCommand({
    Bucket: required("OBJECT_STORAGE_BUCKET"),
    Key: objectKey,
    ACL: "public-read",
  }));
}

export async function uploadStoredObject(objectKey: string, mimeType: string, body: Uint8Array) {
  await client().send(new PutObjectCommand({
    Bucket: required("OBJECT_STORAGE_BUCKET"),
    Key: objectKey,
    Body: body,
    ContentType: mimeType,
    CacheControl: "public, max-age=31536000, immutable",
    ...(objectAclEnabled() ? { ACL: "public-read" as const } : {}),
  }));
  return publicObjectUrl(objectKey);
}

export async function uploadPrivateStoredObject(objectKey:string,mimeType:string,body:Uint8Array){
  await client().send(new PutObjectCommand({
    Bucket:required("OBJECT_STORAGE_BUCKET"),
    Key:objectKey,
    Body:body,
    ContentType:mimeType,
    CacheControl:"private, no-store",
    ...(objectAclEnabled()?{ACL:"private" as const}:{}),
  }));
  return objectKey;
}

export async function deleteStoredObject(objectKey: string) {
  if (!storageConfigured()) return;
  await client().send(new DeleteObjectCommand({ Bucket: required("OBJECT_STORAGE_BUCKET"), Key: objectKey }));
}


export async function copyStoredObject(sourceKey:string,destinationKey:string){
  const bucket=required("OBJECT_STORAGE_BUCKET");
  const copySource=`${bucket}/${sourceKey.split("/").map(encodeURIComponent).join("/")}`;
  await client().send(new CopyObjectCommand({
    Bucket:bucket,
    Key:destinationKey,
    CopySource:copySource,
    CacheControl:"public, max-age=31536000, immutable",
    ...(objectAclEnabled()?{ACL:"public-read" as const}:{}),
  }));
  return publicObjectUrl(destinationKey);
}
