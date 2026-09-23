import { randomUUID } from "node:crypto";
import { prisma } from "@pa/database";

export const WELCOME_SITE_CREDIT_MINOR = 500;
export const SITE_CREDIT_CURRENCY = "EUR";

export async function ensureSiteCreditSchema(){
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "SiteCreditWallet" ("id" TEXT PRIMARY KEY,"userId" TEXT NOT NULL UNIQUE REFERENCES "User"("id") ON DELETE CASCADE,"balanceMinor" INTEGER NOT NULL DEFAULT 0,"currency" TEXT NOT NULL DEFAULT 'EUR',"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "SiteCreditTransaction" ("id" TEXT PRIMARY KEY,"walletId" TEXT NOT NULL REFERENCES "SiteCreditWallet"("id") ON DELETE CASCADE,"type" TEXT NOT NULL,"amountMinor" INTEGER NOT NULL,"referenceType" TEXT NOT NULL,"referenceId" TEXT,"metadata" JSONB,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "SiteCreditTransaction_ref_unique" ON "SiteCreditTransaction"("walletId","referenceType","referenceId") WHERE "referenceId" IS NOT NULL`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "SiteCreditPackage" ("id" TEXT PRIMARY KEY,"name" TEXT NOT NULL,"description" TEXT NULL,"badge" TEXT NULL,"creditMinor" INTEGER NOT NULL,"priceMinor" INTEGER NOT NULL,"currency" TEXT NOT NULL DEFAULT 'EUR',"sortOrder" INTEGER NOT NULL DEFAULT 0,"isActive" BOOLEAN NOT NULL DEFAULT TRUE,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SiteCreditPackage_active_sort_idx" ON "SiteCreditPackage" ("isActive","sortOrder","creditMinor")`);
  await prisma.$executeRawUnsafe(`INSERT INTO "SiteCreditPackage" ("id","name","description","creditMinor","priceMinor","currency","sortOrder") VALUES ('credit-5','Découverte','Pour prolonger ou mettre en avant une annonce.',500,500,'EUR',10),('credit-10','Essentiel','Un solde pratique pour vos services Petit Annonces.',1000,1000,'EUR',20),('credit-20','Plus','Pour plusieurs mises en avant et prolongations.',2000,2000,'EUR',30),('credit-50','Max','Pour les utilisateurs réguliers de la plateforme.',5000,5000,'EUR',40) ON CONFLICT ("id") DO NOTHING`);
}

async function walletForUser(tx:any,userId:string,lock=false){
  await tx.$executeRawUnsafe(`INSERT INTO "SiteCreditWallet" ("id","userId") VALUES ($1,$2) ON CONFLICT ("userId") DO NOTHING`,randomUUID(),userId);
  const rows=await tx.$queryRawUnsafe(`SELECT "id","balanceMinor","currency" FROM "SiteCreditWallet" WHERE "userId"=$1 ${lock?'FOR UPDATE':''}`,userId) as Array<{id:string;balanceMinor:number;currency:string}>;
  return rows[0]!;
}

export async function grantWelcomeSiteCredit(userId:string){
  await ensureSiteCreditSchema();
  return prisma.$transaction(async(tx:any)=>{
    const wallet=await walletForUser(tx,userId,true);
    const ref=`welcome:${userId}`;
    const existing=await tx.$queryRawUnsafe(`SELECT "id" FROM "SiteCreditTransaction" WHERE "walletId"=$1 AND "referenceType"='WELCOME' AND "referenceId"=$2 LIMIT 1`,wallet.id,ref) as Array<{id:string}>;
    if(existing[0])return {balanceMinor:Number(wallet.balanceMinor),grantedMinor:0,currency:SITE_CREDIT_CURRENCY};
    await tx.$executeRawUnsafe(`UPDATE "SiteCreditWallet" SET "balanceMinor"="balanceMinor"+$1,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$2`,WELCOME_SITE_CREDIT_MINOR,wallet.id);
    await tx.$executeRawUnsafe(`INSERT INTO "SiteCreditTransaction" ("id","walletId","type","amountMinor","referenceType","referenceId","metadata") VALUES ($1,$2,'GRANT',$3,'WELCOME',$4,$5::jsonb)`,randomUUID(),wallet.id,WELCOME_SITE_CREDIT_MINOR,ref,JSON.stringify({nonWithdrawable:true,platformServicesOnly:true}));
    return {balanceMinor:Number(wallet.balanceMinor)+WELCOME_SITE_CREDIT_MINOR,grantedMinor:WELCOME_SITE_CREDIT_MINOR,currency:SITE_CREDIT_CURRENCY};
  });
}

export type SiteCreditPackage={id:string;name:string;description:string|null;badge:string|null;creditMinor:number;priceMinor:number;currency:string;sortOrder:number;isActive:boolean};

export async function getSiteCreditPackages(includeInactive=false):Promise<SiteCreditPackage[]>{
  await ensureSiteCreditSchema();
  return prisma.$queryRawUnsafe<SiteCreditPackage[]>(`SELECT "id","name","description","badge","creditMinor","priceMinor","currency","sortOrder","isActive" FROM "SiteCreditPackage" ${includeInactive?'':'WHERE "isActive"=TRUE'} ORDER BY "sortOrder" ASC,"creditMinor" ASC`);
}

export async function getSiteCredit(userId:string){
  await ensureSiteCreditSchema();
  const wallet=await prisma.$transaction((tx:any)=>walletForUser(tx,userId,false));
  const [transactions,packages]=await Promise.all([
    prisma.$queryRawUnsafe<Array<{id:string;type:string;amountMinor:number;referenceType:string;referenceId:string|null;createdAt:Date}>>(`SELECT "id","type","amountMinor","referenceType","referenceId","createdAt" FROM "SiteCreditTransaction" WHERE "walletId"=$1 ORDER BY "createdAt" DESC LIMIT 100`,wallet.id),
    getSiteCreditPackages(false),
  ]);
  return {wallet:{balanceMinor:Number(wallet.balanceMinor),currency:wallet.currency},transactions,packages};
}

export async function grantPurchasedSiteCredit(userId:string,amountMinor:number,referenceId:string,metadata?:unknown){
  if(!Number.isInteger(amountMinor)||amountMinor<=0||amountMinor>500000)throw new Error("invalid_site_credit_purchase_amount");
  await ensureSiteCreditSchema();
  return prisma.$transaction(async(tx:any)=>{
    const wallet=await walletForUser(tx,userId,true);
    const duplicate=await tx.$queryRawUnsafe(`SELECT "id" FROM "SiteCreditTransaction" WHERE "walletId"=$1 AND "referenceType"='CREDIT_PURCHASE' AND "referenceId"=$2 LIMIT 1`,wallet.id,referenceId) as Array<{id:string}>;
    if(duplicate[0])return {credited:false,duplicate:true,balanceMinor:Number(wallet.balanceMinor),currency:wallet.currency};
    const next=Number(wallet.balanceMinor)+amountMinor;
    await tx.$executeRawUnsafe(`UPDATE "SiteCreditWallet" SET "balanceMinor"=$2,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,wallet.id,next);
    await tx.$executeRawUnsafe(`INSERT INTO "SiteCreditTransaction" ("id","walletId","type","amountMinor","referenceType","referenceId","metadata") VALUES ($1,$2,'PURCHASE',$3,'CREDIT_PURCHASE',$4,$5::jsonb)`,randomUUID(),wallet.id,amountMinor,referenceId,metadata?JSON.stringify(metadata):null);
    return {credited:true,duplicate:false,balanceMinor:next,currency:wallet.currency};
  });
}

