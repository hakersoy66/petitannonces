import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "@pa/database";
import { getHbxHotelsRuntime } from "./admin-control.js";
import { deliverUserEvent } from "./notification-delivery.js";

type Timed<T>={expires:number;value:T};
type HbxDestination={code:string;name:string;countryCode:string};
type HbxHotel={
  code:number;
  name:string;
  destinationCode:string;
  destinationName:string|null;
  city:string|null;
  countryCode:string|null;
  categoryCode:string|null;
  categoryName:string|null;
  stars:number|null;
  address:string|null;
  postalCode:string|null;
  description:string|null;
  imageUrl:string|null;
  latitude:number|null;
  longitude:number|null;
};
type HbxLiveRate={hotelCode:number;displayRate:number;netRate:number;sellingRate:number|null;maxRate:number|null;currency:string;priceSource:"sellingRate"|"net";hotelMandatory:boolean|null;roomName:string|null;boardName:string|null;rateClass:string|null;rateType:string|null;requiresCheckRate:boolean;paymentType:string|null;rateKey:string|null;cancellationFrom:string|null;cancellationAmount:number|null};

const destinationCache=new Map<string,Timed<HbxDestination[]>>();
const hotelCache=new Map<string,Timed<HbxHotel[]>>();

async function ensureHbxContentCacheSchema(){await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "HbxContentCache" (
  "key" TEXT PRIMARY KEY,
  "payload" JSONB NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
)`)}
async function readPersistentCache<T>(key:string,allowExpired=false):Promise<T|null>{
  const rows=allowExpired?await prisma.$queryRawUnsafe<Array<{payload:T}>>(`SELECT "payload" FROM "HbxContentCache" WHERE "key"=$1 LIMIT 1`,key):await prisma.$queryRawUnsafe<Array<{payload:T}>>(`SELECT "payload" FROM "HbxContentCache" WHERE "key"=$1 AND "expiresAt">CURRENT_TIMESTAMP LIMIT 1`,key);
  return rows[0]?.payload??null;
}
async function writePersistentCache(key:string,payload:unknown,ttlMs:number){await prisma.$executeRawUnsafe(`INSERT INTO "HbxContentCache" ("key","payload","expiresAt","updatedAt") VALUES ($1,$2::jsonb,CURRENT_TIMESTAMP+($3::text||' milliseconds')::interval,CURRENT_TIMESTAMP) ON CONFLICT ("key") DO UPDATE SET "payload"=EXCLUDED."payload","expiresAt"=EXCLUDED."expiresAt","updatedAt"=CURRENT_TIMESTAMP`,key,JSON.stringify(payload),ttlMs)}

function contentText(value:unknown):string|null{
  if(typeof value==="string")return value.trim()||null;
  if(value&&typeof value==="object"){
    const obj=value as Record<string,unknown>;
    for(const key of ["content","name","description"]){
      const v=obj[key];
      if(typeof v==="string"&&v.trim())return v.trim();
      if(v&&typeof v==="object"&&typeof (v as Record<string,unknown>).content==="string"){
        const t=String((v as Record<string,unknown>).content).trim();
        if(t)return t;
      }
    }
  }
  return null;
}
function starsFromCategory(code:unknown){
  const m=String(code??"").match(/^([1-5])/);
  return m?Number(m[1]):null;
}
function hbxMtlsHost(environment:string){return environment==="live"?"api-mtls.hotelbeds.com":"api-mtls.test.hotelbeds.com"}
async function hbxMtlsRequest(method:"GET"|"POST"|"DELETE",path:string,body?:unknown,timeoutMs=20_000){
  const runtime=await getHbxHotelsRuntime();
  if(!runtime?.apiKey||!runtime.secret)throw new Error("hbx_not_configured");
  const baseDir="/var/www/petitannonces/shared/hbx-mtls";
  let cert:Buffer,key:Buffer,passphrase:string;
  try{[cert,key,passphrase]=await Promise.all([readFile(baseDir+"/hbx-client.crt"),readFile(baseDir+"/hbx-client.key"),readFile(baseDir+"/hbx-client.pass","utf8")])}catch{throw new Error("hbx_mtls_certificate_missing")}
  const timestamp=Math.floor(Date.now()/1000);
  const signature=createHash("sha256").update(runtime.apiKey+runtime.secret+String(timestamp)).digest("hex");
  const payload=body===undefined?"":JSON.stringify(body);
  const headers:Record<string,string|number>={"Api-key":runtime.apiKey,"X-Signature":signature,Accept:"application/json","Accept-Encoding":"gzip"};
  if(payload){headers["Content-Type"]="application/json";headers["Content-Length"]=Buffer.byteLength(payload)}
  return new Promise<any>((resolve,reject)=>{
    const req=httpsRequest({hostname:hbxMtlsHost(runtime.environment),port:443,path,method,cert,key,passphrase:passphrase.trim(),headers,timeout:timeoutMs},res=>{
      const chunks:Buffer[]=[];res.on("data",chunk=>chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk)));res.on("end",()=>{
        const raw=Buffer.concat(chunks).toString("utf8");let parsed:any=null;try{parsed=raw?JSON.parse(raw):null}catch{parsed=null}
        const status=res.statusCode??500;if(status<200||status>=300){const detail=String(parsed?.error?.message??parsed?.error?.code??parsed?.message??parsed?.errors?.[0]?.text??raw??"").slice(0,500);reject(new Error(`hbx_mtls_${status}_${detail||"request_failed"}`));return}resolve(parsed);
      });
    });
    req.on("timeout",()=>req.destroy(new Error("hbx_mtls_timeout")));req.on("error",reject);if(payload)req.write(payload);req.end();
  });
}
async function hbxMtlsPost(path:string,body:unknown){return hbxMtlsRequest("POST",path,body,20_000)}
function cheapestLiveRate(hotel:any):HbxLiveRate|null{
  const rates=(Array.isArray(hotel?.rooms)?hotel.rooms:[]).flatMap((room:any)=>(Array.isArray(room?.rates)?room.rates:[]).map((rate:any)=>({room,rate,display:Number.isFinite(Number(rate?.sellingRate))?Number(rate.sellingRate):Number(rate?.net)}))).filter((x:any)=>Number.isFinite(x.display)&&Number.isFinite(Number(x.rate?.net)));
  if(!rates.length)return null;rates.sort((a:any,b:any)=>a.display-b.display);const first=rates[0];const cancellations=Array.isArray(first.rate?.cancellationPolicies)?first.rate.cancellationPolicies:[];const cp=cancellations[0]??null;
  const selling=Number.isFinite(Number(first.rate?.sellingRate))?Number(first.rate.sellingRate):null;const rateType=String(first.rate?.rateType??"").trim().toUpperCase()||null;
  return{hotelCode:Number(hotel.code),displayRate:first.display,netRate:Number(first.rate.net),sellingRate:selling,maxRate:Number.isFinite(Number(hotel?.maxRate))?Number(hotel.maxRate):null,currency:String(hotel?.currency??first.rate?.hotelCurrency??"EUR"),priceSource:selling!=null?"sellingRate":"net",hotelMandatory:typeof first.rate?.hotelMandatory==="boolean"?first.rate.hotelMandatory:null,roomName:String(first.room?.name??"").trim()||null,boardName:String(first.rate?.boardName??"").trim()||null,rateClass:String(first.rate?.rateClass??"").trim().toUpperCase()||null,rateType,requiresCheckRate:rateType==="RECHECK",paymentType:String(first.rate?.paymentType??"").trim()||null,rateKey:String(first.rate?.rateKey??"").trim()||null,cancellationFrom:cp?.from?String(cp.from):null,cancellationAmount:Number.isFinite(Number(cp?.amount))?Number(cp.amount):null};
}
type HbxPublicRate={displayRate:number;netRate:number;sellingRate:number|null;maxRate:number|null;currency:string;priceSource:"sellingRate"|"net";hotelMandatory:boolean|null;roomName:string|null;boardName:string|null;rateClass:string|null;rateType:string|null;requiresCheckRate:boolean;paymentType:string|null;cancellationFrom:string|null;cancellationAmount:number|null};
type HbxOfferTokenPayload={rateKey:string;hotelCode:number;checkIn:string;checkOut:string;guests:number;requiresCheckRate:boolean;publicRate:HbxPublicRate;exp:number};
function offerTokenKey(secret:string){return createHash("sha256").update("pa:hbx:offer:v2:"+secret).digest()}
function sealOfferToken(payload:HbxOfferTokenPayload,secret:string){
  const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",offerTokenKey(secret),iv);const plain=Buffer.from(JSON.stringify(payload),"utf8");const encrypted=Buffer.concat([cipher.update(plain),cipher.final()]);const tag=cipher.getAuthTag();return [iv,tag,encrypted].map(x=>x.toString("base64url")).join(".");
}
function openOfferToken(token:string,secret:string):HbxOfferTokenPayload|null{
  try{const [ivRaw,tagRaw,dataRaw]=token.split(".");if(!ivRaw||!tagRaw||!dataRaw)return null;const iv=Buffer.from(ivRaw,"base64url"),tag=Buffer.from(tagRaw,"base64url"),data=Buffer.from(dataRaw,"base64url");const decipher=createDecipheriv("aes-256-gcm",offerTokenKey(secret),iv);decipher.setAuthTag(tag);const plain=Buffer.concat([decipher.update(data),decipher.final()]);const parsed=JSON.parse(plain.toString("utf8")) as HbxOfferTokenPayload;if(!parsed?.rateKey||!parsed?.publicRate||!Number.isFinite(parsed.hotelCode)||!Number.isFinite(parsed.exp)||parsed.exp<Date.now())return null;return parsed}catch{return null}
}
function normalizeCheckedRate(payload:any){
  const hotel=Array.isArray(payload?.hotel?.rooms)?payload.hotel:Array.isArray(payload?.hotels?.hotels)?payload.hotels.hotels[0]:payload?.hotel??null;
  const room=Array.isArray(hotel?.rooms)?hotel.rooms[0]:null;const rate=Array.isArray(room?.rates)?room.rates[0]:null;if(!rate)return null;
  const selling=Number.isFinite(Number(rate?.sellingRate))?Number(rate.sellingRate):null;const net=Number(rate?.net);const display=selling??net;const cancellations=Array.isArray(rate?.cancellationPolicies)?rate.cancellationPolicies:[];
  return{roomName:String(room?.name??"").trim()||null,boardName:String(rate?.boardName??"").trim()||null,rateType:String(rate?.rateType??"").trim().toUpperCase()||null,rateClass:String(rate?.rateClass??"").trim().toUpperCase()||null,paymentType:String(rate?.paymentType??"").trim()||null,displayRate:Number.isFinite(display)?display:null,netRate:Number.isFinite(net)?net:null,sellingRate:selling,currency:String(hotel?.currency??rate?.hotelCurrency??"EUR"),hotelMandatory:typeof rate?.hotelMandatory==="boolean"?rate.hotelMandatory:null,rateComments:String(rate?.rateComments??"").trim()||null,cancellationPolicies:cancellations.map((x:any)=>({amount:Number.isFinite(Number(x?.amount))?Number(x.amount):null,from:x?.from?String(x.from):null})),rateKey:String(rate?.rateKey??"").trim()||null};
}

async function getLiveAvailability(hotelCodes:number[],checkIn:string,checkOut:string,guests:number){
  if(!hotelCodes.length)return new Map<number,HbxLiveRate>();
  const signature=createHash("sha256").update([...hotelCodes].sort((a,b)=>a-b).join(",")).digest("hex").slice(0,20);
  const cacheKey=`availability:${checkIn}:${checkOut}:${guests}:${signature}`;
  const cached=await readPersistentCache<Array<[number,HbxLiveRate]>>(cacheKey);
  if(cached)return new Map<number,HbxLiveRate>(cached);
  const payload=await hbxMtlsPost("/hotel-api/1.0/hotels",{stay:{checkIn,checkOut},occupancies:[{rooms:1,adults:guests,children:0}],hotels:{hotel:hotelCodes}});
  const rows=Array.isArray(payload?.hotels?.hotels)?payload.hotels.hotels:[];const map=new Map<number,HbxLiveRate>();for(const hotel of rows){const rate=cheapestLiveRate(hotel);if(rate)map.set(rate.hotelCode,rate)}
  await writePersistentCache(cacheKey,[...map.entries()],5*60*1000);
  return map;
}

async function hbxGet(path:string){
  const runtime=await getHbxHotelsRuntime();
  if(!runtime?.apiKey||!runtime.secret)throw new Error("hbx_not_configured");
  const timestamp=Math.floor(Date.now()/1000);
  const signature=createHash("sha256").update(runtime.apiKey+runtime.secret+String(timestamp)).digest("hex");
  const response=await fetch(runtime.baseUrl+path,{headers:{"Api-key":runtime.apiKey,"X-Signature":signature,Accept:"application/json","Accept-Encoding":"gzip"}});
  const raw=await response.text();
  let payload:any=null;
  try{payload=raw?JSON.parse(raw):null}catch{payload=null}
  if(!response.ok){
    const detail=String(payload?.error?.message??payload?.error?.code??payload?.message??raw??"").slice(0,220);
    throw new Error(`hbx_${response.status}_${detail||"request_failed"}`);
  }
  return payload;
}
function normalizeDestination(row:any):HbxDestination|null{
  const code=String(row?.code??"").trim();
  const name=contentText(row?.name)??contentText(row?.description);
  const countryCode=String(row?.countryCode??row?.country?.code??"").trim().toUpperCase();
  return code&&name?{code,name,countryCode}:null;
}
async function getDestinations(countryCode="FR"){
  const key=countryCode.toUpperCase(),cacheKey=`destinations:${key}`;
  const cached=destinationCache.get(key);if(cached&&cached.expires>Date.now())return cached.value;
  const persisted=await readPersistentCache<HbxDestination[]>(cacheKey);if(persisted){destinationCache.set(key,{expires:Date.now()+12*60*60*1000,value:persisted});return persisted}
  const stale=await readPersistentCache<HbxDestination[]>(cacheKey,true);
  try{
    const query=new URLSearchParams({"fields":"all","language":"ENG","countryCodes":key,"from":"1","to":"1000","useSecondaryLanguage":"true"});
    const payload=await hbxGet(`/hotel-content-api/1.0/locations/destinations?${query.toString()}`);
    const rows=Array.isArray(payload?.destinations)?payload.destinations:[];const value=rows.map(normalizeDestination).filter(Boolean) as HbxDestination[];
    destinationCache.set(key,{expires:Date.now()+12*60*60*1000,value});await writePersistentCache(cacheKey,value,7*24*60*60*1000);return value;
  }catch(error){if(stale?.length){destinationCache.set(key,{expires:Date.now()+60*60*1000,value:stale});return stale}throw error}
}
function normalizeHotel(row:any,destinationName:string|null):HbxHotel|null{
  const code=Number(row?.code);
  const name=contentText(row?.name);
  if(!Number.isFinite(code)||!name)return null;
  const images=Array.isArray(row?.images)?[...row.images]:[];
  images.sort((a:any,b:any)=>(Number(a?.visualOrder??9999)-Number(b?.visualOrder??9999))||(Number(a?.order??9999)-Number(b?.order??9999)));
  const imagePath=String(images.find((x:any)=>String(x?.path??"").trim())?.path??"").trim().replace(/^\/+/,"");
  const categoryCode=String(row?.categoryCode??row?.category?.code??"").trim()||null;
  const categoryName=contentText(row?.categoryName)??contentText(row?.category?.description)??contentText(row?.category);
  const lat=Number(row?.coordinates?.latitude),lon=Number(row?.coordinates?.longitude);
  return{
    code,
    name,
    destinationCode:String(row?.destinationCode??"").trim(),
    destinationName,
    city:contentText(row?.city)??destinationName,
    countryCode:String(row?.countryCode??"").trim().toUpperCase()||null,
    categoryCode,
    categoryName,
    stars:starsFromCategory(categoryCode),
    address:contentText(row?.address),
    postalCode:String(row?.postalCode??"").trim()||null,
    description:contentText(row?.description),
    imageUrl:imagePath?`https://photos.hotelbeds.com/giata/bigger/${imagePath}`:null,
    latitude:Number.isFinite(lat)?lat:null,
    longitude:Number.isFinite(lon)?lon:null,
  };
}
async function getHotels(destination:HbxDestination,limit:number){
  const key=destination.code,cacheKey=`hotels:${destination.code}`;
  const cached=hotelCache.get(key);if(cached&&cached.expires>Date.now())return cached.value.slice(0,limit);
  const persisted=await readPersistentCache<HbxHotel[]>(cacheKey);if(persisted){hotelCache.set(key,{expires:Date.now()+24*60*60*1000,value:persisted});return persisted.slice(0,limit)}
  const stale=await readPersistentCache<HbxHotel[]>(cacheKey,true);
  try{
    const query=new URLSearchParams({fields:"all",language:"ENG",destinationCode:destination.code,from:"1",to:"200",useSecondaryLanguage:"true"});
    const payload=await hbxGet(`/hotel-content-api/1.0/hotels?${query.toString()}`);const rows=Array.isArray(payload?.hotels)?payload.hotels:[];const value=rows.map((row:any)=>normalizeHotel(row,destination.name)).filter(Boolean) as HbxHotel[];
    hotelCache.set(key,{expires:Date.now()+24*60*60*1000,value});await writePersistentCache(cacheKey,value,7*24*60*60*1000);return value.slice(0,limit);
  }catch(error){if(stale?.length){hotelCache.set(key,{expires:Date.now()+60*60*1000,value:stale});return stale.slice(0,limit)}throw error}
}
function imageUrl(pathValue:unknown){const path=String(pathValue??"").trim().replace(/^\/+/,"");return path?`https://photos.hotelbeds.com/giata/bigger/${path}`:null}
async function getHotelDetail(code:number){
  const cacheKey=`hotel-detail:${code}`;const persisted=await readPersistentCache<any>(cacheKey);if(persisted)return persisted;const stale=await readPersistentCache<any>(cacheKey,true);
  const attempts=[`/hotel-content-api/1.0/hotels/${code}/details?language=ENG&useSecondaryLanguage=true`,`/hotel-content-api/1.0/hotels/${code}?language=ENG&useSecondaryLanguage=true`];
  let payload:any=null,lastError:unknown=null;for(const path of attempts){try{payload=await hbxGet(path);if(payload)break}catch(error){lastError=error}}
  if(!payload){if(stale)return stale;throw lastError instanceof Error?lastError:new Error("hbx_hotel_detail_failed")}
  const row=payload?.hotel??payload?.hotels?.[0]??payload;
  const codeValue=Number(row?.code??code);const name=contentText(row?.name)??`Hôtel ${code}`;
  const images=(Array.isArray(row?.images)?row.images:[]).map((x:any)=>({url:imageUrl(x?.path),typeCode:String(x?.imageTypeCode??"").trim()||null,order:Number(x?.visualOrder??x?.order??9999)})).filter((x:any)=>x.url).sort((a:any,b:any)=>a.order-b.order).slice(0,14);
  const facilities=(Array.isArray(row?.facilities)?row.facilities:[]).filter((x:any)=>x?.indLogic!==false&&x?.indYesOrNo!==false).map((x:any)=>({name:contentText(x?.description)??`Équipement ${x?.facilityCode??""}`,fee:x?.indFee===true,amount:Number.isFinite(Number(x?.amount))?Number(x.amount):null,currency:String(x?.currency??"").trim()||null})).slice(0,30);
  const phones=(Array.isArray(row?.phones)?row.phones:[]).map((x:any)=>String(x?.phoneNumber??x?.number??"").trim()).filter(Boolean).slice(0,3);
  const lat=Number(row?.coordinates?.latitude),lon=Number(row?.coordinates?.longitude);const categoryCode=String(row?.categoryCode??row?.category?.code??"").trim()||null;
  const value={code:codeValue,name,destinationCode:String(row?.destinationCode??"").trim()||null,city:contentText(row?.city),countryCode:String(row?.countryCode??"").trim().toUpperCase()||null,categoryCode,categoryName:contentText(row?.categoryName)??contentText(row?.category?.description)??contentText(row?.category),stars:starsFromCategory(categoryCode),address:contentText(row?.address),postalCode:String(row?.postalCode??"").trim()||null,description:contentText(row?.description),images,facilities,phones,latitude:Number.isFinite(lat)?lat:null,longitude:Number.isFinite(lon)?lon:null,checkIn:contentText(row?.checkIn),checkOut:contentText(row?.checkOut)};await writePersistentCache(cacheKey,value,30*24*60*60*1000);return value;
}
function bookingTokenFrom(base:HbxOfferTokenPayload,publicRate:HbxPublicRate,rateKey:string,secret:string){return sealOfferToken({rateKey,hotelCode:base.hotelCode,checkIn:base.checkIn,checkOut:base.checkOut,guests:base.guests,requiresCheckRate:false,publicRate,exp:Date.now()+20*60*1000},secret)}

