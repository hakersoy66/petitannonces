import { lookup } from "node:dns/promises";
import { randomUUID } from "node:crypto";
import net from "node:net";
import { prisma } from "@pa/database";
import { storageConfigured, uploadStoredObject } from "./storage.js";

const MAX_IMAGE_BYTES=15*1024*1024;
const MAX_IMAGES=20;
const IMAGE_TYPES=new Map([["image/jpeg","jpg"],["image/png","png"],["image/webp","webp"],["image/avif","avif"]]);

function isPrivateIp(ip:string){
 if(net.isIPv4(ip)){const p=ip.split(".").map(Number);const a=p[0]??-1,b=p[1]??-1;return a===10||a===127||a===0||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127)}
 if(net.isIPv6(ip)){const v=ip.toLowerCase();return v==="::1"||v.startsWith("fc")||v.startsWith("fd")||v.startsWith("fe80:")}
 return true;
}

async function safePublicUrl(raw:string){
 const u=new URL(raw);if(u.protocol!=="https:"&&u.protocol!=="http:")throw new Error("unsupported_image_url");
 if(["localhost","0.0.0.0"].includes(u.hostname.toLowerCase()))throw new Error("unsafe_image_url");
 const addresses=await lookup(u.hostname,{all:true,verbatim:true});if(!addresses.length||addresses.some(a=>isPrivateIp(a.address)))throw new Error("unsafe_image_url");
 return u;
}

async function fetchImage(raw:string){
 let current=(await safePublicUrl(raw)).toString();
 for(let redirects=0;redirects<4;redirects++){
  const r=await fetch(current,{redirect:"manual",headers:{"user-agent":"PetitAnnonces-ProFeed/1.0",accept:"image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8"},signal:AbortSignal.timeout(15000)});
  if(r.status>=300&&r.status<400){const location=r.headers.get("location");if(!location)throw new Error(`image_http_${r.status}`);current=(await safePublicUrl(new URL(location,current).toString())).toString();continue}
  if(!r.ok)throw new Error(`image_http_${r.status}`);
  const type=(r.headers.get("content-type")??"").split(";")[0]!.trim().toLowerCase();const ext=IMAGE_TYPES.get(type);if(!ext)throw new Error("unsupported_image_type");
  const declared=Number(r.headers.get("content-length")??0);if(declared>MAX_IMAGE_BYTES)throw new Error("image_too_large");
  const reader=r.body?.getReader();if(!reader)throw new Error("image_empty");let total=0;const chunks:Uint8Array[]=[];
  while(true){const {done,value}=await reader.read();if(done)break;if(!value)continue;total+=value.length;if(total>MAX_IMAGE_BYTES){await reader.cancel().catch(()=>undefined);throw new Error("image_too_large")}chunks.push(value)}
  if(total===0)throw new Error("image_empty");return{type,ext,buffer:new Uint8Array(Buffer.concat(chunks.map(c=>Buffer.from(c))))};
 }
 throw new Error("too_many_image_redirects");
}

export function normalizeProfessionalImageUrls(value:unknown){
 const raw=Array.isArray(value)?value:String(value??"").split(/\s*\|\s*|\r?\n/);
 return [...new Set(raw.map(x=>String(x??"").trim()).filter(Boolean))].slice(0,MAX_IMAGES);
}

export async function importProfessionalListingImages(listingId:string,urls:string[]){
 const unique=normalizeProfessionalImageUrls(urls);if(!unique.length)return{imported:0,failed:0,errors:[] as string[]};
 if(!storageConfigured())return{imported:0,failed:unique.length,errors:["object_storage_not_configured"]};
 let imported=0;const errors:string[]=[];
 for(const [index,url] of unique.entries()){
  try{
   const image=await fetchImage(url);const mediaId=randomUUID();const objectKey=`listings/${listingId}/${mediaId}.${image.ext}`;const publicUrl=await uploadStoredObject(objectKey,image.type,image.buffer);
   await prisma.$executeRawUnsafe(`INSERT INTO "ListingMedia" ("id","listingId","objectKey","publicUrl","mimeType","sizeBytes","status","sortOrder","isCover","altText","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,'READY',$7,$8,$9,NOW(),NOW())`,mediaId,listingId,objectKey,publicUrl,image.type,image.buffer.length,index*10,index===0,"Photo importée via feed professionnel");
   imported++;
  }catch(error){errors.push(error instanceof Error?error.message:"image_import_failed")}
 }
 return{imported,failed:unique.length-imported,errors:[...new Set(errors)].slice(0,5)};
}
