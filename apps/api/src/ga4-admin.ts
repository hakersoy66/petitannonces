import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

type ServiceAccount={client_email?:string;private_key?:string};
type GoogleError={error?:{message?:string;status?:string}};
export type Ga4KeyEvent={name:string;eventName:string;createTime:string|null;custom:boolean};
export type Ga4KeyEventStatus={connected:boolean;propertyId:string|null;serviceAccountEmail:string|null;errorCode:string|null;errorMessage:string|null;events:Ga4KeyEvent[]};

const TOKEN_AUD="https://oauth2.googleapis.com/token";
const EDIT_SCOPE="https://www.googleapis.com/auth/analytics.edit";
let tokenCache:{token:string;expiresAt:number}|null=null;

function propertyId(){const v=(process.env.GA4_PROPERTY_ID??"").trim();return /^\d+$/.test(v)?v:null}
function serviceAccountFile(){return process.env.GA4_SERVICE_ACCOUNT_FILE??process.env.FCM_SERVICE_ACCOUNT_FILE??"/var/www/petitannonces/shared/android-firebase/fcm-service-account.json"}
function b64url(value:string|Buffer){return Buffer.from(value).toString("base64url")}
async function credential(){const raw=await readFile(serviceAccountFile(),"utf8");const parsed=JSON.parse(raw) as ServiceAccount;const email=parsed.client_email?.trim()??"",key=parsed.private_key??"";if(!email||!key)throw new Error("ga4_service_account_invalid");return{email,key}}
async function accessToken(){
 if(tokenCache&&tokenCache.expiresAt>Date.now()+60_000)return tokenCache.token;
 const c=await credential(),now=Math.floor(Date.now()/1000);const header=b64url(JSON.stringify({alg:"RS256",typ:"JWT"}));const payload=b64url(JSON.stringify({iss:c.email,scope:EDIT_SCOPE,aud:TOKEN_AUD,iat:now,exp:now+3600}));const unsigned=`${header}.${payload}`;const signer=createSign("RSA-SHA256");signer.update(unsigned);signer.end();const assertion=`${unsigned}.${signer.sign(c.key).toString("base64url")}`;
 const response=await fetch(TOKEN_AUD,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion})});const body=await response.json().catch(()=>({})) as {access_token?:string;expires_in?:number;error?:string;error_description?:string};if(!response.ok||!body.access_token)throw new Error(body.error_description||body.error||`ga4_admin_token_${response.status}`);tokenCache={token:body.access_token,expiresAt:Date.now()+Math.max(300,Number(body.expires_in??3600)-60)*1000};return body.access_token;
}
function classify(error:unknown){const e=error as Error&{status?:number;code?:string};const message=String(e?.message??"ga4_admin_error");if(e?.status===403)return{code:"permission_missing",message:"Le compte de service doit avoir le rôle Marketer (ou supérieur) sur la propriété GA4 pour gérer les événements clés."};if(e?.status===404)return{code:"property_not_found",message:"La propriété GA4 configurée est introuvable."};if(e?.status===401)return{code:"authentication_failed",message:"L’authentification du compte de service GA4 a échoué."};return{code:e?.code||"admin_api_error",message:message.slice(0,300)}}
async function adminRequest(path:string,init?:RequestInit){const token=await accessToken();const response=await fetch(`https://analyticsadmin.googleapis.com/v1beta/${path}`,{...init,headers:{authorization:`Bearer ${token}`,"content-type":"application/json",...(init?.headers??{})}});const json=await response.json().catch(()=>({})) as any;if(!response.ok){const body=json as GoogleError;const error=new Error(String(body?.error?.message??`ga4_admin_${response.status}`)) as Error&{status?:number;code?:string};error.status=response.status;error.code=String(body?.error?.status??"");throw error}return json}

export async function listGa4KeyEvents():Promise<Ga4KeyEventStatus>{
 const pid=propertyId();let email:string|null=null;try{email=(await credential()).email}catch{}
 const base:Ga4KeyEventStatus={connected:false,propertyId:pid,serviceAccountEmail:email,errorCode:null,errorMessage:null,events:[]};if(!pid)return{...base,errorCode:"property_id_missing",errorMessage:"GA4_PROPERTY_ID n’est pas configuré."};
 try{const json=await adminRequest(`properties/${pid}/keyEvents?pageSize=50`);const events=((json.keyEvents??[]) as any[]).map(row=>({name:String(row.name??""),eventName:String(row.eventName??""),createTime:row.createTime?String(row.createTime):null,custom:Boolean(row.custom)}));return{...base,connected:true,events}}catch(error){const c=classify(error);return{...base,errorCode:c.code,errorMessage:c.message}}
}

export async function ensureGa4KeyEvents(eventNames:string[]){
 const pid=propertyId();if(!pid)throw new Error("ga4_property_id_missing");const before=await listGa4KeyEvents();if(!before.connected)throw new Error(before.errorMessage??before.errorCode??"ga4_key_events_unavailable");const existing=new Set(before.events.map(e=>e.eventName));const created:string[]=[];const skipped:string[]=[];
 for(const eventName of [...new Set(eventNames.map(v=>v.trim()).filter(Boolean))]){if(existing.has(eventName)){skipped.push(eventName);continue}await adminRequest(`properties/${pid}/keyEvents`,{method:"POST",body:JSON.stringify({eventName})});created.push(eventName);existing.add(eventName)}
 const after=await listGa4KeyEvents();return{created,skipped,status:after};
}