function normalizeSearch(value:string){
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
}
function destinationScore(destination:HbxDestination,query:string){
  const n=normalizeSearch(destination.name),q=normalizeSearch(query);
  if(!q||!n)return 0;
  if(n===q)return 100;
  const qTokens=q.split(/\s+/).filter(Boolean),nTokens=n.split(/\s+/).filter(Boolean);
  if(n.startsWith(q+" ")||n.endsWith(" "+q))return 92;
  if(n.includes(q))return 88;
  const matched=qTokens.filter(token=>token.length>=3&&nTokens.some(candidate=>candidate===token||candidate.startsWith(token)||token.startsWith(candidate)));
  const coverage=qTokens.length?matched.length/qTokens.length:0;
  if(coverage===1&&qTokens.length>1)return 82;
  if(coverage>=0.66&&matched.length>=2)return 70;
  return 0;
}

const HBX_SESSION_COOKIE="pa_session";
function bearerToken(request:FastifyRequest){const value=request.headers.authorization;if(typeof value!=="string")return null;const m=/^Bearer\s+(.+)$/i.exec(value.trim());return m?.[1]?.trim()||null}
async function requireHbxUser(request:FastifyRequest,reply:FastifyReply){const token=bearerToken(request)??request.cookies[HBX_SESSION_COOKIE];if(!token){reply.code(401).send({error:"unauthorized"});return null}const tokenHash=createHash("sha256").update(token).digest("hex");const session=await prisma.session.findUnique({where:{tokenHash},include:{user:true}});if(!session||session.revokedAt||session.expiresAt<=new Date()||session.user.status!=="ACTIVE"){reply.code(401).send({error:"unauthorized"});return null}return session.user}
async function requireHbxAdmin(request:FastifyRequest,reply:FastifyReply){const user=await requireHbxUser(request,reply);if(!user)return null;const roles=await prisma.$queryRawUnsafe<Array<{role:string}>>(`SELECT "role"::text AS "role" FROM "UserAdminRole" WHERE "userId"=$1`,user.id);const allowed=new Set(["SUPER_ADMIN","ADMIN","SUPPORT","FINANCE"]);if(!roles.some(r=>allowed.has(r.role))){reply.code(403).send({error:"forbidden"});return null}return user}
async function ensureHbxBookingSchema(){await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "HbxHotelBooking" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL UNIQUE,
  "providerReference" TEXT UNIQUE,
  "clientReference" TEXT NOT NULL UNIQUE,
  "hotelCode" INTEGER NOT NULL,
  "hotelName" TEXT,
  "city" TEXT,
  "imageUrl" TEXT,
  "checkIn" DATE NOT NULL,
  "checkOut" DATE NOT NULL,
  "guests" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "environment" TEXT NOT NULL,
  "currency" TEXT,
  "total" DOUBLE PRECISION,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);await prisma.$executeRawUnsafe(`ALTER TABLE "HbxHotelBooking" ADD COLUMN IF NOT EXISTS "hotelName" TEXT`);await prisma.$executeRawUnsafe(`ALTER TABLE "HbxHotelBooking" ADD COLUMN IF NOT EXISTS "city" TEXT`);await prisma.$executeRawUnsafe(`ALTER TABLE "HbxHotelBooking" ADD COLUMN IF NOT EXISTS "imageUrl" TEXT`)}
