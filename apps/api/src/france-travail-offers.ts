import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getRuntimeIntegration } from "./admin-control.js";
import { requireAdminRoles } from "./rbac.js";

// API keys are never transmitted to clients: only the server exchanges OAuth tokens.
const TOKEN_URL = "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire";
const API_URL = "https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search";
type Credentials = { id:string;secret:string;licensed:boolean;enabled:boolean;ready:boolean };
type Offer = {
 id:string;title:string;company:string|null;city:string|null;contract:string|null;
 salary:string|null;publishedAt:string|null;description:string|null;romeCode:string|null;source:"FRANCE_TRAVAIL";applyUrl:string;
};
let accessToken: {value:string; validUntil:number;fingerprint:string}|null=null;
const responseCache=new Map<string,{expires:number;items:Offer[]}>();
const inFlightByQuery=new Map<string,Promise<Offer[]>>();
let lastFingerprint="";

async function credentials():Promise<Credentials>{
 const saved=await getRuntimeIntegration("france-travail");
 if(saved){
  const id=String(saved.secrets.clientId??"").trim();
  const secret=String(saved.secrets.clientSecret??"").trim();
  const licensed=saved.config.licenceApproved==="oui";
  const enabled=Boolean(saved.enabled);
  return {id,secret,licensed,enabled,ready:Boolean(id&&secret&&enabled&&licensed)};
 }
 const id=String(process.env.FRANCE_TRAVAIL_CLIENT_ID??"").trim();
 const secret=String(process.env.FRANCE_TRAVAIL_CLIENT_SECRET??"").trim();
 const licensed=process.env.FRANCE_TRAVAIL_REDISTRIBUTION_APPROVED==="true";
 return {id,secret,licensed,enabled:true,ready:Boolean(id&&secret&&licensed)};
}

async function token(id:string,secret:string){
 const fingerprint=createHash("sha256").update(id+"\u0000"+secret).digest("hex");
 if(lastFingerprint!==fingerprint){responseCache.clear();inFlightByQuery.clear();lastFingerprint=fingerprint}
 if(accessToken?.validUntil&&accessToken.fingerprint===fingerprint&&Date.now()<accessToken.validUntil)return accessToken.value;
 const form=new URLSearchParams({grant_type:"client_credentials",client_id:id,client_secret:secret,scope:"api_offresdemploiv2 o2dsoffre"});
 const r=await fetch(TOKEN_URL,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:form,signal:AbortSignal.timeout(9000)});
 if(!r.ok){
  const errorBody=await r.json().catch(()=>null) as {error?:string}|null;
  const category=errorBody?.error==="invalid_client"?"invalid_client":errorBody?.error==="invalid_scope"?"invalid_scope":errorBody?.error==="unauthorized_client"?"unauthorized_client":"http_"+r.status;
  throw new Error("france_travail_oauth_"+category);
 }
 const data=await r.json() as {access_token?:string;expires_in?:number};
 if(!data.access_token)throw new Error("france_travail_oauth_missing_token");
 accessToken={value:data.access_token,validUntil:Date.now()+Math.max(60,Number(data.expires_in??1400)-90)*1000,fingerprint};
 return accessToken.value;
}

function normalize(input:unknown):Offer|null{
 if(!input||typeof input!=="object")return null;
 const x=input as Record<string,any>,id=String(x.id??"").trim();
 if(!/^[a-zA-Z0-9]{6,18}$/.test(id))return null;
 const title=String(x.intitule??"").trim().slice(0,240);
 if(!title)return null;
 return{
  id,title,company:String(x.entreprise?.nom??"").trim().slice(0,200)||null,
  city:String(x.lieuTravail?.libelle??"").trim().slice(0,140)||null,
  contract:String(x.typeContratLibelle??x.typeContrat??"").trim().slice(0,120)||null,
  salary:String(x.salaire?.libelle??"").trim().slice(0,140)||null,
  romeCode:typeof x.romeCode==="string"&&/^[A-Z][0-9]{4}$/.test(x.romeCode)?x.romeCode:null,
  publishedAt:typeof x.dateCreation==="string"?x.dateCreation:null,
  description:typeof x.description==="string"?x.description.replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,300):null,
  source:"FRANCE_TRAVAIL",applyUrl:"https://candidat.francetravail.fr/offres/recherche/detail/"+encodeURIComponent(id),
 };
}

