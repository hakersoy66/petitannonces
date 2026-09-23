import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

type ServiceAccount={project_id?:string;client_email?:string;private_key?:string};
type Ga4MetricRow={metricValues?:Array<{value?:string}>};
type Ga4DimensionRow={dimensionValues?:Array<{value?:string}>;metricValues?:Array<{value?:string}>};

export type Ga4Summary={
 connected:boolean;
 propertyId:string|null;
 measurementId:string;
 serviceAccountEmail:string|null;
 reportingConfigured:boolean;
 errorCode:string|null;
 errorMessage:string|null;
 activeUsers:number;
 totalUsers:number;
 newUsers:number;
 sessions:number;
 pageViews:number;
 eventCount:number;
 keyEvents:number;
 engagementRate:number;
 bounceRate:number;
 averageSessionDuration:number;
 channels:Array<{name:string;sessions:number;users:number}>;
 pages:Array<{path:string;views:number;users:number}>;
};

const TOKEN_AUD="https://oauth2.googleapis.com/token";
const SCOPE="https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/cloud-platform";
let tokenCache:{token:string;expiresAt:number}|null=null;
let snapshotCache=new Map<number,{expiresAt:number;value:Ga4Summary}>();

function b64url(value:string|Buffer){return Buffer.from(value).toString("base64url")}
function num(v:unknown){const n=Number(v??0);return Number.isFinite(n)?n:0}
function measurementId(){return (process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID??"G-H1WZ5519J1").trim()}
function propertyId(){const v=(process.env.GA4_PROPERTY_ID??"").trim();return /^\d+$/.test(v)?v:null}
function serviceAccountFile(){return process.env.GA4_SERVICE_ACCOUNT_FILE??process.env.FCM_SERVICE_ACCOUNT_FILE??"/var/www/petitannonces/shared/android-firebase/fcm-service-account.json"}

async function credential(){
 const raw=await readFile(serviceAccountFile(),"utf8");
 const parsed=JSON.parse(raw) as ServiceAccount;
 const projectId=parsed.project_id?.trim()??"";const email=parsed.client_email?.trim()??"";const key=parsed.private_key??"";
 if(!projectId||!email||!key)throw new Error("ga4_service_account_invalid");
 return{projectId,email,key};
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
 if(!response.ok||!body.access_token)throw new Error(body.error_description||body.error||`ga4_token_${response.status}`);
 tokenCache={token:body.access_token,expiresAt:Date.now()+Math.max(300,Number(body.expires_in??3600)-60)*1000};return body.access_token;
}

async function runReport(pid:string,body:Record<string,unknown>){
 const token=await accessToken();
 const response=await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(pid)}:runReport`,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify(body)});
 const json=await response.json().catch(()=>({})) as any;
 if(!response.ok){const message=String(json?.error?.message??`ga4_data_${response.status}`);const err=new Error(message) as Error&{status?:number;code?:string};err.status=response.status;err.code=String(json?.error?.status??"");throw err}
 return json;
}

function classify(error:unknown){
 const e=error as Error&{status?:number;code?:string};const msg=String(e?.message??"ga4_reporting_error");
 if(e?.status===403&&/has not been used|disabled|SERVICE_DISABLED/i.test(msg))return{code:"api_disabled",message:"Google Analytics Data API doit être activée pour le projet Google Cloud du compte de service."};
 if(e?.status===403)return{code:"permission_missing",message:"Le compte de service n’a pas encore accès à cette propriété GA4."};
 if(e?.status===404)return{code:"property_not_found",message:"La propriété GA4 configurée est introuvable."};
 return{code:e?.code||"reporting_error",message:msg.slice(0,300)};
}

export async function tryEnableGa4DataApi(){
 try{
  const [c,token]=await Promise.all([credential(),accessToken()]);
  const response=await fetch(`https://serviceusage.googleapis.com/v1/projects/${encodeURIComponent(c.projectId)}/services/analyticsdata.googleapis.com:enable`,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:"{}"});
  const json=await response.json().catch(()=>({})) as any;
  if(response.ok){tokenCache=null;snapshotCache.clear();return{enabled:true,status:response.status,error:null}}
  return{enabled:false,status:response.status,error:String(json?.error?.status??json?.error?.message??"service_enable_failed").slice(0,300)};
 }catch(error){return{enabled:false,status:0,error:String((error as Error)?.message??error).slice(0,300)}}
}

