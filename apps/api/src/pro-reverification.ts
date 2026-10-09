import { prisma } from "@pa/database";
export type Reverification = {status:string; dueAt:string; daysRemaining:number; graceActive:boolean; canPublish:boolean};
export async function getProReverificationState(userId:string):Promise<Reverification|null>{
 const rows=await prisma.$queryRawUnsafe<Array<{status:string;dueAt:Date}>>('SELECT "status","dueAt" FROM "ProReverification" WHERE "userId"=$1 LIMIT 1',userId);
 const r=rows[0]; if(!r)return null;
 const business=await prisma.businessProfile.findUnique({where:{userId},select:{verificationStatus:true}});
 const graceActive=r.status==="PENDING"&&r.dueAt>new Date()&&business?.verificationStatus==="PENDING";
 const approved=r.status==="APPROVED"&&business?.verificationStatus==="VERIFIED";
 return {status:r.status,dueAt:r.dueAt.toISOString(),daysRemaining:Math.max(0,Math.ceil((r.dueAt.getTime()-Date.now())/86400000)),graceActive,canPublish:graceActive||approved};
}
export async function canProfessionalPublish(userId:string){
 const business=await prisma.businessProfile.findUnique({where:{userId},select:{verificationStatus:true,verificationProvider:true}});
 if(!business)return false;
 const r=await getProReverificationState(userId);
 if(r)return r.canPublish;
 return business.verificationStatus==="VERIFIED"&&business.verificationProvider==="manual_authority_and_registry";
}
import { deliverUserEvent } from "./notification-delivery.js";
function stage(dueAt:Date) {
 const ms=dueAt.getTime()-Date.now();
 return ms<=0?4:ms<=86400000?3:ms<=3*86400000?2:ms<=7*86400000?1:0;
}
async function sendReminders(log:{error:(err:unknown)=>void}){
 const list=await prisma.$queryRawUnsafe<Array<{userId:string;dueAt:Date;lastReminderStage:number}>>(
 'SELECT r."userId",r."dueAt",r."lastReminderStage" FROM "ProReverification" r JOIN "User" u ON u."id"=r."userId" WHERE r."status"=$1 AND u."status"=$2 LIMIT 200',"PENDING","ACTIVE");
 for(const r of list){
  const step=stage(r.dueAt);if(step<=r.lastReminderStage)continue;
  const claimed=await prisma.$queryRawUnsafe<Array<{userId:string}>>(
  'UPDATE "ProReverification" SET "lastReminderStage"=$2,"updatedAt"=CURRENT_TIMESTAMP WHERE "userId"=$1 AND "status"=$3 AND "lastReminderStage"<$2 RETURNING "userId"',r.userId,step,"PENDING");
  if(!claimed.length)continue;
  const deadline=new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"long",year:"numeric",timeZone:"Europe/Paris"}).format(r.dueAt);
  const title=step===4?"Vérification Pro : délai dépassé":step===0?"Votre compte professionnel doit être vérifié":"Rappel de vérification professionnelle";
  const body=step===4?"Le délai est dépassé. Vos annonces actuelles restent visibles mais vous ne pouvez plus publier avant approbation."
    :"Pour sécuriser votre compte, transmettez votre Kbis/RNE et une preuve de représentation avant le "+deadline+". Vos annonces publiées restent visibles.";
  try{
   await deliverUserEvent({userId:r.userId,eventKind:"LISTING",notificationKind:"SECURITY",title,body,actionUrl:"/espace-pro/entreprise",transactional:true,forceInApp:true,dedupeKey:"pro-reverify-"+step,metadata:{purpose:"PRO_REVERIFICATION",deadline,stage:step}});
  }catch(err){
   log.error(err);
   await prisma.$executeRawUnsafe('UPDATE "ProReverification" SET "lastReminderStage"=$2 WHERE "userId"=$1 AND "status"=$3 AND "lastReminderStage"=$4',r.userId,r.lastReminderStage,"PENDING",step).catch(e=>log.error(e));
  }
 }
}
let running=false;
export function startProReverificationWorker(log:{error:(err:unknown)=>void}){
 if(running)return;running=true;
 const tick=()=>void sendReminders(log).catch(e=>log.error(e));
 tick();const timer=setInterval(tick,6*60*60*1000);timer.unref();
}
