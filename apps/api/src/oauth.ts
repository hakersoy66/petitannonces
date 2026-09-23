import { createHash, createPublicKey, randomBytes, randomUUID, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";
import { hash } from "@node-rs/argon2";
import { prisma } from "@pa/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { enforceAuthRateLimit } from "./auth-rate-limit.js";
import { getSiteSettings } from "./admin-control.js";
import { issueSession } from "./auth.js";
import { grantWelcomeSiteCredit, WELCOME_SITE_CREDIT_MINOR } from "./site-credit.js";
import { queueAdminRoleEmail, queueTransactionalEmail } from "./transactional-email.js";
import { createTwoFactorLoginChallenge, isTwoFactorEnabled, verifyTwoFactorLoginChallenge } from "./two-factor.js";

const OAUTH_2FA_COOKIE="pa_oauth_2fa";
const APPLE_ISSUER="https://appleid.apple.com";
const GOOGLE_AUTH="https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN="https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO="https://openidconnect.googleapis.com/v1/userinfo";
const APPLE_AUTH="https://appleid.apple.com/auth/authorize";
const APPLE_TOKEN="https://appleid.apple.com/auth/token";
const APPLE_JWKS="https://appleid.apple.com/auth/keys";

type Provider="google"|"apple";
type StateRow={id:string;provider:Provider;codeVerifier:string;nonce:string;nextPath:string};
type Identity={provider:Provider;subject:string;email:string;emailVerified:boolean;displayName:string|null;authoritativeEmail:boolean};

function sha256(value:string){return createHash("sha256").update(value).digest("hex")}
function randomToken(bytes=32){return randomBytes(bytes).toString("base64url")}
function pkceChallenge(verifier:string){return createHash("sha256").update(verifier).digest("base64url")}
function safeNext(value:unknown){const v=typeof value==="string"?value:"";return v.startsWith("/")&&!v.startsWith("//")?v:"/mon-compte"}
function withQuery(path:string,key:string,value:string){const u=new URL(path,"https://petitannonces.fr");u.searchParams.set(key,value);return `${u.pathname}${u.search}${u.hash}`}
function publicWeb(){return String(process.env.PUBLIC_WEB_URL??"https://petitannonces.fr").replace(/\/$/,"")}
function callbackUrl(provider:Provider){return `${publicWeb()}/api/auth/oauth/${provider}/callback`}
function oauthError(reply:FastifyReply,code:string,nextPath="/mon-compte"){return reply.redirect(`${publicWeb()}/connexion?oauth_error=${encodeURIComponent(code)}&next=${encodeURIComponent(safeNext(nextPath))}`)}
function normalizePem(value:string){return value.includes("\\n")?value.replace(/\\n/g,"\n"):value}

function googleConfig(){
  const clientId=String(process.env.GOOGLE_OAUTH_CLIENT_ID??"").trim();
  const clientSecret=String(process.env.GOOGLE_OAUTH_CLIENT_SECRET??"").trim();
  return clientId&&clientSecret?{clientId,clientSecret}:null;
}
function appleConfig(){
  const clientId=String(process.env.APPLE_OAUTH_CLIENT_ID??"").trim();
  const teamId=String(process.env.APPLE_OAUTH_TEAM_ID??"").trim();
  const keyId=String(process.env.APPLE_OAUTH_KEY_ID??"").trim();
  const privateKey=normalizePem(String(process.env.APPLE_OAUTH_PRIVATE_KEY??"").trim());
  return clientId&&teamId&&keyId&&privateKey?{clientId,teamId,keyId,privateKey}:null;
}

async function createState(provider:Provider,nextPath:string){
  const token=randomToken();const codeVerifier=randomToken(48);const nonce=randomToken(24);
  await prisma.$executeRawUnsafe(`DELETE FROM "OAuthState" WHERE "expiresAt"<CURRENT_TIMESTAMP OR ("usedAt" IS NOT NULL AND "usedAt"<CURRENT_TIMESTAMP-INTERVAL '1 day')`);
  await prisma.$executeRawUnsafe(`INSERT INTO "OAuthState" ("id","stateHash","provider","codeVerifier","nonce","nextPath","expiresAt") VALUES ($1,$2,$3,$4,$5,$6,CURRENT_TIMESTAMP + INTERVAL '10 minutes')`,randomUUID(),sha256(token),provider,codeVerifier,nonce,safeNext(nextPath));
  return{token,codeVerifier,nonce};
}
async function consumeState(provider:Provider,state:string){
  const rows=await prisma.$queryRawUnsafe<StateRow[]>(`UPDATE "OAuthState" SET "usedAt"=CURRENT_TIMESTAMP WHERE "stateHash"=$1 AND "provider"=$2 AND "usedAt" IS NULL AND "expiresAt">CURRENT_TIMESTAMP RETURNING "id","provider","codeVerifier","nonce","nextPath"`,sha256(state),provider);
  return rows[0]??null;
}

async function randomPasswordHash(){return hash(randomToken(48),{algorithm:2,memoryCost:19456,timeCost:2,parallelism:1})}
async function linkOrCreate(identity:Identity){
  let created=false;
  const linked=await prisma.$queryRawUnsafe<Array<{userId:string}>>(`SELECT "userId" FROM "OAuthAccount" WHERE "provider"=$1 AND "providerSubject"=$2 LIMIT 1`,identity.provider,identity.subject);
  if(linked[0]){
    const user=await prisma.user.findUnique({where:{id:linked[0].userId},select:{id:true,status:true}});
    if(!user||user.status!=="ACTIVE")throw new Error("oauth_account_unavailable");
    return{userId:user.id,created:false};
  }

  let user=await prisma.user.findUnique({where:{email:identity.email},select:{id:true,status:true,emailVerifiedAt:true}});
  if(user){
    if(identity.provider==="google"&&!identity.authoritativeEmail)throw new Error("oauth_existing_account_requires_password");
    if(!identity.emailVerified)throw new Error("oauth_email_not_verified");
    if(!["ACTIVE","PENDING_VERIFICATION"].includes(user.status))throw new Error("oauth_account_unavailable");
    if(user.status==="PENDING_VERIFICATION"||!user.emailVerifiedAt)await prisma.user.update({where:{id:user.id},data:{status:"ACTIVE",emailVerifiedAt:new Date()}});
  }else{
    const site=await getSiteSettings();if(!site.allowRegistrations)throw new Error("registrations_disabled");
    if(!identity.emailVerified)throw new Error("oauth_email_not_verified");
    user=await prisma.user.create({data:{email:identity.email,passwordHash:await randomPasswordHash(),kind:"PARTICULIER",status:"ACTIVE",emailVerifiedAt:new Date(),profile:{create:{displayName:identity.displayName??undefined,locale:"fr-FR",countryCode:"FR"}}},select:{id:true,status:true,emailVerifiedAt:true}});
    created=true;
    const credit=await grantWelcomeSiteCredit(user.id);
    await queueTransactionalEmail({userId:user.id,eventKind:"AUTH_WELCOME",title:"Bienvenue sur Petit Annonces 🎉",body:"Votre compte est actif. Votre crédit de bienvenue a été ajouté à votre compte, utilisable uniquement pour les services Petit Annonces.",actionUrl:"/mon-compte/portefeuille",metadata:{purpose:"WELCOME",welcomeCreditMinor:credit.grantedMinor||WELCOME_SITE_CREDIT_MINOR,oauthProvider:identity.provider}}).catch(()=>undefined);
    await queueAdminRoleEmail({roles:["SUPER_ADMIN","ADMIN"],eventKind:"ADMIN_NEW_REGISTRATION",title:"Nouvelle inscription sur Petit Annonces",body:`Un nouveau membre vient de créer un compte via ${identity.provider==="google"?"Google":"Apple"} : ${identity.displayName??identity.email} · ${identity.email} · PARTICULIER.`,actionUrl:`https://admin.petitannonces.fr/users?search=${encodeURIComponent(identity.email)}`,metadata:{purpose:"ADMIN_NEW_REGISTRATION",userId:user.id,kind:"PARTICULIER",status:"ACTIVE",channel:"OAUTH",oauthProvider:identity.provider}}).catch(()=>undefined);
  }

  await prisma.$executeRawUnsafe(`INSERT INTO "OAuthAccount" ("id","userId","provider","providerSubject","providerEmail","updatedAt") VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP) ON CONFLICT ("provider","providerSubject") DO NOTHING`,randomUUID(),user.id,identity.provider,identity.subject,identity.email);
  const owner=await prisma.$queryRawUnsafe<Array<{userId:string}>>(`SELECT "userId" FROM "OAuthAccount" WHERE "provider"=$1 AND "providerSubject"=$2 LIMIT 1`,identity.provider,identity.subject);
  if(!owner[0]||owner[0].userId!==user.id)throw new Error("oauth_account_conflict");
  return{userId:user.id,created};
}

async function finishLogin(identity:Identity,stateRow:StateRow,request:FastifyRequest,reply:FastifyReply,postCallback=false){
  const result=await linkOrCreate(identity);
  const user=await prisma.user.findUnique({where:{id:result.userId},select:{id:true,status:true}});
  if(!user||user.status!=="ACTIVE")throw new Error("oauth_account_unavailable");
  await prisma.user.update({where:{id:user.id},data:{lastLoginAt:new Date(),failedLoginAttempts:0,lockedUntil:null}});
  if(await isTwoFactorEnabled(user.id)){
    const challenge=await createTwoFactorLoginChallenge(user.id);
    reply.setCookie(OAUTH_2FA_COOKIE,challenge,{httpOnly:true,secure:request.protocol==="https",sameSite:"lax",path:"/",maxAge:300});
    const target=`${publicWeb()}/connexion?oauth=2fa&next=${encodeURIComponent(safeNext(stateRow.nextPath))}`;return postCallback?reply.code(303).redirect(target):reply.redirect(target);
  }
  await issueSession(user.id,request,reply,true);
  const destination=result.created?withQuery(safeNext(stateRow.nextPath),"oauth_signup",identity.provider):safeNext(stateRow.nextPath);
  const target=`${publicWeb()}${destination}`;return postCallback?reply.code(303).redirect(target):reply.redirect(target);
}

async function googleIdentity(code:string,stateRow:StateRow){
  const config=googleConfig();if(!config)throw new Error("oauth_provider_not_configured");
  const body=new URLSearchParams({code,client_id:config.clientId,client_secret:config.clientSecret,redirect_uri:callbackUrl("google"),grant_type:"authorization_code",code_verifier:stateRow.codeVerifier});
  const tokenResponse=await fetch(GOOGLE_TOKEN,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:body.toString()});
  const tokens=await tokenResponse.json().catch(()=>({})) as {access_token?:string};
  if(!tokenResponse.ok||!tokens.access_token)throw new Error("oauth_token_exchange_failed");
  const profileResponse=await fetch(GOOGLE_USERINFO,{headers:{authorization:`Bearer ${tokens.access_token}`}});
  const p=await profileResponse.json().catch(()=>({})) as Record<string,unknown>;
  if(!profileResponse.ok)throw new Error("oauth_profile_failed");
  const subject=String(p.sub??"").trim();const email=String(p.email??"").trim().toLowerCase();const verified=p.email_verified===true||String(p.email_verified)==="true";
  if(!subject||!email)throw new Error("oauth_profile_incomplete");
  const authoritative=verified&&(email.endsWith("@gmail.com")||Boolean(String(p.hd??"").trim()));
  return{provider:"google" as const,subject,email,emailVerified:verified,displayName:String(p.name??"").trim()||null,authoritativeEmail:authoritative};
}

