import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

type ServiceAccount={client_email?:string;private_key?:string};
type SearchAnalyticsRow={keys?:string[];clicks?:number;impressions?:number;ctr?:number;position?:number};

export type SearchConsoleOrganicRow={query:string;page:string;clicks:number;impressions:number;ctr:number;position:number};
export type SearchConsoleOrganicReport={
  connected:boolean;
  siteUrl:string;
  serviceAccountEmail:string|null;
  source:"GOOGLE_API"|"WINDSOR_SNAPSHOT"|null;
  syncedAt:string|null;
  errorCode:string|null;
  errorMessage:string|null;
  startDate:string|null;
  endDate:string|null;
  clicks:number;
  impressions:number;
  ctr:number;
  position:number;
  rows:SearchConsoleOrganicRow[];
};

const TOKEN_AUD="https://oauth2.googleapis.com/token";
const SCOPE="https://www.googleapis.com/auth/webmasters.readonly";
const DEFAULT_SITE="sc-domain:petitannonces.fr";
let tokenCache:{token:string;expiresAt:number}|null=null;
const reportCache=new Map<number,{expiresAt:number;value:SearchConsoleOrganicReport}>();

function b64url(value:string|Buffer){return Buffer.from(value).toString("base64url")}
function num(value:unknown){const n=Number(value??0);return Number.isFinite(n)?n:0}
function siteUrl(){return (process.env.GSC_SITE_URL??DEFAULT_SITE).trim()||DEFAULT_SITE}
function serviceAccountFile(){return process.env.GSC_SERVICE_ACCOUNT_FILE??process.env.GA4_SERVICE_ACCOUNT_FILE??process.env.FCM_SERVICE_ACCOUNT_FILE??"/var/www/petitannonces/shared/android-firebase/fcm-service-account.json"}
function snapshotFile(){return process.env.GSC_WINDSOR_SNAPSHOT_FILE??"/var/www/petitannonces/shared/search-console-windsor-snapshot.json"}
type WindsorSnapshotWindow={startDate?:string;endDate?:string;clicks?:number;impressions?:number;ctr?:number;position?:number;rows?:SearchConsoleOrganicRow[]};
type WindsorSnapshot={source?:string;syncedAt?:string;siteUrl?:string;windows?:Record<string,WindsorSnapshotWindow>};
async function snapshotReport(days:number,email:string|null):Promise<SearchConsoleOrganicReport|null>{
  try{
    const parsed=JSON.parse(await readFile(snapshotFile(),"utf8")) as WindsorSnapshot;
    const window=parsed.windows?.[String(days)];if(!window)return null;
    const rows=(Array.isArray(window.rows)?window.rows:[]).map(row=>({query:String(row.query??"(requête masquée)"),page:String(row.page??""),clicks:num(row.clicks),impressions:num(row.impressions),ctr:num(row.ctr),position:num(row.position)}));
    return{connected:true,siteUrl:String(parsed.siteUrl||siteUrl()),serviceAccountEmail:email,source:"WINDSOR_SNAPSHOT",syncedAt:parsed.syncedAt?String(parsed.syncedAt):null,errorCode:null,errorMessage:null,startDate:window.startDate?String(window.startDate):null,endDate:window.endDate?String(window.endDate):null,clicks:num(window.clicks),impressions:num(window.impressions),ctr:num(window.ctr),position:num(window.position),rows};
  }catch{return null}
}
function isoDay(date:Date){return date.toISOString().slice(0,10)}
function dateRange(days:number){
  const end=new Date();end.setUTCHours(12,0,0,0);end.setUTCDate(end.getUTCDate()-2);
  const start=new Date(end);start.setUTCDate(start.getUTCDate()-(days-1));
  return{startDate:isoDay(start),endDate:isoDay(end)};
}

async function credential(){
  const raw=await readFile(serviceAccountFile(),"utf8");
  const parsed=JSON.parse(raw) as ServiceAccount;
  const email=parsed.client_email?.trim()??"";const key=parsed.private_key??"";
  if(!email||!key)throw new Error("gsc_service_account_invalid");
  return{email,key};
}

