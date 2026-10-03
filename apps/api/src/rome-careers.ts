import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getRuntimeIntegration } from "./admin-control.js";

// ROME 4.0 data is available under the French Open Licence.
// Cache public métier pages and rate-limit upstream to <=1 request/second.
const TOKEN_URL="https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire";
const ROOT="https://api.francetravail.io/partenaire/";
const scopes={
 metiers:"api_rome-metiersv1 nomenclatureRome",
 fiches:"api_rome-fiches-metiersv1 nomenclatureRome"
} as const;
type Role={
 code:string;name:string;definition:string|null;access:string|null;domain:string|null;
 appellations:string[];skills:string[];knowledge:string[];source:"ROME 4.0 · France Travail"
};
const cache=new Map<string,{until:number;role:Role}>();
const tasks=new Map<string,Promise<Role>>();
const accessTokens=new Map<string,{until:number;value:string}>();
let nextCallAt=0;
let queued=0;
let queue:Promise<unknown>=Promise.resolve();
const clean=(value:unknown,max=400)=>typeof value==="string"?value.replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim().slice(0,max):"";
function texts(value:unknown,max=9):string[]{
 if(!Array.isArray(value))return[];
 return Array.from(new Set(value.map(v=>clean(typeof v==="string"?v:typeof v==="object"&&v!==null?(v as {libelle?:unknown}).libelle:undefined,130)).filter(Boolean))).slice(0,max);
}
async function oauth(id:string,secret:string,kind:keyof typeof scopes):Promise<string>{
 const fingerprint=createHash("sha256").update(id+"\0"+secret+"\0"+kind).digest("hex");
 const old=accessTokens.get(fingerprint);
 if(old&&old.until>Date.now())return old.value;
 const form=new URLSearchParams({client_id:id,client_secret:secret,grant_type:"client_credentials",scope:scopes[kind]});
 const res=await fetch(TOKEN_URL,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:form,signal:AbortSignal.timeout(9000)});
 if(!res.ok)throw new Error("rome_oauth_"+res.status);
 const json=await res.json() as {access_token?:string;expires_in?:number};
 if(!json.access_token)throw new Error("rome_oauth_missing_token");
 accessTokens.set(fingerprint,{value:json.access_token,until:Date.now()+(Math.max(120,Number(json.expires_in??1400)-100)*1000)});
 if(accessTokens.size>12)accessTokens.clear();
 return json.access_token;
}
async function upstream(url:string,bearer:string){
 if(queued>=10)throw new Error("rome_busy");
 ++queued;
 const previous=queue;
 const run=(async()=>{
  await previous.catch(()=>{});
  const ms=Math.max(0,nextCallAt-Date.now());
  if(ms)await new Promise(resolve=>setTimeout(resolve,ms));
  nextCallAt=Date.now()+1250;
  const res=await fetch(url,{headers:{authorization:"Bearer "+bearer,accept:"application/json"},signal:AbortSignal.timeout(12000)});
  if(!res.ok)throw new Error("rome_api_"+res.status);
  return res.json() as Promise<Record<string,unknown>>;
 })();
 queue=run.catch(()=>{});
 try{return await run}finally{queued--}
}
async function load(code:string,id:string,secret:string):Promise<Role>{
 const fingerprint=createHash("sha256").update(id+"\0"+secret).digest("hex");
 const cacheKey=code+":"+fingerprint;
 const old=cache.get(cacheKey);if(old&&old.until>Date.now())return old.role;
 const ongoing=tasks.get(cacheKey);if(ongoing)return ongoing;
 const task=(async()=>{
  const metierToken=await oauth(id,secret,"metiers");
  const metier=await upstream(ROOT+"rome-metiers/v1/metiers/metier/"+code,metierToken);
  const ficheToken=await oauth(id,secret,"fiches");
  const fiche=await upstream(ROOT+"rome-fiches-metiers/v1/fiches-rome/fiche-metier/"+code,ficheToken);
  const groups=Array.isArray(fiche.groupesCompetencesMobilisees)?fiche.groupesCompetencesMobilisees:[];
  const knowledgeGroups=Array.isArray(fiche.groupesSavoirs)?fiche.groupesSavoirs:[];
  const skills=texts(groups.flatMap(g=>typeof g==="object"&&g?((g as {competences?:unknown}).competences??[]):[]),14);
  const knowledge=texts(knowledgeGroups.flatMap(g=>typeof g==="object"&&g?((g as {savoirs?:unknown}).savoirs??[]):[]),10);
  const role:Role={code,name:clean(metier.libelle,160)||clean((fiche.metier as any)?.libelle,160)||code,
   definition:clean(metier.definition,2500)||null,
   access:clean(metier.accesEmploi,1600)||null,
   domain:clean((metier.domaineProfessionnel as any)?.libelle,150)||null,
   appellations:texts(metier.appellations,12),skills,knowledge,source:"ROME 4.0 · France Travail"};
  cache.set(cacheKey,{until:Date.now()+12*3600_000,role});
  if(cache.size>400){for(const [k,v] of cache){if(v.until<=Date.now())cache.delete(k)}if(cache.size>400)cache.delete(cache.keys().next().value!)}
  return role;
 })();
 tasks.set(cacheKey,task);
 try{return await task}finally{tasks.delete(cacheKey)}
}
export async function registerRomeCareerRoutes(app:FastifyInstance){
 app.get("/public/emploi/rome/metiers/:code",async(request,reply)=>{
  const parsed=z.object({code:z.string().regex(/^[A-Z][0-9]{4}$/)}).safeParse(request.params);
  if(!parsed.success)return reply.code(400).send({error:"invalid_rome_code"});
  const cfg=await getRuntimeIntegration("france-travail");
  if(!cfg?.enabled||!cfg.secrets.clientId||!cfg.secrets.clientSecret)
   return reply.header("cache-control","no-store").code(503).send({error:"rome_not_configured"});
  try{
   const role=await load(parsed.data.code,cfg.secrets.clientId,cfg.secrets.clientSecret);
   return reply.header("cache-control","public, max-age=1800, stale-while-revalidate=3600").send(role);
  }catch(err){
   const reason=err instanceof Error?err.message:"rome_failed";
   request.log.warn({reason,code:parsed.data.code},"rome_career_request_failed");
   if(reason==="rome_api_404")return reply.code(404).send({error:"role_not_found"});
   if(reason==="rome_busy")return reply.header("retry-after","5").code(429).send({error:"try_again_later"});
   return reply.header("cache-control","no-store").code(502).send({error:"rome_unavailable"});
  }
 });
}
