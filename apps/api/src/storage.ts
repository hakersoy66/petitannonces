import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
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
    ACL: "public-read",
  });
  return {
    url: await getSignedUrl(client(), command, { expiresIn: 600 }),
    headers: {
      "content-type": mimeType,
      "x-amz-acl": "public-read",
    },
  };
}

export async function verifyStoredObject(objectKey: string) {
  const result = await client().send(new HeadObjectCommand({
    Bucket: required("OBJECT_STORAGE_BUCKET"),
    Key: objectKey,
  }));
  return { sizeBytes: Number(result.ContentLength ?? 0), mimeType: result.ContentType ?? null };
}

export function publicObjectUrl(objectKey: string) {
  return `${required("OBJECT_STORAGE_PUBLIC_BASE_URL").replace(/\/$/, "")}/${objectKey.split("/").map(encodeURIComponent).join("/")}`;
}
