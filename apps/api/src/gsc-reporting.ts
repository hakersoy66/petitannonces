import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

type ServiceAccount={client_email?:string;private_key?:string};
type GscRow={keys?:string[];clicks?:number;impressions?:number;ctr?:number;position?:number};

export type GscSeoOpportunityType="QUICK_WIN"|"CTR_GAP"|"CONTENT_GAP"|"CANNIBALIZATION"|"LEGACY_URL";
export type GscSeoPriority="HIGH"|"MEDIUM"|"LOW";
export type GscSeoOpportunity={
 id:string;
 type:GscSeoOpportunityType;
 priority:GscSeoPriority;
 score:number;
 query:string|null;
 page:string|null;
 competingPages:string[];
 clicks:number;
 impressions:number;
 ctr:number;
 position:number;
 estimatedExtraClicks:number;
 title:string;
 reason:string;
 action:string;
};

export type GscSummary={
 connected:boolean;
 siteUrl:string;
 serviceAccountEmail:string|null;
 errorCode:string|null;
 errorMessage:string|null;
 settledThrough:string|null;
 performance:{days:number;clicks:number;impressions:number;ctr:number;position:number};
 topQueries:Array<{query:string;clicks:number;impressions:number;ctr:number;position:number}>;
 topPages:Array<{page:string;clicks:number;impressions:number;ctr:number;position:number}>;
 opportunities:Array<{query:string;clicks:number;impressions:number;ctr:number;position:number}>;
 seoOpportunities:GscSeoOpportunity[];
 opportunityCounts:{high:number;medium:number;low:number;quickWins:number;ctrGaps:number;contentGaps:number;cannibalization:number;legacyUrls:number;resolvedRedirects:number};
 source:"GSC_API";
};

const TOKEN_AUD="https://oauth2.googleapis.com/token";
const SCOPE="https://www.googleapis.com/auth/webmasters.readonly";
let tokenCache:{token:string;expiresAt:number}|null=null;
const cache=new Map<number,{expiresAt:number;value:GscSummary}>();