function normalizeHotelBooking(payload:any){const b=payload?.booking??(Array.isArray(payload?.bookings)?payload.bookings[0]:null)??payload?.bookings?.booking??null;if(!b)return null;const hotel=b?.hotel??null;return{reference:String(b?.reference??"").trim()||null,status:String(b?.status??"").trim().toUpperCase()||null,clientReference:String(b?.clientReference??"").trim()||null,currency:String(b?.currency??hotel?.currency??"").trim()||null,total:Number.isFinite(Number(b?.totalNet??b?.total??hotel?.totalNet??hotel?.total))?Number(b?.totalNet??b?.total??hotel?.totalNet??hotel?.total):null,hotelName:String(hotel?.name??"").trim()||null,hotelCode:Number.isFinite(Number(hotel?.code))?Number(hotel.code):null,checkIn:String(hotel?.checkIn??"").trim()||null,checkOut:String(hotel?.checkOut??"").trim()||null};}
function bookingListRows(payload:any){const value=payload?.bookings?.bookings??payload?.bookings?.booking??payload?.bookings??[];return Array.isArray(value)?value:value?[value]:[]}
async function refreshHbxBookingRow(row:any){
  const runtime=await getHbxHotelsRuntime();if(!runtime?.secret)throw new Error("hbx_not_configured");
  let normalized:any=null;
  if(row.providerReference){const payload=await hbxMtlsRequest("GET",`/hotel-api/1.0/bookings/${encodeURIComponent(row.providerReference)}?language=ENG`,undefined,30_000);normalized=normalizeHotelBooking(payload)}
  else{
    const created=new Date(row.createdAt);const start=new Date(created.getTime()-24*60*60*1000).toISOString().slice(0,10);const end=new Date(created.getTime()+24*60*60*1000).toISOString().slice(0,10);const q=new URLSearchParams({start,end,filterType:"CREATION",status:"ALL",from:"1",to:"25",clientReference:String(row.clientReference)});const payload=await hbxMtlsRequest("GET",`/hotel-api/1.0/bookings?${q.toString()}`,undefined,30_000);const match=bookingListRows(payload).find((b:any)=>String(b?.clientReference??"").trim()===String(row.clientReference));normalized=match?normalizeHotelBooking({booking:match}):null;
  }
  if(!normalized?.reference)return null;
  const detail=normalized.hotelName?null:await getHotelDetail(Number(normalized.hotelCode??row.hotelCode)).catch(()=>null);
  const hotelName=normalized.hotelName??detail?.name??row.hotelName??null,city=detail?.city??row.city??null,imageUrl=detail?.images?.[0]?.url??row.imageUrl??null;
  await prisma.$executeRawUnsafe(`UPDATE "HbxHotelBooking" SET "providerReference"=$2,"status"=COALESCE($3,"status"),"currency"=COALESCE($4,"currency"),"total"=COALESCE($5,"total"),"hotelName"=COALESCE($6,"hotelName"),"city"=COALESCE($7,"city"),"imageUrl"=COALESCE($8,"imageUrl"),"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,row.id,normalized.reference,normalized.status,normalized.currency,normalized.total,hotelName,city,imageUrl);
  return{...normalized,hotelName,city,imageUrl};
}

export function startHbxContentRefreshWorker(log?:{info:(value:unknown,message?:string)=>void;error:(value:unknown,message?:string)=>void}){
  const intervalMs=Math.max(60*60_000,Number(process.env.HBX_CONTENT_REFRESH_INTERVAL_MS??6*60*60_000));
  let running=false,quotaBackoffUntil=0;
  const run=async()=>{
    if(running||Date.now()<quotaBackoffUntil)return;running=true;
    try{
      const runtime=await getHbxHotelsRuntime();if(!runtime?.secret)return;
      const cached=await readPersistentCache<HbxHotel[]>("hotels:PAR",true);
      if(cached?.length&&cached.some(h=>Boolean(h.imageUrl))){return}
      try{
        const destinations=await getDestinations("FR");
        const paris=destinations.find(d=>d.code==="PAR")??destinations.find(d=>normalizeSearch(d.name)==="paris");
        if(!paris){log?.error({country:"FR"},"HBX Paris destination not found during content refresh");return}
        const hotels=await getHotels(paris,200);
        const imageCount=hotels.filter(h=>Boolean(h.imageUrl)).length;
        log?.info({hotels:hotels.length,images:imageCount},"HBX Paris content cache refreshed");
      }catch(error){const detail=String(error instanceof Error?error.message:error);if(/quota exceeded/i.test(detail)){quotaBackoffUntil=Date.now()+6*60*60_000;log?.info({until:new Date(quotaBackoffUntil).toISOString()},"HBX content refresh paused: quota exceeded");return}throw error}
    }catch(error){log?.error({error:String(error instanceof Error?error.message:error).slice(0,300)},"HBX content refresh worker error")}finally{running=false}
  };
  const first=setTimeout(()=>void run(),30*60_000);first.unref();const timer=setInterval(()=>void run(),intervalMs);timer.unref();return timer;
}

export function startHbxBookingReconciliationWorker(log?:{info:(value:unknown,message?:string)=>void;error:(value:unknown,message?:string)=>void}){
  const intervalMs=Math.max(5*60_000,Number(process.env.HBX_BOOKING_SYNC_INTERVAL_MS??15*60_000));
  let running=false,quotaBackoffUntil=0;
  const run=async()=>{
    if(running||Date.now()<quotaBackoffUntil)return;running=true;
    try{
      const runtime=await getHbxHotelsRuntime();if(!runtime?.secret)return;
      const rows=await prisma.$queryRawUnsafe<Array<any>>(`SELECT * FROM "HbxHotelBooking" WHERE "status" IN ('PENDING','UNKNOWN') AND "environment"=$1 AND "updatedAt"<CURRENT_TIMESTAMP-INTERVAL '5 minutes' ORDER BY "updatedAt" ASC LIMIT 8`,runtime.environment);
      if(!rows.length)return;
      let synced=0;
      for(const row of rows){
        try{
          const beforeStatus=String(row.status??"");const beforeReference=String(row.providerReference??"");const booking=await refreshHbxBookingRow(row);if(!booking)continue;synced++;
          const changed=beforeStatus!==String(booking.status??"")||beforeReference!==String(booking.reference??"");
          if(changed&&row.userId&&booking.reference){await deliverUserEvent({userId:row.userId,eventKind:"LISTING",notificationKind:"SYSTEM",title:"Mise à jour de votre réservation hôtel",body:`Votre réservation ${booking.reference} est maintenant au statut ${booking.status??"mis à jour"}.`,actionUrl:`/mon-compte/reservations/hbx/${encodeURIComponent(booking.reference)}`,transactional:true,forceInApp:true,forcePush:true,dedupeKey:`hbx-booking:${booking.reference}:auto-sync:${String(booking.status??"updated").toLowerCase()}`,metadata:{provider:"HBX",providerReference:booking.reference,status:booking.status,transactional:true}}).catch(()=>undefined)}
        }catch(error){const detail=String(error instanceof Error?error.message:error);if(/quota exceeded/i.test(detail)){quotaBackoffUntil=Date.now()+6*60*60_000;log?.info({until:new Date(quotaBackoffUntil).toISOString()},"HBX booking sync paused: quota exceeded");break}log?.error({error:detail.slice(0,300),bookingId:row.id},"HBX booking reconciliation failed")}
      }
      if(synced)log?.info({synced},"HBX booking reconciliation completed");
    }catch(error){log?.error({error:String(error instanceof Error?error.message:error).slice(0,300)},"HBX booking reconciliation worker error")}finally{running=false}
  };
  const first=setTimeout(()=>void run(),45_000);first.unref();const timer=setInterval(()=>void run(),intervalMs);timer.unref();return timer;
}

export async function registerHbxHotelRoutes(app:FastifyInstance){
  await ensureHbxBookingSchema();
  await ensureHbxContentCacheSchema();
  app.get("/vacances/hbx/search",async(request,reply)=>{
    const parsed=z.object({city:z.string().trim().min(2).max(120),countryCode:z.string().trim().length(2).default("FR"),limit:z.coerce.number().int().min(1).max(24).default(12),checkIn:z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),checkOut:z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),guests:z.coerce.number().int().min(1).max(12).default(1)}).safeParse(request.query);
    if(!parsed.success)return reply.code(400).send({error:"invalid_hbx_search"});
    try{
      const destinations=await getDestinations(parsed.data.countryCode);
      const ranked=destinations.map(destination=>({destination,score:destinationScore(destination,parsed.data.city)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.destination.name.localeCompare(b.destination.name,"fr"));
      const selected=ranked[0]?.destination??null;
      if(!selected)return reply.send({provider:"HBX",environment:"test",destination:null,total:0,items:[],availability:{ready:false,reason:"destination_not_found"}});
      const datesReady=Boolean(parsed.data.checkIn&&parsed.data.checkOut&&parsed.data.checkOut!>parsed.data.checkIn!);
      let items=await getHotels(selected,datesReady?200:parsed.data.limit);
      const runtime=await getHbxHotelsRuntime();
      if(datesReady){
        try{
          const live=await getLiveAvailability(items.map(x=>x.code),parsed.data.checkIn!,parsed.data.checkOut!,parsed.data.guests);
          items=items.filter(item=>live.has(item.code)).map(item=>{const rate=live.get(item.code)!;const {rateKey,...publicRate}=rate;const selectionToken=rateKey?sealOfferToken({rateKey,hotelCode:item.code,checkIn:parsed.data.checkIn!,checkOut:parsed.data.checkOut!,guests:parsed.data.guests,requiresCheckRate:rate.requiresCheckRate,publicRate:publicRate as HbxPublicRate,exp:Date.now()+30*60*1000},runtime!.secret):null;return{...item,liveRate:{...publicRate,selectionToken}}}).slice(0,parsed.data.limit) as any;
          return reply.send({provider:"HBX",environment:runtime?.environment??"test",destination:selected,total:items.length,items,availability:{ready:true,reason:"ok",checkIn:parsed.data.checkIn,checkOut:parsed.data.checkOut,guests:parsed.data.guests}});
        }catch(error){
          const detail=String(error instanceof Error?error.message:error).slice(0,240);
          const missing=detail==="hbx_mtls_certificate_missing",quota=/quota exceeded/i.test(detail);
          return reply.send({provider:"HBX",environment:runtime?.environment??"test",destination:selected,total:items.length,items,availability:{ready:false,reason:missing?"mtls_certificate_required":quota?"hbx_quota_exceeded":"mtls_request_failed",detail:missing||quota?undefined:detail}});
        }
      }
      return reply.send({provider:"HBX",environment:runtime?.environment??"test",destination:selected,total:items.length,items,availability:{ready:false,reason:"dates_required"}});
    }catch(error){
      const detail=String(error instanceof Error?error.message:error).slice(0,240);const quota=/quota exceeded/i.test(detail);
      return reply.code(detail==="hbx_not_configured"?409:quota?429:502).send({error:detail==="hbx_not_configured"?"hbx_not_configured":quota?"hbx_quota_exceeded":"hbx_search_failed",detail:quota?undefined:detail});
    }
  });

  app.get("/vacances/hbx/hotel/:code",async(request,reply)=>{
    const parsed=z.object({code:z.coerce.number().int().positive()}).safeParse(request.params);if(!parsed.success)return reply.code(400).send({error:"invalid_hotel_code"});
    try{return reply.send({provider:"HBX",hotel:await getHotelDetail(parsed.data.code)})}catch(error){return reply.code(502).send({error:"hbx_hotel_detail_failed",detail:String(error instanceof Error?error.message:error).slice(0,220)})}
  });

  app.post("/vacances/hbx/prepare-rate",async(request,reply)=>{
    const parsed=z.object({offerToken:z.string().min(20).max(12000)}).safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:"invalid_offer_token"});
    const runtime=await getHbxHotelsRuntime();if(!runtime?.apiKey||!runtime.secret)return reply.code(409).send({error:"hbx_not_configured"});
    const token=openOfferToken(parsed.data.offerToken,runtime.secret);if(!token)return reply.code(400).send({error:"offer_token_invalid_or_expired"});
    if(!token.requiresCheckRate){const bookingToken=bookingTokenFrom(token,{...token.publicRate,requiresCheckRate:false},token.rateKey,runtime.secret);return reply.send({ok:true,checked:false,bookingReady:true,stay:{checkIn:token.checkIn,checkOut:token.checkOut,guests:token.guests},hotelCode:token.hotelCode,rate:{...token.publicRate,requiresCheckRate:false,bookingToken}})}
    try{
      const result=await hbxMtlsPost("/hotel-api/1.0/checkrates",{rooms:[{rateKey:token.rateKey}]});const checked=normalizeCheckedRate(result);if(!checked||!checked.rateKey)return reply.code(502).send({error:"hbx_checkrate_empty"});
      const firstPolicy=checked.cancellationPolicies?.[0]??null;const publicRate:HbxPublicRate={displayRate:Number(checked.displayRate??token.publicRate.displayRate),netRate:Number(checked.netRate??token.publicRate.netRate),sellingRate:checked.sellingRate??null,maxRate:token.publicRate.maxRate,currency:String(checked.currency??token.publicRate.currency),priceSource:checked.sellingRate!=null?"sellingRate":"net",hotelMandatory:checked.hotelMandatory??null,roomName:checked.roomName??null,boardName:checked.boardName??null,rateClass:checked.rateClass??null,rateType:checked.rateType??null,requiresCheckRate:false,paymentType:checked.paymentType??null,cancellationFrom:firstPolicy?.from??null,cancellationAmount:firstPolicy?.amount??null};
      return reply.send({ok:true,checked:true,bookingReady:String(checked.rateType).toUpperCase()==="BOOKABLE",stay:{checkIn:token.checkIn,checkOut:token.checkOut,guests:token.guests},hotelCode:token.hotelCode,rate:{...publicRate,rateComments:checked.rateComments??null,bookingToken:bookingTokenFrom(token,publicRate,checked.rateKey,runtime.secret)}});
    }catch(error){return reply.code(502).send({error:"hbx_checkrate_failed",detail:String(error instanceof Error?error.message:error).slice(0,220)})}
  });

  app.post("/vacances/hbx/booking-preview",async(request,reply)=>{
    const parsed=z.object({bookingToken:z.string().min(20).max(12000),holder:z.object({name:z.string().trim().min(1).max(80),surname:z.string().trim().min(1).max(80)}),paxes:z.array(z.object({name:z.string().trim().min(1).max(80),surname:z.string().trim().min(1).max(80)})).min(1).max(12)}).safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:"invalid_booking_preview"});
    const runtime=await getHbxHotelsRuntime();if(!runtime?.secret)return reply.code(409).send({error:"hbx_not_configured"});const token=openOfferToken(parsed.data.bookingToken,runtime.secret);if(!token)return reply.code(400).send({error:"booking_token_invalid_or_expired"});if(token.requiresCheckRate)return reply.code(409).send({error:"checkrate_required"});if(parsed.data.paxes.length!==token.guests)return reply.code(400).send({error:"guest_count_mismatch",expected:token.guests});
    return reply.send({ok:true,testMode:runtime.environment==="test",bookingReady:true,hotelCode:token.hotelCode,stay:{checkIn:token.checkIn,checkOut:token.checkOut,guests:token.guests},holder:parsed.data.holder,paxes:parsed.data.paxes,rate:token.publicRate,bookingToken:parsed.data.bookingToken});
  });

  app.post("/vacances/hbx/book",async(request,reply)=>{
    const user=await requireHbxUser(request,reply);if(!user)return;
    const parsed=z.object({bookingToken:z.string().min(20).max(12000),holder:z.object({name:z.string().trim().min(1).max(80),surname:z.string().trim().min(1).max(80)}),paxes:z.array(z.object({name:z.string().trim().min(1).max(80),surname:z.string().trim().min(1).max(80)})).min(1).max(12)}).safeParse(request.body);
    if(!parsed.success)return reply.code(400).send({error:"invalid_booking_request"});
    const runtime=await getHbxHotelsRuntime();if(!runtime?.secret)return reply.code(409).send({error:"hbx_not_configured"});if(runtime.environment!=="test")return reply.code(409).send({error:"hbx_live_booking_disabled"});
    const token=openOfferToken(parsed.data.bookingToken,runtime.secret);if(!token)return reply.code(400).send({error:"booking_token_invalid_or_expired"});if(token.requiresCheckRate)return reply.code(409).send({error:"checkrate_required"});if(parsed.data.paxes.length!==token.guests)return reply.code(400).send({error:"guest_count_mismatch",expected:token.guests});
    const tokenHash=createHash("sha256").update(parsed.data.bookingToken).digest("hex");
    const existing=await prisma.$queryRawUnsafe<Array<any>>(`SELECT * FROM "HbxHotelBooking" WHERE "tokenHash"=$1 LIMIT 1`,tokenHash);
    if(existing[0]){const row=existing[0];if(row.providerReference)return reply.send({ok:true,reused:true,booking:{reference:row.providerReference,status:row.status,clientReference:row.clientReference,currency:row.currency,total:row.total,hotelCode:row.hotelCode,checkIn:String(row.checkIn).slice(0,10),checkOut:String(row.checkOut).slice(0,10),guests:row.guests}});return reply.code(409).send({error:"booking_already_in_progress",clientReference:row.clientReference})}
    const id=randomUUID();const clientReference=`PA-TEST-${Date.now().toString(36).toUpperCase()}-${id.slice(0,6).toUpperCase()}`;
    await prisma.$executeRawUnsafe(`INSERT INTO "HbxHotelBooking" ("id","userId","tokenHash","clientReference","hotelCode","checkIn","checkOut","guests","status","environment","currency","total") VALUES ($1,$2,$3,$4,$5,$6::date,$7::date,$8,'PENDING',$9,$10,$11)`,id,user.id,tokenHash,clientReference,token.hotelCode,token.checkIn,token.checkOut,token.guests,runtime.environment,token.publicRate.currency,token.publicRate.displayRate);
    const body={holder:parsed.data.holder,rooms:[{rateKey:token.rateKey,paxes:parsed.data.paxes.map(p=>({roomId:1,type:"AD",name:p.name,surname:p.surname}))}],clientReference,remark:"Petit Annonces TEST booking",tolerance:2.0};
    try{
      const payload=await hbxMtlsRequest("POST","/hotel-api/1.0/bookings",body,75_000);const booking=normalizeHotelBooking(payload);if(!booking?.reference){await prisma.$executeRawUnsafe(`UPDATE "HbxHotelBooking" SET "status"='UNKNOWN',"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,id);await deliverUserEvent({userId:user.id,eventKind:"LISTING",notificationKind:"SYSTEM",title:"Réservation hôtel à vérifier",body:`HBX n’a pas renvoyé de référence pour la réservation ${clientReference}. Ne relancez pas immédiatement la réservation : Petit Annonces doit vérifier son statut.`,actionUrl:"/mon-compte/reservations",transactional:true,forceInApp:true,forcePush:true,dedupeKey:`hbx-booking:${clientReference}:unknown`,metadata:{provider:"HBX",clientReference,status:"UNKNOWN",transactional:true}}).catch(()=>undefined);return reply.code(502).send({error:"hbx_booking_reference_missing",clientReference})}
      const detail=await getHotelDetail(token.hotelCode).catch(()=>null);const hotelName=booking.hotelName??detail?.name??null;const city=detail?.city??null;const imageUrl=detail?.images?.[0]?.url??null;
      await prisma.$executeRawUnsafe(`UPDATE "HbxHotelBooking" SET "providerReference"=$2,"status"=$3,"currency"=COALESCE($4,"currency"),"total"=COALESCE($5,"total"),"hotelName"=$6,"city"=$7,"imageUrl"=$8,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,id,booking.reference,booking.status??"CONFIRMED",booking.currency,booking.total,hotelName,city,imageUrl);
      const confirmedTotal=booking.total??token.publicRate.displayRate;const confirmedCurrency=booking.currency??token.publicRate.currency;
      await deliverUserEvent({userId:user.id,eventKind:"LISTING",notificationKind:"SYSTEM",title:"Réservation hôtel confirmée",body:`Votre réservation ${hotelName?`à ${hotelName}`:"d’hôtel"} est confirmée. Référence HBX : ${booking.reference}.`,actionUrl:`/mon-compte/reservations/hbx/${encodeURIComponent(booking.reference)}`,transactional:true,forceInApp:true,forcePush:true,dedupeKey:`hbx-booking:${booking.reference}:confirmed`,metadata:{provider:"HBX",providerReference:booking.reference,clientReference,hotelCode:token.hotelCode,checkIn:booking.checkIn??token.checkIn,checkOut:booking.checkOut??token.checkOut,total:confirmedTotal,currency:confirmedCurrency,status:booking.status??"CONFIRMED",transactional:true}}).catch(()=>undefined);
      return reply.send({ok:true,reused:false,booking:{reference:booking.reference,status:booking.status??"CONFIRMED",clientReference,currency:confirmedCurrency,total:confirmedTotal,hotelName,hotelCode:booking.hotelCode??token.hotelCode,checkIn:booking.checkIn??token.checkIn,checkOut:booking.checkOut??token.checkOut,guests:token.guests}});
    }catch(error){const detail=String(error instanceof Error?error.message:error).slice(0,500);const unknown=detail.includes("timeout")||detail.includes("ECONNRESET")||detail.includes("socket");const failedStatus=unknown?"UNKNOWN":"FAILED";await prisma.$executeRawUnsafe(`UPDATE "HbxHotelBooking" SET "status"=$2,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,id,failedStatus);await deliverUserEvent({userId:user.id,eventKind:"LISTING",notificationKind:"SYSTEM",title:unknown?"Réservation hôtel à vérifier":"Réservation hôtel non confirmée",body:unknown?`La réponse HBX n’a pas pu être confirmée pour ${clientReference}. Ne relancez pas immédiatement la réservation.`:`La réservation ${clientReference} n’a pas été confirmée par HBX. Aucun second essai automatique n’a été lancé.`,actionUrl:"/mon-compte/reservations",transactional:true,forceInApp:true,forcePush:true,dedupeKey:`hbx-booking:${clientReference}:${failedStatus.toLowerCase()}`,metadata:{provider:"HBX",clientReference,status:failedStatus,transactional:true}}).catch(()=>undefined);return reply.code(502).send({error:unknown?"hbx_booking_status_unknown":"hbx_booking_failed",clientReference,detail})}
  });

  app.post("/vacances/hbx/cancel-simulation",async(request,reply)=>{
    const user=await requireHbxUser(request,reply);if(!user)return;
    const parsed=z.object({reference:z.string().trim().min(3).max(80)}).safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:"invalid_booking_reference"});
    const runtime=await getHbxHotelsRuntime();if(!runtime?.secret)return reply.code(409).send({error:"hbx_not_configured"});if(runtime.environment!=="test")return reply.code(409).send({error:"hbx_live_cancellation_disabled"});
    const rows=await prisma.$queryRawUnsafe<Array<any>>(`SELECT * FROM "HbxHotelBooking" WHERE "providerReference"=$1 AND "userId"=$2 LIMIT 1`,parsed.data.reference,user.id);if(!rows[0])return reply.code(404).send({error:"booking_not_found"});
    try{const payload=await hbxMtlsRequest("DELETE",`/hotel-api/1.0/bookings/${encodeURIComponent(parsed.data.reference)}?cancellationFlag=SIMULATION`,undefined,45_000);const booking=normalizeHotelBooking(payload);return reply.send({ok:true,simulation:true,booking:booking??{reference:parsed.data.reference,status:"SIMULATION"},rawSummary:{status:booking?.status??null,total:booking?.total??null,currency:booking?.currency??null}})}catch(error){return reply.code(502).send({error:"hbx_cancellation_simulation_failed",detail:String(error instanceof Error?error.message:error).slice(0,500)})}
  });

  app.get("/vacances/hbx/bookings/mine",async(request,reply)=>{
    const user=await requireHbxUser(request,reply);if(!user)return;
    const rows=await prisma.$queryRawUnsafe<Array<any>>(`SELECT "id","providerReference","clientReference","hotelCode","hotelName","city","imageUrl","checkIn","checkOut","guests","status","environment","currency","total","createdAt","updatedAt" FROM "HbxHotelBooking" WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 100`,user.id);
    return reply.send({bookings:rows.map(row=>({...row,checkIn:String(row.checkIn).slice(0,10),checkOut:String(row.checkOut).slice(0,10)}))});
  });

  app.get("/admin/hbx/bookings",async(request,reply)=>{
    const admin=await requireHbxAdmin(request,reply);if(!admin)return;
    const q=z.object({status:z.string().trim().max(40).optional(),query:z.string().trim().max(120).optional(),page:z.coerce.number().int().min(1).max(500).default(1),limit:z.coerce.number().int().min(10).max(100).default(30)}).safeParse(request.query);if(!q.success)return reply.code(400).send({error:"invalid_query"});
    const where:string[]=["1=1"];const args:any[]=[];if(q.data.status&&q.data.status!=="ALL"){args.push(q.data.status.toUpperCase());where.push(`b."status"=$${args.length}`)}if(q.data.query){args.push(`%${q.data.query}%`);where.push(`(b."providerReference" ILIKE $${args.length} OR b."clientReference" ILIKE $${args.length} OR COALESCE(b."hotelName",'') ILIKE $${args.length} OR u."email" ILIKE $${args.length})`)}const offset=(q.data.page-1)*q.data.limit;
    const [items,totalRows,stats]=await Promise.all([
      prisma.$queryRawUnsafe<Array<any>>(`SELECT b."id",b."providerReference",b."clientReference",b."hotelCode",b."hotelName",b."city",b."imageUrl",b."checkIn",b."checkOut",b."guests",b."status",b."environment",b."currency",b."total",b."createdAt",b."updatedAt",u."email",COALESCE(p."displayName",NULLIF(TRIM(CONCAT_WS(' ',p."firstName",p."lastName")),'')) AS "userName" FROM "HbxHotelBooking" b JOIN "User" u ON u."id"=b."userId" LEFT JOIN "UserProfile" p ON p."userId"=u."id" WHERE ${where.join(" AND ")} ORDER BY b."createdAt" DESC LIMIT ${q.data.limit} OFFSET ${offset}`,...args),
      prisma.$queryRawUnsafe<Array<{count:number}>>(`SELECT COUNT(*)::int AS count FROM "HbxHotelBooking" b JOIN "User" u ON u."id"=b."userId" WHERE ${where.join(" AND ")}`,...args),
      prisma.$queryRawUnsafe<Array<any>>(`SELECT COUNT(*)::int AS total,COUNT(*) FILTER (WHERE "status" IN ('CONFIRMED','OK'))::int AS confirmed,COUNT(*) FILTER (WHERE "status"='PENDING')::int AS pending,COUNT(*) FILTER (WHERE "status" IN ('FAILED','UNKNOWN'))::int AS attention,COALESCE(SUM("total") FILTER (WHERE "status" IN ('CONFIRMED','OK')),0)::float8 AS volume FROM "HbxHotelBooking"`)
    ]);
    return reply.send({items:items.map(row=>({...row,checkIn:String(row.checkIn).slice(0,10),checkOut:String(row.checkOut).slice(0,10)})),page:q.data.page,limit:q.data.limit,total:totalRows[0]?.count??0,stats:stats[0]??{total:0,confirmed:0,pending:0,attention:0,volume:0}});
  });

  app.post("/admin/hbx/bookings/:reference/sync",async(request,reply)=>{
    const admin=await requireHbxAdmin(request,reply);if(!admin)return;const p=z.object({reference:z.string().trim().min(3).max(100)}).safeParse(request.params);if(!p.success)return reply.code(400).send({error:"invalid_reference"});
    const rows=await prisma.$queryRawUnsafe<Array<any>>(`SELECT * FROM "HbxHotelBooking" WHERE "providerReference"=$1 OR "clientReference"=$1 LIMIT 1`,p.data.reference);const row=rows[0];if(!row)return reply.code(404).send({error:"booking_not_found"});
    try{const booking=await refreshHbxBookingRow(row);if(!booking)return reply.code(404).send({error:"hbx_booking_not_found",clientReference:row.clientReference});if(row.status!==booking.status&&row.userId){await deliverUserEvent({userId:row.userId,eventKind:"LISTING",notificationKind:"SYSTEM",title:"Mise à jour de votre réservation hôtel",body:`Votre réservation ${booking.reference} est maintenant au statut ${booking.status??"mis à jour"}.`,actionUrl:`/mon-compte/reservations/hbx/${encodeURIComponent(booking.reference)}`,transactional:true,forceInApp:true,forcePush:true,dedupeKey:`hbx-booking:${booking.reference}:sync:${String(booking.status??"updated").toLowerCase()}`,metadata:{provider:"HBX",providerReference:booking.reference,status:booking.status,transactional:true}}).catch(()=>undefined)}return reply.send({ok:true,booking})}catch(error){const detail=String(error instanceof Error?error.message:error);const quota=/quota exceeded/i.test(detail);return reply.code(quota?429:502).send({error:quota?"hbx_quota_exceeded":"hbx_booking_sync_failed",detail:quota?undefined:detail.slice(0,300)})}
  });

  app.get("/admin/hbx/bookings/:reference",async(request,reply)=>{
    const admin=await requireHbxAdmin(request,reply);if(!admin)return;const p=z.object({reference:z.string().trim().min(3).max(100)}).safeParse(request.params);if(!p.success)return reply.code(400).send({error:"invalid_reference"});const rows=await prisma.$queryRawUnsafe<Array<any>>(`SELECT b.*,u."email",COALESCE(pr."displayName",NULLIF(TRIM(CONCAT_WS(' ',pr."firstName",pr."lastName")),'')) AS "userName" FROM "HbxHotelBooking" b JOIN "User" u ON u."id"=b."userId" LEFT JOIN "UserProfile" pr ON pr."userId"=u."id" WHERE b."providerReference"=$1 OR b."clientReference"=$1 LIMIT 1`,p.data.reference);if(!rows[0])return reply.code(404).send({error:"booking_not_found"});return reply.send({booking:{...rows[0],tokenHash:undefined,checkIn:String(rows[0].checkIn).slice(0,10),checkOut:String(rows[0].checkOut).slice(0,10)}})
  });

  app.get("/vacances/hbx/bookings/:reference",async(request,reply)=>{
    const user=await requireHbxUser(request,reply);if(!user)return;const parsed=z.object({reference:z.string().trim().min(3).max(80)}).safeParse(request.params);if(!parsed.success)return reply.code(400).send({error:"invalid_booking_reference"});const rows=await prisma.$queryRawUnsafe<Array<any>>(`SELECT "id","providerReference","clientReference","hotelCode","hotelName","city","imageUrl","checkIn","checkOut","guests","status","environment","currency","total","createdAt","updatedAt" FROM "HbxHotelBooking" WHERE "providerReference"=$1 AND "userId"=$2 LIMIT 1`,parsed.data.reference,user.id);if(!rows[0])return reply.code(404).send({error:"booking_not_found"});return reply.send({booking:rows[0]})
  });

  app.post("/vacances/hbx/check-rate",async(request,reply)=>{
    const parsed=z.object({offerToken:z.string().min(20).max(12000)}).safeParse(request.body);
    if(!parsed.success)return reply.code(400).send({error:"invalid_offer_token"});
    const runtime=await getHbxHotelsRuntime();if(!runtime?.apiKey||!runtime.secret)return reply.code(409).send({error:"hbx_not_configured"});
    const token=openOfferToken(parsed.data.offerToken,runtime.secret);if(!token)return reply.code(400).send({error:"offer_token_invalid_or_expired"});
    if(!token.requiresCheckRate)return reply.code(409).send({error:"checkrate_not_required",bookingReady:true});
    try{
      const result=await hbxMtlsPost("/hotel-api/1.0/checkrates",{rooms:[{rateKey:token.rateKey}]});
      const checked=normalizeCheckedRate(result);if(!checked)return reply.code(502).send({error:"hbx_checkrate_empty"});
      const {rateKey,...publicRate}=checked;const bookingToken=rateKey?sealOfferToken({rateKey,hotelCode:token.hotelCode,checkIn:token.checkIn,checkOut:token.checkOut,guests:token.guests,requiresCheckRate:false,publicRate:{displayRate:Number(publicRate.displayRate??token.publicRate.displayRate),netRate:Number(publicRate.netRate??token.publicRate.netRate),sellingRate:publicRate.sellingRate??null,maxRate:token.publicRate.maxRate,currency:String(publicRate.currency??token.publicRate.currency),priceSource:publicRate.sellingRate!=null?"sellingRate":"net",hotelMandatory:publicRate.hotelMandatory??null,roomName:publicRate.roomName??null,boardName:publicRate.boardName??null,rateClass:publicRate.rateClass??null,rateType:publicRate.rateType??null,requiresCheckRate:false,paymentType:publicRate.paymentType??null,cancellationFrom:publicRate.cancellationPolicies?.[0]?.from??null,cancellationAmount:publicRate.cancellationPolicies?.[0]?.amount??null},exp:Date.now()+20*60*1000},runtime.secret):null;
      return reply.send({ok:true,bookingReady:String(checked.rateType).toUpperCase()==="BOOKABLE",rate:{...publicRate,bookingToken}});
    }catch(error){return reply.code(502).send({error:"hbx_checkrate_failed",detail:String(error instanceof Error?error.message:error).slice(0,220)})}
  });
}
