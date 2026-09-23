import { randomUUID } from "node:crypto";
import { prisma } from "@pa/database";

export type RegistrationAcquisitionInput={
  userId:string;
  accountKind:"PARTICULIER"|"PROFESSIONNEL";
  source?:string|null;
  medium?:string|null;
  campaign?:string|null;
  landingPath?:string|null;
  channel?:"WEB"|"NATIVE";
  properties?:Record<string,unknown>;
};

function clean(value:string|undefined|null,max:number){const v=value?.trim();return v?v.slice(0,max):null}
function source(value:string|undefined|null){
  const v=(value??"").trim().toLowerCase();
  if(!v)return"direct";
  if(/^(fb|facebook|instagram|ig|meta)$/.test(v))return"meta";
  if(v.includes("google"))return"google";
  if(v.includes("bing")||v.includes("microsoft"))return"bing";
  if(v.includes("tiktok"))return"tiktok";
  if(v.includes("linkedin"))return"linkedin";
  if(v==="outreach")return"outreach";
  if(v==="referral")return"referral";
  if(v==="native")return"native";
  if(v==="direct")return"direct";
  return v.replace(/[^a-z0-9_-]/g,"-").slice(0,40)||"direct";
}
function medium(value:string|undefined|null,src:string){
  const v=(value??"").trim().toLowerCase().replace(/[^a-z0-9_-]/g,"-").slice(0,40);
  if(v)return v;
  if(src==="google"||src==="bing")return"organic";
  if(src==="meta"||src==="tiktok"||src==="linkedin")return"social";
  if(src==="outreach")return"email";
  if(src==="referral")return"referral";
  if(src==="native")return"app";
  return"none";
}

export async function recordRegistrationAcquisition(input:RegistrationAcquisitionInput){
  const normalizedSource=source(input.source);
  const normalizedMedium=medium(input.medium,normalizedSource);
  const campaign=clean(input.campaign,160);
  const landingPath=clean(input.landingPath,300);
  await prisma.$executeRawUnsafe(
    `INSERT INTO "GrowthEvent" ("id","userId","eventName","channel","campaign","source","medium","properties") VALUES ($1,$2,'USER_ACQUISITION_REGISTERED',$3,$4,$5,$6,$7::jsonb)`,
    randomUUID(),input.userId,input.channel??"WEB",campaign,normalizedSource,normalizedMedium,
    JSON.stringify({accountKind:input.accountKind,landingPath,...(input.properties??{})}),
  );
  return{source:normalizedSource,medium:normalizedMedium,campaign,landingPath};
}