export async function getGa4Summary(days=30):Promise<Ga4Summary>{
 const d=Math.max(1,Math.min(365,Math.round(days)));const cached=snapshotCache.get(d);if(cached&&cached.expiresAt>Date.now())return cached.value;
 const pid=propertyId();let email:string|null=null;try{email=(await credential()).email}catch{}
 const base:Ga4Summary={connected:false,propertyId:pid,measurementId:measurementId(),serviceAccountEmail:email,reportingConfigured:Boolean(pid&&email),errorCode:null,errorMessage:null,activeUsers:0,totalUsers:0,newUsers:0,sessions:0,pageViews:0,eventCount:0,keyEvents:0,engagementRate:0,bounceRate:0,averageSessionDuration:0,channels:[],pages:[]};
 if(!pid){const v={...base,errorCode:"property_id_missing",errorMessage:"GA4_PROPERTY_ID n’est pas configuré."};snapshotCache.set(d,{expiresAt:Date.now()+60_000,value:v});return v}
 try{
  const dateRanges=[{startDate:`${Math.max(0,d-1)}daysAgo`,endDate:"today"}];
  const [summary,channels,pages]=await Promise.all([
   runReport(pid,{dateRanges,metrics:[{name:"activeUsers"},{name:"totalUsers"},{name:"newUsers"},{name:"sessions"},{name:"screenPageViews"},{name:"eventCount"},{name:"keyEvents"},{name:"engagementRate"},{name:"bounceRate"},{name:"averageSessionDuration"}]}),
   runReport(pid,{dateRanges,dimensions:[{name:"sessionDefaultChannelGroup"}],metrics:[{name:"sessions"},{name:"totalUsers"}],limit:"8",orderBys:[{metric:{metricName:"sessions"},desc:true}]}),
   runReport(pid,{dateRanges,dimensions:[{name:"pagePath"}],metrics:[{name:"screenPageViews"},{name:"totalUsers"}],limit:"10",orderBys:[{metric:{metricName:"screenPageViews"},desc:true}]})
  ]);
  const values=(summary.rows?.[0] as Ga4MetricRow|undefined)?.metricValues??[];
  const value:Ga4Summary={...base,connected:true,activeUsers:num(values[0]?.value),totalUsers:num(values[1]?.value),newUsers:num(values[2]?.value),sessions:num(values[3]?.value),pageViews:num(values[4]?.value),eventCount:num(values[5]?.value),keyEvents:num(values[6]?.value),engagementRate:num(values[7]?.value),bounceRate:num(values[8]?.value),averageSessionDuration:num(values[9]?.value),channels:((channels.rows??[]) as Ga4DimensionRow[]).map(r=>({name:r.dimensionValues?.[0]?.value??"(not set)",sessions:num(r.metricValues?.[0]?.value),users:num(r.metricValues?.[1]?.value)})),pages:((pages.rows??[]) as Ga4DimensionRow[]).map(r=>({path:r.dimensionValues?.[0]?.value??"/",views:num(r.metricValues?.[0]?.value),users:num(r.metricValues?.[1]?.value)}))};
  snapshotCache.set(d,{expiresAt:Date.now()+5*60_000,value});return value;
 }catch(error){const c=classify(error);const value={...base,errorCode:c.code,errorMessage:c.message};snapshotCache.set(d,{expiresAt:Date.now()+60_000,value});return value}
}


export type Ga4OrganicLandingRow={path:string;sessions:number;users:number;signUps:number;listingsSubmitted:number;checkoutStarts:number;purchases:number};
export type Ga4OrganicFunnel={
 connected:boolean;
 propertyId:string|null;
 errorCode:string|null;
 errorMessage:string|null;
 sessions:number;
 users:number;
 signUps:number;
 listingsSubmitted:number;
 checkoutStarts:number;
 purchases:number;
 landingPages:Ga4OrganicLandingRow[];
};
const organicCache=new Map<number,{expiresAt:number;value:Ga4OrganicFunnel}>();