type SearchFilters={departement?:string;motsCles?:string;typeContrat?:"CDI"|"CDD"|"MIS";page?:number};
async function fetchOffers(bearer:string,filters:SearchFilters={}):Promise<Offer[]>{
 const page=Math.max(1,Math.min(5,filters.page??1));
 const query=new URLSearchParams({range:`${(page-1)*12}-${page*12-1}`});
 if(filters.departement)query.set("departement",filters.departement);
 if(filters.motsCles)query.set("motsCles",filters.motsCles);
 if(filters.typeContrat)query.set("typeContrat",filters.typeContrat);
 const r=await fetch(API_URL+"?"+query,{headers:{authorization:"Bearer "+bearer,accept:"application/json"},signal:AbortSignal.timeout(12000)});
 if(r.status===401)accessToken=null;
 if(!r.ok)throw new Error("france_travail_search_"+r.status);
 const payload=await r.json() as {resultats?:unknown[]};
 const seen=new Set<string>();
 return(Array.isArray(payload.resultats)?payload.resultats:[])
  .map(normalize).filter((item):item is Offer=>Boolean(item))
  .filter(item=>{if(seen.has(item.id))return false;seen.add(item.id);return true});
}

async function loadOffers(conf:Credentials,filters:SearchFilters={}):Promise<Offer[]>{
 const key=JSON.stringify([filters.departement??"",filters.motsCles??"",filters.typeContrat??"",filters.page??1]);
 const fingerprint=createHash("sha256").update(conf.id+"\u0000"+conf.secret).digest("hex");
 if(lastFingerprint!==fingerprint){responseCache.clear();inFlightByQuery.clear();lastFingerprint=fingerprint}
 const cached=responseCache.get(key);
 if(cached&&cached.expires>Date.now()&&accessToken?.fingerprint===lastFingerprint)return cached.items;
 const ongoing=inFlightByQuery.get(key);if(ongoing)return ongoing;
 const perform=async()=>{
  const bearer=await token(conf.id,conf.secret);
  const items=await fetchOffers(bearer,filters);
  responseCache.set(key,{expires:Date.now()+5*60_000,items});
  if(responseCache.size>35)for(const [k,v] of responseCache)if(v.expires<Date.now())responseCache.delete(k);
  return items;
 };
 const job=perform();inFlightByQuery.set(key,job);try{return await job}finally{if(inFlightByQuery.get(key)===job)inFlightByQuery.delete(key)}
}

