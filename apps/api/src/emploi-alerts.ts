import {prisma} from "@pa/database";
import {deliverUserEvent} from "./notification-delivery.js";
import {loadFranceTravailAlertOffers} from "./france-travail-offers.js";

type AlertRow={id:string;userId:string;name:string;query:string|null;filters:unknown;lastRunAt:Date|null};
type FtOffer={id:string;title:string;city:string|null;publishedAt:string|null};
const dept=/^(?:0[1-9]|[1-8][0-9]|9[0-5]|97[1-6]|98[4-8]|2A|2B)$/;
function criteria(row:AlertRow){
 if(!row.filters||typeof row.filters!=="object"||Array.isArray(row.filters))return null;
 const f=row.filters as Record<string,unknown>;
 if(f.kind!=="FRANCE_TRAVAIL_EMPLOI")return null;
 const departement=typeof f.departement==="string"&&dept.test(f.departement)?f.departement:undefined;
 const typeContrat:"CDI"|"CDD"|"MIS"|undefined=f.contrat==="CDI"?"CDI":f.contrat==="CDD"?"CDD":f.contrat==="MIS"?"MIS":undefined;
 const motsCles=row.query?.trim().slice(0,80)||undefined;
 if(!departement&&!motsCles)return null;
 const seenIds=Array.isArray(f.seenIds)?f.seenIds.filter((v):v is string=>typeof v==="string"&&/^[A-Za-z0-9]{6,18}$/.test(v)).slice(-160):[];
 return {filters:{departement,motsCles,typeContrat},seenIds,stored:f};
}
let working=false;
export async function sweepFranceTravailJobAlerts(){
 if(working)return{processed:0,sent:0,failed:0,busy:true};
 working=true;
 let processed=0,sent=0,failed=0;
 try{
  const alerts=await prisma.$queryRawUnsafe<AlertRow[]>(
   'SELECT s."id",s."userId",s."name",s."query",s."filters",s."lastRunAt" FROM "SavedSearch" s JOIN "User" u ON u."id"=s."userId" WHERE s."alertEnabled"=TRUE AND s."frequency"=\'DAILY\' AND s."categorySlug"=\'emploi\' AND s."filters"->>\'kind\'=\'FRANCE_TRAVAIL_EMPLOI\' AND u."status"=\'ACTIVE\' AND (s."lastRunAt" IS NULL OR s."lastRunAt"<NOW()-INTERVAL \'23 hours\') ORDER BY s."lastRunAt" ASC NULLS FIRST LIMIT 15'
  );
  for(const row of alerts){
   const config=criteria(row);
   if(!config)continue;
   processed++;
   try{
    const offers=await loadFranceTravailAlertOffers(config.filters) as FtOffer[];
    const prior=new Set(config.seenIds);
    const after=row.lastRunAt instanceof Date?row.lastRunAt.getTime():Date.now()-86400000;
    const newest=offers.filter(o=>{
      if(prior.has(o.id)||!o.publishedAt)return false;
      const date=Date.parse(o.publishedAt);
      return Number.isFinite(date)&&date>after-300_000&&date<=Date.now()+3600000;
    }).slice(0,5);
    if(newest.length){
     const titles=newest.map(o=>"• "+o.title+(o.city?" · "+o.city:"")).join("\n");
     const search=new URLSearchParams();
     if(config.filters.motsCles)search.set("ft_q",config.filters.motsCles);
     if(config.filters.departement)search.set("ft_dept",config.filters.departement);
     if(config.filters.typeContrat)search.set("ft_contract",config.filters.typeContrat);
     const dateKey=new Date().toISOString().slice(0,10);
     await deliverUserEvent({
      userId:row.userId,eventKind:"LISTING",notificationKind:"SEARCH",
      title:newest.length===1?"Une nouvelle offre pour votre alerte Emploi":newest.length+" nouvelles offres pour votre alerte Emploi",
      body:"Alerte « "+row.name+" » :\n"+titles+"\n\nVous pouvez désactiver cette alerte dans Mon compte > Recherches enregistrées.",
      actionUrl:"/categorie/emploi?"+search.toString()+"#offres-officielles",
      metadata:{savedSearchId:row.id,source:"FRANCE_TRAVAIL_EMPLOI",matchCount:newest.length,offerIds:newest.map(o=>o.id)},
      dedupeKey:"emploi-ft:"+row.id+":"+dateKey
     });
     sent++;
    }
    const seen=Array.from(new Set([...config.seenIds,...offers.map(o=>o.id)])).slice(-160);
    await prisma.$executeRawUnsafe('UPDATE "SavedSearch" SET "filters"=$1::jsonb,"lastRunAt"=NOW(),"updatedAt"=NOW() WHERE "id"=$2 AND "userId"=$3 AND "alertEnabled"=TRUE',JSON.stringify({...config.stored,seenIds:seen}),row.id,row.userId);
   }catch{failed++}
  }
  return{processed,sent,failed};
 }finally{working=false}
}
