import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getRuntimeIntegration } from "./admin-control.js";
import { requireAdminRoles } from "./rbac.js";

const TOKEN_URL="https://oauth2.googleapis.com/token";
const ADS_SCOPE="https://www.googleapis.com/auth/adwords";
const DEFAULT_API_VERSION="v25";
const GOOGLE_ADS_HOST="https://googleads.googleapis.com";
const FULL_ADMIN=["SUPER_ADMIN","ADMIN"] as const;

type ServiceAccount={project_id?:string;client_email?:string;private_key?:string};
type GoogleAdsConfig={enabled:boolean;customerId:string|null;loginCustomerId:string|null;apiVersion:string};
let tokenCache:{token:string;expiresAt:number}|null=null;

function b64url(value:unknown){return Buffer.from(JSON.stringify(value)).toString("base64url")}
function serviceAccountFile(){return process.env.GA4_SERVICE_ACCOUNT_FILE??process.env.FCM_SERVICE_ACCOUNT_FILE??"/var/www/petitannonces/shared/android-firebase/fcm-service-account.json"}
function cleanCustomerId(value:unknown){const v=String(value??"").replace(/\D/g,"");return /^\d{10}$/.test(v)?v:null}
function cleanApiVersion(value:unknown){const v=String(value??DEFAULT_API_VERSION).trim();return /^v\d+$/.test(v)?v:DEFAULT_API_VERSION}

async function credential(){
 const raw=await readFile(serviceAccountFile(),"utf8");
 const parsed=JSON.parse(raw) as ServiceAccount;
 const projectId=String(parsed.project_id??"").trim(),email=String(parsed.client_email??"").trim(),key=String(parsed.private_key??"");
 if(!projectId||!email||!key)throw new Error("google_ads_service_account_invalid");
 return{projectId,email,key};
}

async function config():Promise<GoogleAdsConfig>{
 const integration=await getRuntimeIntegration("google-ads");
 return{
  enabled:Boolean(integration?.enabled),
  customerId:cleanCustomerId(integration?.config.customerId),
  loginCustomerId:cleanCustomerId(integration?.config.loginCustomerId),
  apiVersion:cleanApiVersion(integration?.config.apiVersion),
 };
}

async function accessToken(){
 if(tokenCache&&tokenCache.expiresAt>Date.now()+60_000)return tokenCache.token;
 const c=await credential();const now=Math.floor(Date.now()/1000);
 const h=b64url({alg:"RS256",typ:"JWT"}),p=b64url({iss:c.email,scope:ADS_SCOPE,aud:TOKEN_URL,iat:now,exp:now+3600});
 const unsigned=`${h}.${p}`;const signer=createSign("RSA-SHA256");signer.update(unsigned);signer.end();
 const assertion=`${unsigned}.${signer.sign(c.key).toString("base64url")}`;
 const response=await fetch(TOKEN_URL,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion})});
 const body=await response.json().catch(()=>({})) as any;
 if(!response.ok||!body.access_token)throw new Error(String(body.error_description??body.error??`google_ads_token_${response.status}`));
 tokenCache={token:String(body.access_token),expiresAt:Date.now()+Math.max(300,Number(body.expires_in??3600)-60)*1000};
 return tokenCache.token;
}

function classify(status:number,message:string){
 const m=message.toLowerCase();
 if(status===403&&(m.includes("has not been used")||m.includes("disabled")||m.includes("service_disabled")))return{code:"api_disabled",message:"Google Ads API n’est pas encore activée dans le projet Google Cloud Petit Annonces."};
 if(status===403&&(m.includes("permission")||m.includes("authorization")||m.includes("not authorized")))return{code:"account_access_missing",message:"Le compte de service Petit Annonces n’a pas encore accès au compte Google Ads."};
 if(status===401)return{code:"authentication_failed",message:"Authentification Google Ads refusée."};
 return{code:`google_ads_http_${status}`,message:message.slice(0,500)};
}

async function adsRequest(path:string,init?:{method?:"GET"|"POST";body?:unknown;customerId?:string|null}){
 const [token,cfg]=await Promise.all([accessToken(),config()]);
 const headers:Record<string,string>={authorization:`Bearer ${token}`,"content-type":"application/json"};
 const login=cfg.loginCustomerId;if(login)headers["login-customer-id"]=login;
 const response=await fetch(`${GOOGLE_ADS_HOST}/${cfg.apiVersion}${path}`,{method:init?.method??"GET",headers,body:init?.body===undefined?undefined:JSON.stringify(init.body)});
 const json=await response.json().catch(()=>({})) as any;
 if(!response.ok){
  const raw=String(json?.error?.message??json?.message??`Google Ads HTTP ${response.status}`); const detail=Array.isArray(json?.error?.details)?JSON.stringify(json.error.details).slice(0,4000):"";
  const e=new Error(raw) as Error&{status?:number;code?:string};const c=classify(response.status,raw);e.status=response.status;e.code=c.code;e.message=detail?`${c.message} · ${detail}`:c.message;throw e;
 }
 return json;
}