export async function registerFranceTravailRoutes(app:FastifyInstance){
 app.post("/admin/integrations/france-travail/check-apis",{preHandler:requireAdminRoles(["SUPER_ADMIN","ADMIN"])},async (_request,reply)=>{
  const conf=await credentials();
  if(!conf.id||!conf.secret)return reply.code(409).send({error:"france_travail_credentials_missing"});
  const products=[
   {id:"rome-metiers",scope:"api_rome-metiersv1 nomenclatureRome"},
   {id:"rome-fiches",scope:"api_rome-fiches-metiersv1 nomenclatureRome"},
   {id:"bonne-boite",scope:"api_labonneboitev2"},
  ];
  const results: Array<{id:string;status:"authorized_scope"|"subscription_required"|"credentials_invalid"|"unavailable"|"data_access_pending"|"documentation_required"}>=[];
  for(const product of products){
   try{
    const params=new URLSearchParams({grant_type:"client_credentials",client_id:conf.id,client_secret:conf.secret,scope:product.scope});
    const response=await fetch(TOKEN_URL,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:params,signal:AbortSignal.timeout(9000)});
    const body=await response.json().catch(()=>null) as {error?:string;access_token?:string}|null;
    let status:"authorized_scope"|"subscription_required"|"credentials_invalid"|"unavailable"|"data_access_pending"|"documentation_required"=response.ok&&Boolean(body?.access_token)?"authorized_scope"
      :body?.error==="invalid_scope"||body?.error==="unauthorized_client"?"subscription_required"
      :body?.error==="invalid_client"?"credentials_invalid":"unavailable";
    if(product.id==="bonne-boite"&&status==="authorized_scope"&&body?.access_token){
     try{
      const probe=await fetch("https://api.francetravail.io/partenaire/labonneboite/v2/entreprises?rome=M1607&latitude=48.8566&longitude=2.3522",{headers:{authorization:"Bearer "+body.access_token,accept:"application/json"},signal:AbortSignal.timeout(9000)});
      status=probe.ok?"authorized_scope":probe.status===403?"data_access_pending":"documentation_required";
     }catch{status="unavailable"}
    }
    results.push({id:product.id,status});
   }catch{results.push({id:product.id,status:"unavailable"})}
  }
  results.push({id:"events",status:"documentation_required"});
  results.push({id:"market",status:"documentation_required"});
  return reply.header("cache-control","no-store").send({results,notice:"A valid OAuth scope does not by itself establish downstream API access or redistribution rights."});
 });
 app.get("/public/emploi/france-travail",async(request,reply)=>{
  const parsed=z.object({
  departement:z.string().regex(/^(?:0[1-9]|[1-8][0-9]|9[0-5]|97[1-6]|98[4-8]|2A|2B)$/).optional(),
  motsCles:z.string().trim().min(2).max(80).regex(/^[\p{L}\p{N}\p{M}\s.,’\u0027&+\-\/()]+$/u).optional(),
  typeContrat:z.enum(["CDI","CDD","MIS"]).optional(),
  page:z.coerce.number().int().min(1).max(5).optional(),
 }).strict().safeParse(request.query);
  if(!parsed.success)return reply.code(400).send({error:"invalid_filter"});
  const conf=await credentials();
  if(!conf.ready)return reply.header("cache-control","no-store").code(503).send({
   enabled:false,reason:!conf.enabled?"disabled":!conf.id||!conf.secret?"credentials_missing":"redistribution_not_approved",items:[]
  });
  try{
   const items=await loadOffers(conf,parsed.data);
   return reply.header("cache-control","public, max-age=180, stale-while-revalidate=120")
    .send({enabled:true,source:"France Travail",updatedAt:new Date().toISOString(),items,page:parsed.data.page??1,hasMore:items.length===12});
  }catch(error){
   request.log.warn({reason:error instanceof Error?error.message:"request_failed"},"france_travail_fetch_failed");
   return reply.header("cache-control","no-store").code(502).send({enabled:false,reason:"upstream_unavailable",items:[]});
  }
 });
 app.post("/admin/integrations/france-travail/test",{preHandler:requireAdminRoles(["SUPER_ADMIN","ADMIN"])},async(request,reply)=>{
  const conf=await credentials();
  if(!conf.id||!conf.secret||!conf.enabled)return reply.code(409).send({error:"france_travail_credentials_missing"});
  try{
   const bearer=await token(conf.id,conf.secret);
   const items=await fetchOffers(bearer);
   return reply.header("cache-control","no-store").send({
    ok:true,authenticated:true,searchWorking:true,sampleCount:items.length,
    canPublish:conf.ready,licenceApproved:conf.licensed,
   });
  }catch(error){
   const reason=error instanceof Error?error.message:"france_travail_test_failed";
   request.log.warn({reason},"france_travail_admin_test_failed");
   return reply.header("cache-control","no-store").code(502).send({error:reason});
  }
 });
}