export async function consumeSiteCreditInTransaction(tx:any,userId:string,amountMinor:number,referenceType:string,referenceId:string,metadata?:unknown){
  if(!Number.isInteger(amountMinor)||amountMinor<=0)throw new Error("invalid_site_credit_amount");
  const wallet=await walletForUser(tx,userId,true);
  const duplicate=await tx.$queryRawUnsafe(`SELECT "id" FROM "SiteCreditTransaction" WHERE "walletId"=$1 AND "referenceType"=$2 AND "referenceId"=$3 LIMIT 1`,wallet.id,referenceType,referenceId) as Array<{id:string}>;
  if(duplicate[0])return {consumed:true,duplicate:true,balanceMinor:Number(wallet.balanceMinor)};
  if(Number(wallet.balanceMinor)<amountMinor)return {consumed:false,balanceMinor:Number(wallet.balanceMinor)};
  await tx.$executeRawUnsafe(`UPDATE "SiteCreditWallet" SET "balanceMinor"="balanceMinor"-$1,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$2`,amountMinor,wallet.id);
  await tx.$executeRawUnsafe(`INSERT INTO "SiteCreditTransaction" ("id","walletId","type","amountMinor","referenceType","referenceId","metadata") VALUES ($1,$2,'CONSUME',$3,$4,$5,$6::jsonb)`,randomUUID(),wallet.id,-amountMinor,referenceType,referenceId,metadata?JSON.stringify(metadata):null);
  return {consumed:true,duplicate:false,balanceMinor:Number(wallet.balanceMinor)-amountMinor};
}

export async function consumeSiteCredit(userId:string,amountMinor:number,referenceType:string,referenceId:string,metadata?:unknown){
  await ensureSiteCreditSchema();
  return prisma.$transaction((tx:any)=>consumeSiteCreditInTransaction(tx,userId,amountMinor,referenceType,referenceId,metadata));
}

export const REFERRAL_SITE_CREDIT_MINOR = 500;

export async function grantReferralSiteCredit(userId:string,referralId:string,role:"REFERRER"|"REFERRED"){
  await ensureSiteCreditSchema();
  return prisma.$transaction(async(tx:any)=>{
    const wallet=await walletForUser(tx,userId,true);
    const referenceId=`referral:${referralId}:${role.toLowerCase()}`;
    const existing=await tx.$queryRawUnsafe(`SELECT "id" FROM "SiteCreditTransaction" WHERE "walletId"=$1 AND "referenceType"='REFERRAL' AND "referenceId"=$2 LIMIT 1`,wallet.id,referenceId) as Array<{id:string}>;
    if(existing[0])return {balanceMinor:Number(wallet.balanceMinor),grantedMinor:0,currency:wallet.currency,duplicate:true};
    const next=Number(wallet.balanceMinor)+REFERRAL_SITE_CREDIT_MINOR;
    await tx.$executeRawUnsafe(`UPDATE "SiteCreditWallet" SET "balanceMinor"=$2,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,wallet.id,next);
    await tx.$executeRawUnsafe(`INSERT INTO "SiteCreditTransaction" ("id","walletId","type","amountMinor","referenceType","referenceId","metadata") VALUES ($1,$2,'GRANT',$3,'REFERRAL',$4,$5::jsonb)`,randomUUID(),wallet.id,REFERRAL_SITE_CREDIT_MINOR,referenceId,JSON.stringify({referralId,role,nonWithdrawable:true,platformServicesOnly:true}));
    return {balanceMinor:next,grantedMinor:REFERRAL_SITE_CREDIT_MINOR,currency:wallet.currency,duplicate:false};
  });
}