export async function googleAdsServiceInfo(){
 const c=await credential();const cfg=await config();
 return{projectId:c.projectId,serviceAccountEmail:c.email,serviceAccountFile:serviceAccountFile(),apiVersion:cfg.apiVersion,customerId:cfg.customerId,loginCustomerId:cfg.loginCustomerId,enabled:cfg.enabled};
}

export async function listAccessibleGoogleAdsCustomers(){
 const payload=await adsRequest("/customers:listAccessibleCustomers");
 return(Array.isArray(payload.resourceNames)?payload.resourceNames:[]).map((x:unknown)=>String(x).replace(/^customers\//,"")).filter(Boolean);
}

export async function queryGoogleAdsCustomer(customerId:string){
 const id=cleanCustomerId(customerId);if(!id)throw new Error("google_ads_customer_id_invalid");
 const payload=await adsRequest(`/customers/${id}/googleAds:search`,{method:"POST",body:{query:"SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager, customer.test_account FROM customer LIMIT 1"}});
 const row=Array.isArray(payload.results)?payload.results[0]:null;
 return row?.customer??null;
}

export async function listGoogleAdsCampaigns(customerId:string){
 const id=cleanCustomerId(customerId);if(!id)throw new Error("google_ads_customer_id_invalid");
 const q="SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.contains_eu_political_advertising, campaign_budget.amount_micros, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE campaign.status != 'REMOVED' ORDER BY campaign.id DESC LIMIT 100";
 const payload=await adsRequest(`/customers/${id}/googleAds:search`,{method:"POST",body:{query:q}});
 return(Array.isArray(payload.results)?payload.results:[]).map((row:any)=>({
  id:String(row?.campaign?.id??""),name:String(row?.campaign?.name??""),status:String(row?.campaign?.status??""),
  channel:String(row?.campaign?.advertisingChannelType??""),euPoliticalAdvertising:String(row?.campaign?.containsEuPoliticalAdvertising??""),
  budgetMicros:Number(row?.campaignBudget?.amountMicros??0),impressions:Number(row?.metrics?.impressions??0),clicks:Number(row?.metrics?.clicks??0),
  costMicros:Number(row?.metrics?.costMicros??0),conversions:Number(row?.metrics?.conversions??0),
 }));
}

export async function testGoogleAdsConnection(){
 const info=await googleAdsServiceInfo();
 const accessible=await listAccessibleGoogleAdsCustomers();
 const target=info.customerId;
 let customer:any=null;
 if(target){
  if(!accessible.includes(target)&&!info.loginCustomerId)throw Object.assign(new Error("Le compte de service n’a pas accès au compte Google Ads configuré."),{code:"account_access_missing"});
  customer=await queryGoogleAdsCustomer(target);
 }
 return{ok:true,...info,accessibleCustomers:accessible,customer};
}

export async function createPausedGoogleSearchCampaign(input:{
 customerId:string;name:string;dailyBudgetMinor:number;cpcBidMinor:number;finalUrl:string;adGroupName:string;
 headlines:string[];descriptions:string[];keywords:Array<{text:string;matchType:"EXACT"|"PHRASE"|"BROAD"}>;validateOnly?:boolean;
}){
 const customerId=cleanCustomerId(input.customerId);if(!customerId)throw new Error("google_ads_customer_id_invalid");
 const headlines=input.headlines.map(x=>x.trim()).filter(Boolean).slice(0,15);const descriptions=input.descriptions.map(x=>x.trim()).filter(Boolean).slice(0,4);
 if(headlines.length<3||descriptions.length<2||input.keywords.length<1)throw new Error("google_ads_campaign_assets_incomplete");
 const budgetMicros=String(Math.max(100,Math.round(input.dailyBudgetMinor))*10_000);
 const cpcBidMicros=String(Math.max(1,Math.round(input.cpcBidMinor))*10_000);
 const budgetName=`${input.name} · Budget · ${Date.now()}`;
 const campaignRef=`customers/${customerId}/campaigns/-2`,budgetRef=`customers/${customerId}/campaignBudgets/-1`,adGroupRef=`customers/${customerId}/adGroups/-3`;
 const mutateOperations:any[]=[
  {campaignBudgetOperation:{create:{resourceName:budgetRef,name:budgetName,deliveryMethod:"STANDARD",amountMicros:budgetMicros,explicitlyShared:false}}},
  {campaignOperation:{create:{resourceName:campaignRef,name:input.name,status:"PAUSED",advertisingChannelType:"SEARCH",campaignBudget:budgetRef,manualCpc:{},networkSettings:{targetGoogleSearch:true,targetSearchNetwork:true,targetContentNetwork:false,targetPartnerSearchNetwork:false},containsEuPoliticalAdvertising:"DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING"}}},
  {campaignCriterionOperation:{create:{campaign:campaignRef,location:{geoTargetConstant:"geoTargetConstants/2250"}}}},
  {adGroupOperation:{create:{resourceName:adGroupRef,name:input.adGroupName,status:"ENABLED",campaign:campaignRef,type:"SEARCH_STANDARD",cpcBidMicros}}},
  ...input.keywords.slice(0,100).map(k=>({adGroupCriterionOperation:{create:{adGroup:adGroupRef,status:"ENABLED",keyword:{text:k.text.trim().slice(0,80),matchType:k.matchType}}}})),
  {adGroupAdOperation:{create:{adGroup:adGroupRef,status:"PAUSED",ad:{finalUrls:[input.finalUrl],responsiveSearchAd:{headlines:headlines.map(text=>({text})),descriptions:descriptions.map(text=>({text}))}}}}},
 ];
 const body={mutateOperations,partialFailure:false,validateOnly:Boolean(input.validateOnly)};
 const result=await adsRequest(`/customers/${customerId}/googleAds:mutate`,{method:"POST",body});
 return{ok:true,paused:true,validateOnly:Boolean(input.validateOnly),result};
}

export async function registerGoogleAdsDirectRoutes(app:FastifyInstance){
 app.get("/admin/google-ads/status",{preHandler:requireAdminRoles([...FULL_ADMIN])},async(_request,reply)=>{
  try{return reply.send(await testGoogleAdsConnection())}catch(error:any){const info=await googleAdsServiceInfo().catch(()=>null);return reply.send({ok:false,...(info??{}),error:error?.code??"google_ads_unavailable",message:String(error?.message??error).slice(0,500)})}
 });
 app.post("/admin/integrations/google-ads/test",{preHandler:requireAdminRoles([...FULL_ADMIN])},async(_request,reply)=>{
  try{return reply.send(await testGoogleAdsConnection())}catch(error:any){return reply.code(error?.code==="api_disabled"||error?.code==="account_access_missing"?409:502).send({error:error?.code??"google_ads_test_failed",message:String(error?.message??error).slice(0,500)})}
 });
 app.get("/admin/google-ads/campaigns",{preHandler:requireAdminRoles([...FULL_ADMIN])},async(_request,reply)=>{
  const cfg=await config();if(!cfg.customerId)return reply.code(409).send({error:"google_ads_customer_id_missing"});
  try{return reply.send({items:await listGoogleAdsCampaigns(cfg.customerId)})}catch(error:any){return reply.code(502).send({error:error?.code??"google_ads_campaigns_failed",message:String(error?.message??error).slice(0,500)})}
 });
 app.post("/admin/google-ads/search-campaigns",{preHandler:requireAdminRoles([...FULL_ADMIN])},async(request,reply)=>{
  const cfg=await config();if(!cfg.enabled||!cfg.customerId)return reply.code(409).send({error:"google_ads_not_configured"});
  const body=z.object({
   name:z.string().trim().min(3).max(128),dailyBudgetMinor:z.number().int().min(100).max(1_000_000),cpcBidMinor:z.number().int().min(1).max(100_000),
   finalUrl:z.string().url().refine(v=>v.startsWith("https://petitannonces.fr"),{message:"final_url_must_be_petitannonces"}),
   adGroupName:z.string().trim().min(2).max(255),headlines:z.array(z.string().trim().min(2).max(30)).min(3).max(15),
   descriptions:z.array(z.string().trim().min(2).max(90)).min(2).max(4),
   keywords:z.array(z.object({text:z.string().trim().min(1).max(80),matchType:z.enum(["EXACT","PHRASE","BROAD"])})).min(1).max(100),
   validateOnly:z.boolean().default(false),
  }).safeParse(request.body);
  if(!body.success)return reply.code(400).send({error:"invalid_google_ads_campaign",issues:body.error.issues});
  try{return reply.send(await createPausedGoogleSearchCampaign({customerId:cfg.customerId,...body.data}))}catch(error:any){return reply.code(502).send({error:error?.code??"google_ads_campaign_create_failed",message:String(error?.message??error).slice(0,500)})}
 });
}


export async function listGoogleAdsConversionActions(customerId:string){
 const id=cleanCustomerId(customerId);if(!id)throw new Error("google_ads_customer_id_invalid");
 const q="SELECT conversion_action.id, conversion_action.name, conversion_action.status, conversion_action.type, conversion_action.category, conversion_action.primary_for_goal, conversion_action.include_in_conversions_metric FROM conversion_action WHERE conversion_action.status != 'REMOVED' ORDER BY conversion_action.id DESC LIMIT 200";
 const payload=await adsRequest(`/customers/${id}/googleAds:search`,{method:"POST",body:{query:q}});
 return(Array.isArray(payload.results)?payload.results:[]).map((row:any)=>({
  id:String(row?.conversionAction?.id??""),name:String(row?.conversionAction?.name??""),status:String(row?.conversionAction?.status??""),
  type:String(row?.conversionAction?.type??""),category:String(row?.conversionAction?.category??""),
  primaryForGoal:Boolean(row?.conversionAction?.primaryForGoal),includeInConversionsMetric:Boolean(row?.conversionAction?.includeInConversionsMetric),
 }));
}

export async function addGoogleAdsCampaignNegativeKeywords(customerId:string,campaignId:string,keywords:string[]){
 const id=cleanCustomerId(customerId);if(!id||!/^[0-9]+$/.test(campaignId))throw new Error("google_ads_campaign_invalid");
 const campaign=`customers/${id}/campaigns/${campaignId}`;
 const operations=keywords.map(text=>({create:{campaign,negative:true,keyword:{text:text.trim().slice(0,80),matchType:"PHRASE"}}}));
 const payload=await adsRequest(`/customers/${id}/campaignCriteria:mutate`,{method:"POST",body:{operations,partialFailure:false,validateOnly:false}});
 return{ok:true,count:operations.length,result:payload};
}


export async function setGoogleAdsCampaignStatus(customerId:string,campaignId:string,status:"ENABLED"|"PAUSED"){
 const id=cleanCustomerId(customerId);if(!id||!/^[0-9]+$/.test(campaignId))throw new Error("google_ads_campaign_invalid");
 const resourceName=`customers/${id}/campaigns/${campaignId}`;
 const payload=await adsRequest(`/customers/${id}/campaigns:mutate`,{method:"POST",body:{operations:[{update:{resourceName,status},updateMask:"status"}],partialFailure:false,validateOnly:false}});
 return{ok:true,status,result:payload};
}

export async function setGoogleAdsAdStatus(customerId:string,adGroupId:string,adId:string,status:"ENABLED"|"PAUSED"){
 const id=cleanCustomerId(customerId);if(!id||!/^[0-9]+$/.test(adGroupId)||!/^[0-9]+$/.test(adId))throw new Error("google_ads_ad_invalid");
 const resourceName=`customers/${id}/adGroupAds/${adGroupId}~${adId}`;
 const payload=await adsRequest(`/customers/${id}/adGroupAds:mutate`,{method:"POST",body:{operations:[{update:{resourceName,status},updateMask:"status"}],partialFailure:false,validateOnly:false}});
 return{ok:true,status,result:payload};
}


export async function setGoogleAdsAdFinalUrl(customerId:string,adId:string,finalUrl:string){
 const id=cleanCustomerId(customerId);if(!id||!/^[0-9]+$/.test(adId))throw new Error("google_ads_ad_invalid");
 const url=new URL(finalUrl);if(url.protocol!=="https:"||url.hostname!=="petitannonces.fr")throw new Error("google_ads_final_url_invalid");
 const resourceName=`customers/${id}/ads/${adId}`;
 const payload=await adsRequest(`/customers/${id}/ads:mutate`,{method:"POST",body:{operations:[{update:{resourceName,finalUrls:[url.toString()]},updateMask:"final_urls"}],partialFailure:false,validateOnly:false}});
 return{ok:true,finalUrl:url.toString(),result:payload};
}


export async function getGoogleAdsAdSummary(customerId:string,adId:string){
 const id=cleanCustomerId(customerId);if(!id||!/^[0-9]+$/.test(adId))throw new Error("google_ads_ad_invalid");
 const q=`SELECT ad_group_ad.status, ad_group_ad.ad.id, ad_group_ad.ad.final_urls, ad_group_ad.policy_summary.approval_status, ad_group_ad.policy_summary.review_status FROM ad_group_ad WHERE ad_group_ad.ad.id = ${adId} LIMIT 1`;
 const payload=await adsRequest(`/customers/${id}/googleAds:search`,{method:"POST",body:{query:q}});
 const row=Array.isArray(payload.results)?payload.results[0]:null;
 return row?{status:String(row?.adGroupAd?.status??""),adId:String(row?.adGroupAd?.ad?.id??""),finalUrls:Array.isArray(row?.adGroupAd?.ad?.finalUrls)?row.adGroupAd.ad.finalUrls.map(String):[],approvalStatus:String(row?.adGroupAd?.policySummary?.approvalStatus??""),reviewStatus:String(row?.adGroupAd?.policySummary?.reviewStatus??"")}:null;
}


export async function getGoogleAdsConversionActionSummary(customerId:string,conversionActionId:string){
 const id=cleanCustomerId(customerId);if(!id||!/^[0-9]+$/.test(conversionActionId))throw new Error("google_ads_conversion_action_invalid");
 const q=`SELECT conversion_action.id, conversion_action.name, conversion_action.status, conversion_action.type, conversion_action.category, conversion_action.primary_for_goal, conversion_action.tag_snippets FROM conversion_action WHERE conversion_action.id = ${conversionActionId} LIMIT 1`;
 const payload=await adsRequest(`/customers/${id}/googleAds:search`,{method:"POST",body:{query:q}});
 const row=Array.isArray(payload.results)?payload.results[0]:null;
 return row?.conversionAction??null;
}

export async function createGoogleAdsSecondaryWebsiteConversion(customerId:string,name:string,category:"SIGNUP"|"SUBMIT_LEAD_FORM"){
 const id=cleanCustomerId(customerId);if(!id)throw new Error("google_ads_customer_id_invalid");
 const existing=await listGoogleAdsConversionActions(id);const found=existing.find((x:{id:string;name:string})=>x.name.trim().toLowerCase()===name.trim().toLowerCase());
 let conversionActionId=found?.id??null;
 if(!conversionActionId){
  const created=await adsRequest(`/customers/${id}/conversionActions:mutate`,{method:"POST",body:{operations:[{create:{name:name.trim().slice(0,100),type:"WEBPAGE",category,status:"ENABLED",countingType:"ONE_PER_CLICK",valueSettings:{defaultValue:0,defaultCurrencyCode:"EUR",alwaysUseDefaultValue:true}}}],partialFailure:false,validateOnly:false}});
  const resourceName=String(created?.results?.[0]?.resourceName??created?.mutateOperationResponses?.[0]?.conversionActionResult?.resourceName??"");
  conversionActionId=resourceName.split("/").pop()||null;
 }
 if(!conversionActionId)throw new Error("google_ads_conversion_action_create_failed");
 await adsRequest(`/customers/${id}/conversionActions:mutate`,{method:"POST",body:{operations:[{update:{resourceName:`customers/${id}/conversionActions/${conversionActionId}`,primaryForGoal:false},updateMask:"primary_for_goal"}],partialFailure:false,validateOnly:false}});
 return await getGoogleAdsConversionActionSummary(id,conversionActionId);
}


export async function getGoogleAdsPerformanceMaxDiagnostics(customerId:string,campaignId:string){
 const id=cleanCustomerId(customerId);if(!id||!/^[0-9]+$/.test(campaignId))throw new Error("google_ads_campaign_invalid");
 const cq=`SELECT campaign.id, campaign.name, campaign.status, campaign.primary_status, campaign.primary_status_reasons, campaign.advertising_channel_type, campaign_budget.amount_micros, campaign.contains_eu_political_advertising FROM campaign WHERE campaign.id = ${campaignId} LIMIT 1`;
 const aq=`SELECT asset_group.id, asset_group.name, asset_group.status, asset_group.primary_status, asset_group.primary_status_reasons FROM asset_group WHERE campaign.id = ${campaignId} LIMIT 50`;
 const [campaignPayload,assetPayload]=await Promise.all([
  adsRequest(`/customers/${id}/googleAds:search`,{method:"POST",body:{query:cq}}),
  adsRequest(`/customers/${id}/googleAds:search`,{method:"POST",body:{query:aq}})
 ]);
 return{
  campaign:Array.isArray(campaignPayload.results)?campaignPayload.results[0]??null:null,
  assetGroups:Array.isArray(assetPayload.results)?assetPayload.results.map((row:any)=>row.assetGroup??row):[],
 };
}

[executed on device: mail.petitannonces.fr (b9fdfe5f-3df4-4e4a-a34e-5aa72c2ab64d)]