function base64urlJson(value:unknown){return Buffer.from(JSON.stringify(value)).toString("base64url")}
function appleClientSecret(config:NonNullable<ReturnType<typeof appleConfig>>){
  const now=Math.floor(Date.now()/1000);const header=base64urlJson({alg:"ES256",kid:config.keyId});const payload=base64urlJson({iss:config.teamId,iat:now,exp:now+60*60*24*30,aud:APPLE_ISSUER,sub:config.clientId});const input=`${header}.${payload}`;
  const signature=cryptoSign("sha256",Buffer.from(input),{key:config.privateKey,dsaEncoding:"ieee-p1363"}).toString("base64url");
  return`${input}.${signature}`;
}
let appleKeysCache:{at:number;keys:Array<Record<string,unknown>>}|null=null;
async function appleKeys(){
  if(appleKeysCache&&Date.now()-appleKeysCache.at<60*60*1000)return appleKeysCache.keys;
  const response=await fetch(APPLE_JWKS);const payload=await response.json().catch(()=>({})) as {keys?:Array<Record<string,unknown>>};if(!response.ok||!Array.isArray(payload.keys))throw new Error("oauth_jwks_failed");appleKeysCache={at:Date.now(),keys:payload.keys};return payload.keys;
}
async function verifyAppleIdToken(token:string,config:NonNullable<ReturnType<typeof appleConfig>>,nonce:string){
  const parts=token.split(".");if(parts.length!==3)throw new Error("oauth_id_token_invalid");
  const h=parts[0]!,p=parts[1]!,sig=parts[2]!;const header=JSON.parse(Buffer.from(h,"base64url").toString("utf8")) as Record<string,unknown>;const payload=JSON.parse(Buffer.from(p,"base64url").toString("utf8")) as Record<string,unknown>;
  if(header.alg!=="RS256"||typeof header.kid!=="string")throw new Error("oauth_id_token_invalid");
  const jwk=(await appleKeys()).find(k=>k.kid===header.kid);if(!jwk)throw new Error("oauth_jwks_key_missing");
  const key=createPublicKey({key:jwk as any,format:"jwk"});const valid=cryptoVerify("RSA-SHA256",Buffer.from(`${h}.${p}`),key,Buffer.from(sig,"base64url"));if(!valid)throw new Error("oauth_id_token_invalid");
  const aud=payload.aud;const audience=Array.isArray(aud)?aud.map(String):[String(aud??"")];if(payload.iss!==APPLE_ISSUER||!audience.includes(config.clientId)||Number(payload.exp??0)<=Math.floor(Date.now()/1000)||String(payload.nonce??"")!==nonce)throw new Error("oauth_id_token_invalid");
  return payload;
}
async function appleIdentity(code:string,stateRow:StateRow,userRaw:unknown){
  const config=appleConfig();if(!config)throw new Error("oauth_provider_not_configured");
  const body=new URLSearchParams({client_id:config.clientId,client_secret:appleClientSecret(config),code,grant_type:"authorization_code",redirect_uri:callbackUrl("apple")});
  const tokenResponse=await fetch(APPLE_TOKEN,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:body.toString()});
  const tokens=await tokenResponse.json().catch(()=>({})) as {id_token?:string};if(!tokenResponse.ok||!tokens.id_token)throw new Error("oauth_token_exchange_failed");
  const payload=await verifyAppleIdToken(tokens.id_token,config,stateRow.nonce);const subject=String(payload.sub??"").trim();let email=String(payload.email??"").trim().toLowerCase();const verified=payload.email_verified===true||String(payload.email_verified)==="true";
  let displayName:string|null=null;
  if(typeof userRaw==="string"&&userRaw){try{const u=JSON.parse(userRaw) as any;email=email||String(u?.email??"").trim().toLowerCase();displayName=[u?.name?.firstName,u?.name?.lastName].filter(Boolean).join(" ").trim()||null}catch{}}
  if(!subject||!email)throw new Error("oauth_profile_incomplete");
  return{provider:"apple" as const,subject,email,emailVerified:verified,displayName,authoritativeEmail:verified};
}