async function accessToken(){
  if(tokenCache&&tokenCache.expiresAt>Date.now()+60_000)return tokenCache.token;
  const c=await credential();const now=Math.floor(Date.now()/1000);
  const header=b64url(JSON.stringify({alg:"RS256",typ:"JWT"}));
  const payload=b64url(JSON.stringify({iss:c.email,scope:SCOPE,aud:TOKEN_AUD,iat:now,exp:now+3600}));
  const unsigned=`${header}.${payload}`;const signer=createSign("RSA-SHA256");signer.update(unsigned);signer.end();
  const assertion=`${unsigned}.${signer.sign(c.key).toString("base64url")}`;
  const response=await fetch(TOKEN_AUD,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion})});
  const body=await response.json().catch(()=>({})) as {access_token?:string;expires_in?:number;error?:string;error_description?:string};
  if(!response.ok||!body.access_token)throw new Error(body.error_description||body.error||`gsc_token_${response.status}`);
  tokenCache={token:body.access_token,expiresAt:Date.now()+Math.max(300,Number(body.expires_in??3600)-60)*1000};return body.access_token;
}

async function querySearchAnalytics(body:Record<string,unknown>){
  const token=await accessToken();const property=siteUrl();
  const response=await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify(body)});
  const json=await response.json().catch(()=>({})) as {rows?:SearchAnalyticsRow[];error?:{message?:string;status?:string}};
  if(!response.ok){const error=new Error(String(json?.error?.message??`gsc_${response.status}`)) as Error&{status?:number;code?:string};error.status=response.status;error.code=String(json?.error?.status??"");throw error}
  return json;
}

function classify(error:unknown){
  const e=error as Error&{status?:number;code?:string};const message=String(e?.message??"search_console_reporting_error");
  if(e?.status===403&&/has not been used|disabled|SERVICE_DISABLED/i.test(message))return{code:"api_disabled",message:"L’API Search Console doit être activée pour le projet Google Cloud du compte de service."};
  if(e?.status===403)return{code:"permission_missing",message:"Le compte de service n’a pas accès à la propriété Search Console petitannonces.fr."};
  if(e?.status===404)return{code:"property_not_found",message:"La propriété Search Console configurée est introuvable."};
  if(e?.status===401)return{code:"authentication_failed",message:"L’authentification du compte de service Search Console a échoué."};
  return{code:e?.code||"reporting_error",message:message.slice(0,300)};
}

export async function getSearchConsoleOrganic(days=30):Promise<SearchConsoleOrganicReport>{
  const d=Math.max(7,Math.min(365,Math.round(days)));const cached=reportCache.get(d);if(cached&&cached.expiresAt>Date.now())return cached.value;
  let email:string|null=null;try{email=(await credential()).email}catch{}
  const base:SearchConsoleOrganicReport={connected:false,siteUrl:siteUrl(),serviceAccountEmail:email,source:null,syncedAt:null,errorCode:null,errorMessage:null,startDate:null,endDate:null,clicks:0,impressions:0,ctr:0,position:0,rows:[]};
  const range=dateRange(d);
  try{
    const [summary,detail]=await Promise.all([
      querySearchAnalytics({...range,type:"web"}),
      querySearchAnalytics({...range,type:"web",dimensions:["query","page"],aggregationType:"auto",rowLimit:500,startRow:0}),
    ]);
    const s=summary.rows?.[0];
    const rows=(detail.rows??[]).map(row=>({query:String(row.keys?.[0]??"(requête masquée)"),page:String(row.keys?.[1]??""),clicks:num(row.clicks),impressions:num(row.impressions),ctr:num(row.ctr),position:num(row.position)}));
    const value:SearchConsoleOrganicReport={...base,connected:true,source:"GOOGLE_API",syncedAt:new Date().toISOString(),startDate:range.startDate,endDate:range.endDate,clicks:num(s?.clicks),impressions:num(s?.impressions),ctr:num(s?.ctr),position:num(s?.position),rows};
    reportCache.set(d,{expiresAt:Date.now()+10*60_000,value});return value;
  }catch(error){
    const snapshot=await snapshotReport(d,email);if(snapshot){reportCache.set(d,{expiresAt:Date.now()+10*60_000,value:snapshot});return snapshot}
    const c=classify(error);const value={...base,startDate:range.startDate,endDate:range.endDate,errorCode:c.code,errorMessage:c.message};reportCache.set(d,{expiresAt:Date.now()+60_000,value});return value
  }
}