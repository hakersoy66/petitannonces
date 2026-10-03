import type { FastifyInstance } from "fastify";
import { z } from "zod";

/** France Travail partner API. Client secret NEVER leaves the API server. */
const TOKEN_URL = "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire";
const API_URL = "https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search";
type Offer = {
  id:string; title:string; company:string|null; city:string|null; contract:string|null;
  salary:string|null; publishedAt:string|null; description:string|null; source:"FRANCE_TRAVAIL"; applyUrl:string;
};
let accessToken:{value:string;validUntil:number}|null=null;
const responseCache=new Map<string,{expires:number;items:Offer[]}>();
let inFlight:Promise<Offer[]>|null=null;

function credentials(){
 const id=(process.env.FRANCE_TRAVAIL_CLIENT_ID??"").trim();
 const secret=(process.env.FRANCE_TRAVAIL_CLIENT_SECRET??"").trim();
 const licensed=process.env.FRANCE_TRAVAIL_REDISTRIBUTION_APPROVED==="true";
 return {id,secret,licensed,ready:Boolean(id&&secret&&licensed)};
}
async function token(id:string,secret:string){
 if(accessToken?.validUntil&&Date.now()<accessToken.validUntil)return accessToken.value;
 const form=new URLSearchParams({grant_type:"client_credentials",client_id:id,client_secret:secret,scope:"api_offresdemploiv2 o2dsoffre"});
 const r=await fetch(TOKEN_URL,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:form,signal:AbortSignal.timeout(9000)});
 if(!r.ok)throw new Error("france_travail_oauth_"+r.status);
 const data=await r.json() as {access_token?:string;expires_in?:number};
 if(!data.access_token)throw new Error("france_travail_oauth_missing_token");
 accessToken={value:data.access_token,validUntil:Date.now()+Math.max(60,Number(data.expires_in??1400)-90)*1000};
 return accessToken.value;
}
function normalize(input:unknown):Offer|null{
 if(!input||typeof input!=="object")return null;
 const x=input as Record<string,any>, id=String(x.id??"").trim();
 if(!/^[a-zA-Z0-9]{6,18}$/.test(id))return null;
 const title=String(x.intitule??"").trim().slice(0,240);
 if(!title)return null;
 return {
  id,title,company:String(x.entreprise?.nom??"").trim().slice(0,200)||null,
  city:String(x.lieuTravail?.libelle??"").trim().slice(0,140)||null,
  contract:String(x.typeContratLibelle??x.typeContrat??"").trim().slice(0,120)||null,
  salary:String(x.salaire?.libelle??"").trim().slice(0,140)||null,
  publishedAt:typeof x.dateCreation==="string"?x.dateCreation:null,
  description:typeof x.description==="string"?x.description.replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,300):null,
  source:"FRANCE_TRAVAIL",applyUrl:"https://candidat.francetravail.fr/offres/recherche/detail/"+encodeURIComponent(id)
 };
}
async function loadOffers(department?:string):Promise<Offer[]>{
 const conf=credentials();if(!conf.ready)return[];
 const key=department??"fr";
 const cached=responseCache.get(key);if(cached&&cached.expires>Date.now())return cached.items;
 // Avoid duplicate partner requests for the national feed under traffic spikes.
 if(key==="fr"&&inFlight)return inFlight;
 const perform=async()=>{
  const bearer=await token(conf.id,conf.secret);
  const query=new URLSearchParams({range:"0-19"});
  if(department)query.set("departement",department);
  const r=await fetch(API_URL+"?"+query.toString(),{headers:{authorization:"Bearer "+bearer,accept:"application/json"},signal:AbortSignal.timeout(12000)});
  if(r.status===401)accessToken=null;
  if(!r.ok)throw new Error("france_travail_search_"+r.status);
  const payload=await r.json() as {resultats?:unknown[]};
  const ids=new Set<string>();
  const items=(Array.isArray(payload.resultats)?payload.resultats:[]).map(normalize).filter((item):item is Offer=>Boolean(item)).filter(item=>{if(ids.has(item.id))return false;ids.add(item.id);return true});
  responseCache.set(key,{expires:Date.now()+5*60_000,items});
  if(responseCache.size>35){for(const [k,v] of responseCache)if(v.expires<Date.now())responseCache.delete(k)}
  return items;
 };
 if(key==="fr"){
  inFlight=perform();
  try{return await inFlight}finally{inFlight=null}
 }
 return perform();
}
export async function registerFranceTravailRoutes(app:FastifyInstance){
 app.get("/public/emploi/france-travail",async(request,reply)=>{
  const parsed=z.object({departement:z.string().regex(/^(?:0[1-9]|[1-8][0-9]|9[0-5]|97[1-6]|98[4-8]|2A|2B)$/).optional()}).safeParse(request.query);
  if(!parsed.success)return reply.code(400).send({error:"invalid_filter"});
  const conf=credentials();
  if(!conf.ready)return reply.code(503).send({enabled:false,reason:!conf.id||!conf.secret?"credentials_missing":"redistribution_not_approved",items:[]});
  try{
   const items=await loadOffers(parsed.data.departement);
   return reply.header("cache-control","public, max-age=180, stale-while-revalidate=120").send({enabled:true,source:"France Travail",updatedAt:new Date().toISOString(),items});
  }catch(error){
   request.log.warn({reason:error instanceof Error?error.message:"request_failed"},"france_travail_fetch_failed");
   return reply.code(502).send({enabled:false,reason:"upstream_unavailable",items:[]});
  }
 });
}