export async function getGa4OrganicFunnel(days=30):Promise<Ga4OrganicFunnel>{
 const d=Math.max(7,Math.min(365,Math.round(days)));const cached=organicCache.get(d);if(cached&&cached.expiresAt>Date.now())return cached.value;
 const pid=propertyId();const base:Ga4OrganicFunnel={connected:false,propertyId:pid,errorCode:null,errorMessage:null,sessions:0,users:0,signUps:0,listingsSubmitted:0,checkoutStarts:0,purchases:0,landingPages:[]};
 if(!pid){const value={...base,errorCode:"property_id_missing",errorMessage:"GA4_PROPERTY_ID n’est pas configuré."};organicCache.set(d,{expiresAt:Date.now()+60_000,value});return value}
 try{
  // Align the combined organic funnel with Search Console's stable window, which ends two days ago.
  const dateRanges=[{startDate:`${d+1}daysAgo`,endDate:"2daysAgo"}];
  const organicFilter={filter:{fieldName:"sessionDefaultChannelGroup",stringFilter:{matchType:"EXACT",value:"Organic Search",caseSensitive:false}}};
  const eventNames=["sign_up","listing_submitted","begin_checkout","purchase"];
  const [landingReport,eventReport]=await Promise.all([
   runReport(pid,{dateRanges,dimensions:[{name:"landingPage"}],metrics:[{name:"sessions"},{name:"totalUsers"}],dimensionFilter:organicFilter,limit:"250",orderBys:[{metric:{metricName:"sessions"},desc:true}]}),
   runReport(pid,{dateRanges,dimensions:[{name:"landingPage"},{name:"eventName"}],metrics:[{name:"eventCount"}],dimensionFilter:{andGroup:{expressions:[organicFilter,{filter:{fieldName:"eventName",inListFilter:{values:eventNames,caseSensitive:true}}}]}},limit:"1000"}),
  ]);
  const byPath=new Map<string,Ga4OrganicLandingRow>();
  for(const row of (landingReport.rows??[]) as Ga4DimensionRow[]){const path=row.dimensionValues?.[0]?.value||"(not set)";byPath.set(path,{path,sessions:num(row.metricValues?.[0]?.value),users:num(row.metricValues?.[1]?.value),signUps:0,listingsSubmitted:0,checkoutStarts:0,purchases:0})}
  for(const row of (eventReport.rows??[]) as Ga4DimensionRow[]){const path=row.dimensionValues?.[0]?.value||"(not set)";const eventName=row.dimensionValues?.[1]?.value||"";const target=byPath.get(path)??{path,sessions:0,users:0,signUps:0,listingsSubmitted:0,checkoutStarts:0,purchases:0};const count=num(row.metricValues?.[0]?.value);if(eventName==="sign_up")target.signUps+=count;else if(eventName==="listing_submitted")target.listingsSubmitted+=count;else if(eventName==="begin_checkout")target.checkoutStarts+=count;else if(eventName==="purchase")target.purchases+=count;byPath.set(path,target)}
  const landingPages=[...byPath.values()].sort((a,b)=>b.sessions-a.sessions||b.signUps-a.signUps).slice(0,100);
  const value:Ga4OrganicFunnel={...base,connected:true,sessions:landingPages.reduce((s,r)=>s+r.sessions,0),users:landingPages.reduce((s,r)=>s+r.users,0),signUps:landingPages.reduce((s,r)=>s+r.signUps,0),listingsSubmitted:landingPages.reduce((s,r)=>s+r.listingsSubmitted,0),checkoutStarts:landingPages.reduce((s,r)=>s+r.checkoutStarts,0),purchases:landingPages.reduce((s,r)=>s+r.purchases,0),landingPages};
  organicCache.set(d,{expiresAt:Date.now()+5*60_000,value});return value;
 }catch(error){const c=classify(error);const value={...base,errorCode:c.code,errorMessage:c.message};organicCache.set(d,{expiresAt:Date.now()+60_000,value});return value}
}


export async function getGa4DataStreams(){
 const pid=propertyId();
 if(!pid)return{propertyId:null,streams:[],error:"property_id_missing"};
 try{
  const token=await accessToken();
  const response=await fetch(`https://analyticsadmin.googleapis.com/v1beta/properties/${encodeURIComponent(pid)}/dataStreams`,{headers:{authorization:`Bearer ${token}`}});
  const json=await response.json().catch(()=>({})) as any;
  if(!response.ok)return{propertyId:pid,streams:[],error:String(json?.error?.message??`admin_${response.status}`).slice(0,300)};
  return{propertyId:pid,streams:(json.dataStreams??[]).map((s:any)=>({name:String(s.name??""),displayName:String(s.displayName??""),type:String(s.type??""),measurementId:String(s.webStreamData?.measurementId??""),defaultUri:String(s.webStreamData?.defaultUri??"")})),error:null};
 }catch(error){return{propertyId:pid,streams:[],error:String((error as Error)?.message??error).slice(0,300)}}
}

export async function getGa4RealtimeSummary(){
 const pid=propertyId();
 if(!pid)return{propertyId:null,activeUsers:0,eventCount:0,rows:[],error:"property_id_missing"};
 try{
  const token=await accessToken();
  const response=await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(pid)}:runRealtimeReport`,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({dimensions:[{name:"eventName"}],metrics:[{name:"activeUsers"},{name:"eventCount"}],minuteRanges:[{startMinutesAgo:29,endMinutesAgo:0}],limit:"50"})});
  const json=await response.json().catch(()=>({})) as any;
  if(!response.ok)return{propertyId:pid,activeUsers:0,eventCount:0,rows:[],error:String(json?.error?.message??`realtime_${response.status}`).slice(0,300)};
  const rows=(json.rows??[]).map((r:any)=>({eventName:String(r.dimensionValues?.[0]?.value??""),activeUsers:num(r.metricValues?.[0]?.value),eventCount:num(r.metricValues?.[1]?.value)}));
  return{propertyId:pid,activeUsers:rows.reduce((m:number,r:any)=>Math.max(m,r.activeUsers),0),eventCount:rows.reduce((s:number,r:any)=>s+r.eventCount,0),rows,error:null};
 }catch(error){return{propertyId:pid,activeUsers:0,eventCount:0,rows:[],error:String((error as Error)?.message??error).slice(0,300)}}
}
