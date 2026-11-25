import { randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import { z } from "zod";
import { getRuntimeIntegration } from "./admin-control.js";
import { signJwt } from "./cda-uat.js";

type State = "CHECKED"|"CODE_SENT"|"VERIFIED"|"FAILED"|"UNAVAILABLE"|"CHECKING";
type Row = {listingId:string;attemptId:string;status:State;caseId:string|null;hasMail:boolean;hasTel:boolean;updatedAt:Date;expiresAt:Date;errorCode:number|null;operationType:number;animalSummary:unknown};
export async function ensureCdaProductionSchema(){
 await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "CdaListingProduction" ("listingId" TEXT PRIMARY KEY REFERENCES "Listing"("id") ON DELETE CASCADE,"sellerId" TEXT NOT NULL,"categoryId" TEXT NOT NULL,"attemptId" TEXT NOT NULL,"status" TEXT NOT NULL CHECK ("status" IN ('CHECKING','CHECKED','CODE_SENT','VERIFIED','FAILED','UNAVAILABLE')),"caseId" TEXT,"hasMail" BOOLEAN NOT NULL DEFAULT FALSE,"hasTel" BOOLEAN NOT NULL DEFAULT FALSE,"errorCode" INTEGER,"operationType" SMALLINT NOT NULL,"animalSummary" JSONB NOT NULL,"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),"expiresAt" TIMESTAMPTZ NOT NULL)`);
}
export async function cdaProductionAvailable(){
 const i=await getRuntimeIntegration("cda-production");
 return Boolean(i?.enabled&&i.secrets?.secret&&i.secrets?.apiToken);
}
const responseSchema=z.object({success:z.boolean(),error:z.number().int().optional(),message:z.string().max(1000).optional(),data:z.object({id:z.string().uuid().optional(),mail:z.string().max(200).optional(),tel:z.string().max(100).optional()}).passthrough().optional()});
type Result=z.infer<typeof responseSchema>;
async function provider(path:"checkData"|"contactValidation"|"ownerValidation",payload:Record<string,unknown>):Promise<Result>{
 const i=await getRuntimeIntegration("cda-production");
 if(!i?.enabled||!i.secrets?.secret||!i.secrets?.apiToken)return {success:false,error:503};
 try{
  const response=await fetch(new URL(path,"https://annonces.i-cad.fr/"),{method:"POST",headers:{"content-type":"application/json",accept:"application/json",authorization:"Bearer "+i.secrets.apiToken},body:JSON.stringify({token:signJwt(i.secrets.secret,{consumerId:21,...payload})}),signal:AbortSignal.timeout(12000),redirect:"error"});
  if(!response.ok)return {success:false,error:response.status===401||response.status===403?403:503};
  const parsed=responseSchema.safeParse(await response.json());
  return parsed.success?parsed.data:{success:false,error:503};
 }catch{return {success:false,error:503}}
}
const stateFor=(r:Result):State=>r.error===403||r.error===503||r.error===undefined?"UNAVAILABLE":"FAILED";
export async function getCdaProductionRow(listing:{id:string;sellerId:string;categoryId:string}){
 const rows=await prisma.$queryRawUnsafe<Row[]>(`SELECT "listingId","attemptId","status","caseId","hasMail","hasTel","updatedAt","expiresAt","errorCode","operationType","animalSummary" FROM "CdaListingProduction" WHERE "listingId"=$1 AND "sellerId"=$2 AND "categoryId"=$3 LIMIT 1`,listing.id,listing.sellerId,listing.categoryId);
 return rows[0]??null;
}
export function publicCdaState(row:Row|null){
 if(!row)return {status:"NOT_STARTED",verified:false};
 const expired=!["FAILED","UNAVAILABLE"].includes(row.status)&&row.expiresAt.getTime()<=Date.now();
 const status=expired?"EXPIRED":row.status;
 return {status,verified:status==="VERIFIED",errorCode:row.errorCode,hasMail:row.hasMail,hasTel:row.hasTel,checkedAt:row.updatedAt,expiresAt:row.expiresAt};
}
export async function adminCdaStatuses(ids:string[]){
 if(!ids.length)return new Map<string,ReturnType<typeof publicCdaState>&{animalSummary?:unknown;operationType?:number}>();
 const rows=await prisma.$queryRawUnsafe<Row[]>(`SELECT c."listingId",c."attemptId",c."status",NULL::text AS "caseId",c."hasMail",c."hasTel",c."updatedAt",c."expiresAt",c."errorCode",c."operationType",c."animalSummary" FROM "CdaListingProduction" c JOIN "Listing" l ON l."id"=c."listingId" AND l."sellerId"=c."sellerId" AND l."categoryId"=c."categoryId" WHERE c."listingId"=ANY($1::text[])`,ids);
 return new Map(rows.map(r=>[r.listingId,{...publicCdaState(r),animalSummary:r.animalSummary,operationType:r.operationType}]));
}
export async function startProductionCheck(listing:{id:string;sellerId:string;categoryId:string},payload:{operationType:number;data:{animal:{species:number;sex:string;birthDate:string;race:string;isLoofLof:boolean};owner:unknown}}){
 const attemptId=randomUUID();
 const a=payload.data.animal;
 const summary={species:a.species,sex:a.sex,birthDate:a.birthDate,race:a.race,isLoofLof:a.isLoofLof};
 await prisma.$executeRawUnsafe(`INSERT INTO "CdaListingProduction" ("listingId","sellerId","categoryId","attemptId","status","operationType","animalSummary","expiresAt") VALUES ($1,$2,$3,$4,'CHECKING',$5,$6::jsonb,NOW()+INTERVAL '15 minutes') ON CONFLICT ("listingId") DO UPDATE SET "sellerId"=EXCLUDED."sellerId","categoryId"=EXCLUDED."categoryId","attemptId"=EXCLUDED."attemptId","status"='CHECKING',"operationType"=EXCLUDED."operationType","animalSummary"=EXCLUDED."animalSummary","caseId"=NULL,"hasMail"=FALSE,"hasTel"=FALSE,"errorCode"=NULL,"updatedAt"=NOW(),"expiresAt"=EXCLUDED."expiresAt"`,listing.id,listing.sellerId,listing.categoryId,attemptId,payload.operationType,JSON.stringify(summary));
 const r=await provider("checkData",payload);
 const ok=r.success&&Boolean(r.data?.id)&&Boolean(r.data?.mail||r.data?.tel);
 const state=ok?"CHECKED":stateFor(r);
 await prisma.$executeRawUnsafe(`UPDATE "CdaListingProduction" SET "status"=$3,"caseId"=$4,"hasMail"=$5,"hasTel"=$6,"errorCode"=$7,"updatedAt"=NOW() WHERE "listingId"=$1 AND "attemptId"=$2 AND "status"='CHECKING'`,listing.id,attemptId,state,ok?r.data?.id??null:null,ok&&Boolean(r.data?.mail),ok&&Boolean(r.data?.tel),ok?null:r.error??503);
 return publicCdaState(await getCdaProductionRow(listing));
}
export async function sendProductionCode(listing:{id:string;sellerId:string;categoryId:string},contactType:1|2){
 const row=await getCdaProductionRow(listing);
 if(!row||!row.caseId||!["CHECKED","CODE_SENT"].includes(row.status)||row.expiresAt<=new Date()||!(contactType===1?row.hasMail:row.hasTel))return null;
 const r=await provider("contactValidation",{data:{id:row.caseId,contactType}});
 await prisma.$executeRawUnsafe(`UPDATE "CdaListingProduction" SET "status"=$3,"errorCode"=$4,"caseId"=CASE WHEN $3='CODE_SENT' THEN "caseId" ELSE NULL END,"updatedAt"=NOW(),"expiresAt"=CASE WHEN $3='CODE_SENT' THEN NOW()+INTERVAL '15 minutes' ELSE "expiresAt" END WHERE "listingId"=$1 AND "attemptId"=$2 AND "status" IN ('CHECKED','CODE_SENT')`,listing.id,row.attemptId,r.success?"CODE_SENT":stateFor(r),r.success?null:r.error??503);
 return publicCdaState(await getCdaProductionRow(listing));
}
export async function verifyProductionCode(listing:{id:string;sellerId:string;categoryId:string},code:string){
 const row=await getCdaProductionRow(listing);
 if(!row||row.status!=="CODE_SENT"||!row.caseId||row.expiresAt<=new Date())return null;
 const r=await provider("ownerValidation",{data:{id:row.caseId,code}});
 const next=r.success?"VERIFIED":r.error===401?"CODE_SENT":stateFor(r);
 await prisma.$executeRawUnsafe(`UPDATE "CdaListingProduction" SET "status"=$3,"errorCode"=$4,"caseId"=CASE WHEN $3='CODE_SENT' THEN "caseId" ELSE NULL END,"updatedAt"=NOW(),"expiresAt"=CASE WHEN $3='VERIFIED' THEN NOW()+INTERVAL '30 days' ELSE "expiresAt" END WHERE "listingId"=$1 AND "attemptId"=$2 AND "status"='CODE_SENT' AND "expiresAt">NOW()`,listing.id,row.attemptId,next,r.success?null:r.error??503);
 return publicCdaState(await getCdaProductionRow(listing));
}