export async function registerOAuthRoutes(app:FastifyInstance){
  if(!app.hasContentTypeParser("application/x-www-form-urlencoded"))app.addContentTypeParser("application/x-www-form-urlencoded",{parseAs:"string"},(_request,body,done)=>{try{done(null,Object.fromEntries(new URLSearchParams(String(body))))}catch(error){done(error as Error,undefined)}});

  app.get("/auth/oauth/providers",async(_request,reply)=>reply.send({google:Boolean(googleConfig()),apple:Boolean(appleConfig())}));

  app.get("/auth/oauth/:provider/start",async(request,reply)=>{
    const params=z.object({provider:z.enum(["google","apple"])}).safeParse(request.params);const query=z.object({next:z.string().optional()}).safeParse(request.query);if(!params.success)return oauthError(reply,"oauth_provider_invalid");
    const provider=params.data.provider;const configured=provider==="google"?googleConfig():appleConfig();if(!configured)return oauthError(reply,"oauth_provider_not_configured",query.success?safeNext(query.data.next):"/mon-compte");
    if(!await enforceAuthRateLimit({request,reply,action:`OAUTH_START_${provider.toUpperCase()}`,limit:30,windowMs:15*60*1000}))return;
    const nextPath=query.success?safeNext(query.data.next):"/mon-compte";const state=await createState(provider,nextPath);
    if(provider==="google"){
      const cfg=googleConfig()!;const url=new URL(GOOGLE_AUTH);url.search=new URLSearchParams({client_id:cfg.clientId,redirect_uri:callbackUrl("google"),response_type:"code",scope:"openid email profile",state:state.token,code_challenge:pkceChallenge(state.codeVerifier),code_challenge_method:"S256",prompt:"select_account"}).toString();return reply.redirect(url.toString());
    }
    const cfg=appleConfig()!;const url=new URL(APPLE_AUTH);url.search=new URLSearchParams({client_id:cfg.clientId,redirect_uri:callbackUrl("apple"),response_type:"code id_token",response_mode:"form_post",scope:"name email",state:state.token,nonce:state.nonce}).toString();return reply.redirect(url.toString());
  });

  app.get("/auth/oauth/google/callback",async(request,reply)=>{
    const q=z.object({state:z.string().min(20),code:z.string().min(2).optional(),error:z.string().optional()}).safeParse(request.query);if(!q.success)return oauthError(reply,"oauth_state_invalid");
    const stateRow=await consumeState("google",q.data.state);if(!stateRow)return oauthError(reply,"oauth_state_invalid");if(q.data.error||!q.data.code)return oauthError(reply,"oauth_cancelled",stateRow.nextPath);
    try{return await finishLogin(await googleIdentity(q.data.code,stateRow),stateRow,request,reply)}catch(error){return oauthError(reply,error instanceof Error?error.message:"oauth_login_failed",stateRow.nextPath)}
  });

  app.post("/auth/oauth/apple/callback",async(request,reply)=>{
    const body=z.object({state:z.string().min(20),code:z.string().min(2).optional(),error:z.string().optional(),user:z.string().optional()}).safeParse(request.body);if(!body.success)return oauthError(reply,"oauth_state_invalid");
    const stateRow=await consumeState("apple",body.data.state);if(!stateRow)return oauthError(reply,"oauth_state_invalid");if(body.data.error||!body.data.code)return oauthError(reply,"oauth_cancelled",stateRow.nextPath);
    try{return await finishLogin(await appleIdentity(body.data.code,stateRow,body.data.user),stateRow,request,reply,true)}catch(error){return reply.code(303).redirect(`${publicWeb()}/connexion?oauth_error=${encodeURIComponent(error instanceof Error?error.message:"oauth_login_failed")}&next=${encodeURIComponent(safeNext(stateRow.nextPath))}`)}
  });

  app.post("/auth/oauth/2fa/complete",async(request,reply)=>{
    const token=request.cookies[OAUTH_2FA_COOKIE];const body=z.object({code:z.string().trim().min(6).max(32),remember:z.boolean().default(true)}).safeParse(request.body);if(!token||!body.success)return reply.code(400).send({error:"invalid_request"});
    if(!await enforceAuthRateLimit({request,reply,action:"OAUTH_LOGIN_2FA",limit:12,windowMs:15*60*1000,blockMs:15*60*1000}))return;
    const userId=await verifyTwoFactorLoginChallenge(token,body.data.code);if(!userId)return reply.code(401).send({error:"invalid_two_factor_code"});
    reply.clearCookie(OAUTH_2FA_COOKIE,{path:"/"});await prisma.user.update({where:{id:userId},data:{lastLoginAt:new Date(),failedLoginAttempts:0,lockedUntil:null}});await issueSession(userId,request,reply,body.data.remember);return reply.send({authenticated:true});
  });
}