function b64url(v:string|Buffer){return Buffer.from(v).toString("base64url")}
function serviceAccountFile(){return process.env.GA4_SERVICE_ACCOUNT_FILE??process.env.FCM_SERVICE_ACCOUNT_FILE??"/var/www/petitannonces/shared/android-firebase/fcm-service-account.json"}
function siteUrl(){return (process.env.GSC_SITE_URL??"sc-domain:petitannonces.fr").trim()}
async function credential(){const raw=await readFile(serviceAccountFile(),"utf8");const p=JSON.parse(raw) as ServiceAccount;const email=p.client_email?.trim()??"";const key=p.private_key??"";if(!email||!key)throw new Error("gsc_service_account_invalid");return{email,key}}
async function accessToken(){
 if(tokenCache&&tokenCache.expiresAt>Date.now()+60_000)return tokenCache.token;
 const c=await credential();const now=Math.floor(Date.now()/1000);
 const h=b64url(JSON.stringify({alg:"RS256",typ:"JWT"}));const p=b64url(JSON.stringify({iss:c.email,scope:SCOPE,aud:TOKEN_AUD,iat:now,exp:now+3600}));const unsigned=`${h}.${p}`;
 const signer=createSign("RSA-SHA256");signer.update(unsigned);signer.end();const assertion=`${unsigned}.${signer.sign(c.key).toString("base64url")}`;
 const r=await fetch(TOKEN_AUD,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion})});
 const j=await r.json().catch(()=>({})) as {access_token?:string;expires_in?:number;error?:string;error_description?:string};if(!r.ok||!j.access_token)throw new Error(j.error_description||j.error||`gsc_token_${r.status}`);
 tokenCache={token:j.access_token,expiresAt:Date.now()+Math.max(300,Number(j.expires_in??3600)-60)*1000};return j.access_token
}
async function query(body:Record<string,unknown>){const token=await accessToken();const r=await fetch(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl())}/searchAnalytics/query`,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify(body)});const j=await r.json().catch(()=>({})) as any;if(!r.ok){const err=new Error(String(j?.error?.message??`gsc_${r.status}`)) as Error&{status?:number;code?:string};err.status=r.status;err.code=String(j?.error?.status??"");throw err}return j}
function classify(error:unknown){const e=error as Error&{status?:number;code?:string};const msg=String(e?.message??"gsc_reporting_error");if(e.status===403&&/has not been used|disabled|SERVICE_DISABLED/i.test(msg))return{code:"api_disabled",message:"Google Search Console API doit être activée dans le projet Google Cloud."};if(e.status===403)return{code:"permission_missing",message:"Le compte de service n’a pas encore accès à la propriété Search Console."};if(e.status===404)return{code:"property_not_found",message:"La propriété Search Console configurée est introuvable."};return{code:e.code||"reporting_error",message:msg.slice(0,300)}}
function iso(d:Date){return d.toISOString().slice(0,10)}
function metric(row:GscRow|undefined){return{clicks:Number(row?.clicks??0),impressions:Number(row?.impressions??0),ctr:Number(row?.ctr??0)*100,position:Number(row?.position??0)}}
function priority(score:number):GscSeoPriority{return score>=72?"HIGH":score>=45?"MEDIUM":"LOW"}
function targetCtr(position:number){if(position<=3)return 20;if(position<=5)return 12;if(position<=10)return 7;if(position<=20)return 3;if(position<=30)return 1.5;return .8}
function pagePath(page:string){try{return new URL(page).pathname.replace(/\/+$/,"")||"/"}catch{return page}}
function isLegacyPage(page:string){
 const path=pagePath(page).toLowerCase();if(page.startsWith("http://"))return true;
 const canonicalStatic=new Set(["/","/assistance","/conditions-generales","/confidentialite","/conformite","/cookies","/deposer-annonce-gratuite","/deposer-une-annonce","/importer-une-annonce","/mentions-legales","/ouvrir-boutique-pro","/professionnels","/qui-sommes-nous","/recherche","/signaler-contenu-illicite","/vendre-voiture"]);
 if(canonicalStatic.has(path))return false;
 if(/^\/(annonce|boutique|c|categorie|immobilier|pro|profil|professionnels|vacances|vehicules|ville)(\/|$)/.test(path))return false;
 return true
}
async function resolvedLegacyRedirect(page:string){
 let current=page;let redirected=false;
 try{
  for(let hop=0;hop<4;hop++){
   const url=new URL(current);if(!["petitannonces.fr","www.petitannonces.fr"].includes(url.hostname))return false;
   const response=await fetch(url,{method:"HEAD",redirect:"manual",signal:AbortSignal.timeout(2500),headers:{"user-agent":"PetitAnnonces-SEO-Audit/1.0"}});
   if([301,302,307,308].includes(response.status)){
    const location=response.headers.get("location");if(!location)return false;
    current=new URL(location,url).toString();redirected=true;continue
   }
   return redirected&&response.status>=200&&response.status<400
  }
 }catch{}
 return false
}
function cleanId(value:string){return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,80)}
function estimatedExtraClicks(impressions:number,ctr:number,position:number){return Math.max(0,Math.round(impressions*Math.max(0,targetCtr(position)-ctr)/100))}

function queryOpportunity(row:{query:string;page:string;clicks:number;impressions:number;ctr:number;position:number}):GscSeoOpportunity|null{
 if(!row.query||row.query.toLowerCase().startsWith("site:")||row.impressions<2||isLegacyPage(row.page))return null;
 const benchmark=targetCtr(row.position);const ctrGap=Math.max(0,benchmark-row.ctr);const volume=Math.min(40,Math.log2(row.impressions+1)*7);
 let type:GscSeoOpportunityType;let title:string;let action:string;let positionScore:number;
 if(row.position<=10&&row.ctr<benchmark*.65){type="CTR_GAP";title="CTR à améliorer";action="Revoir le title et la meta description de cette landing page pour mieux reprendre l’intention exacte de la requête et rendre l’extrait Google plus attractif.";positionScore=30}
 else if(row.position>=4&&row.position<=20){type="QUICK_WIN";title="Requête proche de la première page";action="Renforcer cette landing page avec le vocabulaire de la requête, des liens internes contextuels et du contenu réellement utile sans créer de page dupliquée.";positionScore=row.position<=10?30:24}
 else if(row.position>20&&row.position<=35&&row.impressions>=4){type="CONTENT_GAP";title="Demande visible mais position encore faible";action="Étoffer la landing page qui répond déjà à cette requête. Ne créer une nouvelle page que si l’intention de recherche n’est pas correctement couverte par une URL existante.";positionScore=14}
 else return null;
 const score=Math.min(100,Math.round(volume+positionScore+Math.min(28,ctrGap*2.4)));
 return{id:`query-${cleanId(row.query)}-${cleanId(pagePath(row.page))}-${type.toLowerCase()}`,type,priority:priority(score),score,query:row.query,page:row.page,competingPages:[],clicks:row.clicks,impressions:row.impressions,ctr:row.ctr,position:row.position,estimatedExtraClicks:estimatedExtraClicks(row.impressions,row.ctr,row.position),title,reason:`${row.impressions} impressions · position ${row.position.toFixed(1)} · CTR ${row.ctr.toFixed(1)} %`,action};
}

async function buildSeoOpportunities(_qrows:Array<{query:string;clicks:number;impressions:number;ctr:number;position:number}>,queryPageRows:Array<{query:string;page:string;clicks:number;impressions:number;ctr:number;position:number}>){
 const queryItemsByQuery=new Map<string,GscSeoOpportunity>();
 for(const row of queryPageRows){
  const item=queryOpportunity(row);if(!item)continue;const key=row.query.trim().toLowerCase();const previous=queryItemsByQuery.get(key);
  if(!previous||item.score>previous.score||(item.score===previous.score&&item.impressions>previous.impressions))queryItemsByQuery.set(key,item)
 }
 const items:GscSeoOpportunity[]=[...queryItemsByQuery.values()];
 const byQuery=new Map<string,Array<(typeof queryPageRows)[number]>>();
 for(const row of queryPageRows){if(!row.query||row.query.toLowerCase().startsWith("site:")||isLegacyPage(row.page))continue;const key=row.query.trim().toLowerCase();const list=byQuery.get(key)??[];list.push(row);byQuery.set(key,list)}
 for(const rows of byQuery.values()){
  const pageMap=new Map<string,{page:string;impressions:number;clicks:number;weightedPosition:number}>();
  for(const row of rows){const key=pagePath(row.page);const current=pageMap.get(key)??{page:row.page,impressions:0,clicks:0,weightedPosition:0};current.weightedPosition+=row.position*row.impressions;current.impressions+=row.impressions;current.clicks+=row.clicks;pageMap.set(key,current)}
  const pages=[...pageMap.values()].filter(x=>x.impressions>=2).sort((a,b)=>b.impressions-a.impressions);const totalImpressions=pages.reduce((s,x)=>s+x.impressions,0);if(pages.length<2||totalImpressions<8)continue;
  const dominantShare=pages[0]!.impressions/totalImpressions;const bestPosition=Math.min(...pages.map(x=>x.weightedPosition/x.impressions));if(dominantShare>=.80||bestPosition>45)continue;
  const row=rows[0]!;const avgPosition=pages.reduce((s,x)=>s+x.weightedPosition,0)/totalImpressions;const clicks=pages.reduce((s,x)=>s+x.clicks,0);const score=Math.min(100,Math.round(42+Math.min(24,totalImpressions)+(1-dominantShare)*28+(bestPosition<=20?10:0)));
  items.push({id:`cannibal-${cleanId(row.query)}`,type:"CANNIBALIZATION",priority:priority(score),score,query:row.query,page:pages[0]!.page,competingPages:pages.slice(0,4).map(x=>x.page),clicks,impressions:totalImpressions,ctr:totalImpressions?clicks/totalImpressions*100:0,position:avgPosition,estimatedExtraClicks:0,title:"Plusieurs URL se concurrencent",reason:`${pages.length} pages visibles pour la même requête · la page principale ne concentre que ${Math.round(dominantShare*100)} % des impressions`,action:"Choisir une URL cible, renforcer ses liens internes et ses signaux sémantiques. Rediriger ou canonicaliser uniquement les variantes réellement obsolètes; conserver les pages locales distinctes lorsqu’elles répondent à des intentions différentes."});
 }
 const legacyByPage=new Map<string,{page:string;clicks:number;impressions:number;weightedPosition:number;queries:Set<string>}>();
 for(const row of queryPageRows){if(!isLegacyPage(row.page))continue;const current=legacyByPage.get(row.page)??{page:row.page,clicks:0,impressions:0,weightedPosition:0,queries:new Set<string>()};current.clicks+=row.clicks;current.impressions+=row.impressions;current.weightedPosition+=row.position*row.impressions;if(!row.query.toLowerCase().startsWith("site:"))current.queries.add(row.query);legacyByPage.set(row.page,current)}
 const legacyCandidates=[...legacyByPage.values()].filter(x=>x.impressions>=1).sort((a,b)=>b.impressions-a.impressions).slice(0,24);
 const redirectChecks=await Promise.all(legacyCandidates.map(async row=>({row,resolved:await resolvedLegacyRedirect(row.page)})));
 let resolvedRedirects=0;
 for(const {row,resolved} of redirectChecks){
  if(resolved){resolvedRedirects++;continue}
  const path=pagePath(row.page);const http=row.page.startsWith("http://");const score=Math.min(100,(http?82:72)+Math.min(16,row.impressions));
  items.push({id:`legacy-${cleanId(row.page)}`,type:"LEGACY_URL",priority:priority(score),score,query:[...row.queries][0]??null,page:row.page,competingPages:[],clicks:row.clicks,impressions:row.impressions,ctr:row.impressions?row.clicks/row.impressions*100:0,position:row.impressions?row.weightedPosition/row.impressions:0,estimatedExtraClicks:0,title:http?"Ancienne URL HTTP non résolue":"Ancienne route sans destination canonique",reason:`${path} · ${row.impressions} impression(s) détectée(s)`,action:http?"Vérifier la redirection HTTPS et sa destination finale. Une URL technique ne reste prioritaire que si la chaîne n’aboutit pas à une page canonique valide.":"Créer une redirection permanente uniquement si une page moderne équivalente existe. Sinon conserver un 404/410 propre et retirer tous les liens internes vers cette ancienne URL."});
 }
 const typeOrder:Record<GscSeoOpportunityType,number>={LEGACY_URL:0,CTR_GAP:1,QUICK_WIN:2,CANNIBALIZATION:3,CONTENT_GAP:4};
 const sorted=items.sort((a,b)=>b.score-a.score||typeOrder[a.type]-typeOrder[b.type]||b.impressions-a.impressions);
 const caps:Record<GscSeoOpportunityType,number>={LEGACY_URL:6,CTR_GAP:8,QUICK_WIN:8,CANNIBALIZATION:6,CONTENT_GAP:6};const used=new Map<GscSeoOpportunityType,number>();
 const visible=sorted.filter(item=>{const count=used.get(item.type)??0;if(count>=caps[item.type])return false;used.set(item.type,count+1);return true}).slice(0,30);
 return{items:visible,resolvedRedirects}
}
function opportunityCounts(items:GscSeoOpportunity[],resolvedRedirects=0){return{high:items.filter(x=>x.priority==="HIGH").length,medium:items.filter(x=>x.priority==="MEDIUM").length,low:items.filter(x=>x.priority==="LOW").length,quickWins:items.filter(x=>x.type==="QUICK_WIN").length,ctrGaps:items.filter(x=>x.type==="CTR_GAP").length,contentGaps:items.filter(x=>x.type==="CONTENT_GAP").length,cannibalization:items.filter(x=>x.type==="CANNIBALIZATION").length,legacyUrls:items.filter(x=>x.type==="LEGACY_URL").length,resolvedRedirects}}

export async function getGscSummary(days=28):Promise<GscSummary>{
 const d=Math.max(7,Math.min(365,Math.round(days)));const existing=cache.get(d);if(existing&&existing.expiresAt>Date.now())return existing.value;let email:string|null=null;try{email=(await credential()).email}catch{}
 const emptyCounts={high:0,medium:0,low:0,quickWins:0,ctrGaps:0,contentGaps:0,cannibalization:0,legacyUrls:0,resolvedRedirects:0};
 const base:GscSummary={connected:false,siteUrl:siteUrl(),serviceAccountEmail:email,errorCode:null,errorMessage:null,settledThrough:null,performance:{days:d,clicks:0,impressions:0,ctr:0,position:0},topQueries:[],topPages:[],opportunities:[],seoOpportunities:[],opportunityCounts:emptyCounts,source:"GSC_API"};
 try{
  const end=new Date();end.setUTCDate(end.getUTCDate()-2);const start=new Date(end);start.setUTCDate(start.getUTCDate()-(d-1));const common={startDate:iso(start),endDate:iso(end),dataState:"final"};
  const [summary,queries,pages,queryPages]=await Promise.all([
   query({...common,rowLimit:1}),
   query({...common,dimensions:["query"],rowLimit:500,startRow:0}),
   query({...common,dimensions:["page"],rowLimit:500,startRow:0}),
   query({...common,dimensions:["query","page"],aggregationType:"auto",rowLimit:1000,startRow:0}),
  ]);
  const qrows=((queries.rows??[]) as GscRow[]).map(r=>({query:String(r.keys?.[0]??""),...metric(r)})).filter(r=>r.query);
  const prows=((pages.rows??[]) as GscRow[]).map(r=>({page:String(r.keys?.[0]??""),...metric(r)})).filter(r=>r.page);
  const queryPageRows=((queryPages.rows??[]) as GscRow[]).map(r=>({query:String(r.keys?.[0]??""),page:String(r.keys?.[1]??""),...metric(r)})).filter(r=>r.query&&r.page);
  const {items:seoOpportunities,resolvedRedirects}=await buildSeoOpportunities(qrows,queryPageRows);
  const value:GscSummary={...base,connected:true,settledThrough:iso(end),performance:{days:d,...metric((summary.rows??[])[0])},topQueries:qrows.slice().sort((a,b)=>b.clicks-a.clicks||b.impressions-a.impressions).slice(0,30),topPages:prows.slice().sort((a,b)=>b.clicks-a.clicks||b.impressions-a.impressions).slice(0,30),opportunities:qrows.filter(r=>!r.query.toLowerCase().startsWith("site:")&&r.position>=5&&r.position<=20&&r.impressions>=3).sort((a,b)=>b.impressions-a.impressions||a.position-b.position).slice(0,30),seoOpportunities,opportunityCounts:opportunityCounts(seoOpportunities,resolvedRedirects)};
  cache.set(d,{expiresAt:Date.now()+5*60_000,value});return value
 }catch(error){const c=classify(error);const value={...base,errorCode:c.code,errorMessage:c.message};cache.set(d,{expiresAt:Date.now()+60_000,value});return value}
}