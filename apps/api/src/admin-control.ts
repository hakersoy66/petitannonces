import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import sharp from "sharp";
import { requireAdminRoles } from "./rbac.js";
import { createPresignedUpload, makeStoredObjectPublic, publicObjectUrl, readStoredObjectBuffer, readStoredObjectText, storageConfigured, uploadStoredObject, verifyStoredObject } from "./storage.js";

export type IntegrationProvider = "marketplace-payment" | "paypal-checkout" | "stripe-billing" | "sendcloud" | "hostinger-mail" | "twilio-verify" | "openai" | "vehicle-data" | "web-extraction" | "meta-ads" | "google-ads" | "hbx-hotels";
export type RuntimeIntegration = { enabled: boolean; config: Record<string, unknown>; secrets: Record<string, string> };

const execFileAsync=promisify(execFile);
const FULL_ADMIN = ["SUPER_ADMIN", "ADMIN"] as const;
const SITE_ADMIN = ["SUPER_ADMIN", "ADMIN", "MARKETING"] as const;
const INTEGRATION_ADMIN = ["SUPER_ADMIN", "ADMIN"] as const;
const MAX_BRANDING_BYTES = 5 * 1024 * 1024;
const BRAND_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/x-icon", "image/vnd.microsoft.icon", "image/svg+xml"]);
const RASTER_BRAND_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/x-icon", "image/vnd.microsoft.icon"]);
const PROVIDERS: IntegrationProvider[] = ["marketplace-payment", "paypal-checkout", "stripe-billing", "sendcloud", "hostinger-mail", "twilio-verify", "openai", "vehicle-data", "web-extraction", "meta-ads", "google-ads", "hbx-hotels"];

const DEFAULT_SITE = {
  siteName: "Petit Annonces",
  tagline: "Achetez et vendez partout en France",
  logoUrl: null as string | null,
  mobileLogoUrl: null as string | null,
  pwaIconUrl: null as string | null,
  pwaIcon180Url: null as string | null,
  pwaIcon192Url: null as string | null,
  pwaIcon512Url: null as string | null,
  appLogoUrl: null as string | null,
  footerLogoUrl: null as string | null,
  faviconUrl: null as string | null,
  ogImageUrl: null as string | null,
  accentColor: "#5b4cf0",
  supportEmail: "",
  supportPhone: "",
  seoTitle: "Petit Annonces FR – Petites annonces gratuites en France",
  seoDescription: "Achetez et vendez partout en France sur Petit Annonces. Publiez gratuitement vos annonces de véhicules, immobilier, high-tech, maison, emploi et services.",
  maintenanceMode: false,
  allowRegistrations: true,
  moderationRequired: true,
  watermarkEnabled: true,
  watermarkReinforced: true,
  watermarkOpacity: 0.88,
  fingerprintEnabled: true,
  fingerprintStrength: 2,
  fingerprintVersion: 2,
  heroTitleLine1: "Vendez gratuitement.",
  heroTitleLine2: "Achetez en confiance.",
  heroLead: "Publiez gratuitement, achetez plus sereinement et ouvrez votre boutique Pro sans frais.",
  navigationCategorySlugs: ["vehicules","immobilier","vacances","high-tech","mode","emploi","maison-jardin","services","enfants-bebe","animaux"],
  footerDescription: "Achetez, vendez et trouvez près de chez vous, simplement et en confiance.",
  footerGroups: [
    { title: "Petit Annonces", links: [{ label: "Sécurité", href: "/conformite" }, { label: "Confidentialité", href: "/confidentialite" }, { label: "Cookies", href: "/cookies" }] },
    { title: "Acheter & vendre", links: [{ label: "Déposer une annonce", href: "/deposer-une-annonce" }, { label: "Rechercher", href: "/recherche" }, { label: "Boutiques pro", href: "/inscription/pro" }] },
    { title: "Informations", links: [{ label: "Conditions générales", href: "/conditions-generales" }, { label: "Signaler un contenu", href: "/signaler-contenu-illicite" }, { label: "Mon compte", href: "/mon-compte" }] },
  ],
  homeSections: [
    { key: "hero", enabled: true, order: 10 },
    { key: "latest", enabled: true, order: 20 },
    { key: "categoryFeeds", enabled: true, order: 30 },
    { key: "trust", enabled: true, order: 40 },
    { key: "pro", enabled: true, order: 50 },
    { key: "cta", enabled: true, order: 60 },
  ],
};

const siteSchema = z.object({
  siteName: z.string().trim().min(2).max(80),
  tagline: z.string().trim().max(180),
  logoUrl: z.string().url().nullable(),
  mobileLogoUrl: z.string().url().nullable(),
  pwaIconUrl: z.string().url().nullable(),
  pwaIcon180Url: z.string().url().nullable(),
  pwaIcon192Url: z.string().url().nullable(),
  pwaIcon512Url: z.string().url().nullable(),
  appLogoUrl: z.string().url().nullable(),
  footerLogoUrl: z.string().url().nullable(),
  faviconUrl: z.string().url().nullable(),
  ogImageUrl: z.string().url().nullable(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  supportEmail: z.union([z.string().trim().email(), z.literal("")]),
  supportPhone: z.string().trim().max(40),
  seoTitle: z.string().trim().min(5).max(160),
  seoDescription: z.string().trim().min(20).max(320),
  maintenanceMode: z.boolean(),
  allowRegistrations: z.boolean(),
  moderationRequired: z.boolean(),
  watermarkEnabled: z.boolean(),
  watermarkReinforced: z.boolean(),
  watermarkOpacity: z.number().min(0.35).max(1),
  fingerprintEnabled: z.boolean(),
  fingerprintStrength: z.number().int().min(1).max(4),
  fingerprintVersion: z.number().int().min(1).max(10),
  heroTitleLine1: z.string().trim().min(2).max(80),
  heroTitleLine2: z.string().trim().min(2).max(80),
  heroLead: z.string().trim().min(10).max(240),
  navigationCategorySlugs: z.array(z.string().trim().min(1).max(120)).max(20).refine(items=>new Set(items).size===items.length,{message:"duplicate_navigation_category"}),
  footerDescription: z.string().trim().max(300),
  footerGroups: z.array(z.object({
    title: z.string().trim().min(1).max(80),
    links: z.array(z.object({ label: z.string().trim().min(1).max(80), href: z.string().trim().min(1).max(240).refine(value=>value.startsWith("/")||value.startsWith("https://"),{message:"unsafe_footer_url"}) })).max(8),
  })).max(6),
  homeSections: z.array(z.object({
    key: z.enum(["hero","latest","categoryFeeds","trust","pro","cta"]),
    enabled: z.boolean(),
    order: z.number().int().min(0).max(1000),
  })).length(6).refine(items=>new Set(items.map(item=>item.key)).size===6,{message:"duplicate_home_section"}),
});

const providerSchema = z.enum(["marketplace-payment", "paypal-checkout", "stripe-billing", "sendcloud", "hostinger-mail", "twilio-verify", "openai", "vehicle-data", "web-extraction", "meta-ads", "google-ads", "hbx-hotels"]);
const updateIntegrationSchema = z.object({
  enabled: z.boolean(),
  config: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  secrets: z.record(z.string(), z.string().max(5000)).default({}),
});

let runtimeCache = new Map<IntegrationProvider, { at: number; value: RuntimeIntegration | null }>();

function encryptionKey() {
  const raw = process.env.ADMIN_CONFIG_ENCRYPTION_KEY;
  if (!raw) throw new Error("admin_config_encryption_key_missing");
  return createHash("sha256").update(raw).digest();
}
function encryptSecrets(value: Record<string, string>) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}
function decryptSecrets(ciphertext: string | null): Record<string, string> {
  if (!ciphertext) return {};
  try {
    const [version, ivRaw, tagRaw, dataRaw] = ciphertext.split(".");
    if (version !== "v1" || !ivRaw || !tagRaw || !dataRaw) return {};
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivRaw, "base64url"));
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    const json = Buffer.concat([decipher.update(Buffer.from(dataRaw, "base64url")), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(json) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === "string")) as Record<string, string>;
  } catch { return {}; }
}
function ext(mime: string) {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/avif") return "avif";
  if (mime === "image/x-icon" || mime === "image/vnd.microsoft.icon") return "ico";
  if (mime === "image/svg+xml") return "svg";
  return "webp";
}
async function createPwaIconVariants(input: Uint8Array) {
  const id = randomUUID();
  const render = async (size: 180 | 192 | 512) => {
    const png = await sharp(input, { density: 512 })
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    return uploadStoredObject(`site/branding/pwaIcon/${id}-${size}.png`, "image/png", png);
  };
  const [pwaIcon180Url, pwaIcon192Url, pwaIcon512Url] = await Promise.all([render(180), render(192), render(512)]);
  return { pwaIcon180Url, pwaIcon192Url, pwaIcon512Url };
}
async function currentAdminId(request: any) {
  const token = request.cookies?.pa_session;
  if (!token) return null;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const session = await prisma.session.findUnique({ where: { tokenHash }, select: { userId: true, revokedAt: true, expiresAt: true } });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
  return session.userId;
}
async function audit(actorUserId: string | null, action: string, entityType: string, entityId?: string, metadata?: unknown) {
  if (!actorUserId) return;
  await prisma.$executeRawUnsafe(
    `INSERT INTO "AdminAuditEvent" ("id","actorUserId","action","entityType","entityId","metadata") VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    randomUUID(), actorUserId, action, entityType, entityId ?? null, metadata ? JSON.stringify(metadata) : null,
  );
}
async function loadSiteSetting() {
  const rows = await prisma.$queryRawUnsafe<Array<{ value: unknown }>>(`SELECT "value" FROM "AdminSetting" WHERE "key"='site.settings' LIMIT 1`);
  const stored = rows[0]?.value && typeof rows[0].value === "object" ? rows[0].value as Record<string, unknown> : {};
  return siteSchema.parse({ ...DEFAULT_SITE, ...stored });
}
export async function getSiteSettings() {
  return loadSiteSetting().catch(() => siteSchema.parse(DEFAULT_SITE));
}

async function saveSiteSetting(value: z.infer<typeof siteSchema>, actorUserId: string | null) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "AdminSetting" ("key","value","updatedByUserId","updatedAt") VALUES ('site.settings',$1::jsonb,$2,CURRENT_TIMESTAMP)
     ON CONFLICT ("key") DO UPDATE SET "value"=EXCLUDED."value","updatedByUserId"=EXCLUDED."updatedByUserId","updatedAt"=CURRENT_TIMESTAMP`,
    JSON.stringify(value), actorUserId,
  );
}

export async function getRuntimeIntegration(provider: IntegrationProvider): Promise<RuntimeIntegration | null> {
  const cached = runtimeCache.get(provider);
  if (cached && Date.now() - cached.at < 15_000) return cached.value;
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ enabled: boolean; config: unknown; secretCiphertext: string | null }>>(
      `SELECT "enabled","config","secretCiphertext" FROM "AdminIntegration" WHERE "provider"=$1 LIMIT 1`, provider,
    );
    const row = rows[0];
    const value = row ? { enabled: row.enabled, config: (row.config && typeof row.config === "object" ? row.config : {}) as Record<string, unknown>, secrets: decryptSecrets(row.secretCiphertext) } : null;
    runtimeCache.set(provider, { at: Date.now(), value });
    return value;
  } catch {
    return null;
  }
}

export type StripeBillingMode="test"|"live";
export function resolveStripeBillingIntegration(configured:RuntimeIntegration|null,forceMode?:StripeBillingMode){
  if(!configured?.enabled)return null;
  const requested=String(configured.config.mode??"").toLowerCase();
  const inferred:StripeBillingMode=configured.secrets.apiKey?.startsWith("sk_test_")?"test":"live";
  const mode:StripeBillingMode=forceMode??(requested==="test"||requested==="live"?requested:inferred);
  const legacyTest=configured.secrets.apiKey?.startsWith("sk_test_")?configured.secrets.apiKey:"";
  const liveApiKey=configured.secrets.apiKey?.startsWith("sk_live_")?configured.secrets.apiKey:"";
  const apiKey=mode==="test"?(configured.secrets.testApiKey??legacyTest):liveApiKey;
  const webhookSecret=mode==="test"?(configured.secrets.testWebhookSecret??(legacyTest?configured.secrets.webhookSecret:"")??""):(configured.secrets.webhookSecret??process.env.STRIPE_BILLING_WEBHOOK_SECRET??"");
  const webhookToken=mode==="test"?(configured.secrets.testWebhookToken??(legacyTest?configured.secrets.webhookToken:"")??""):(configured.secrets.webhookToken??process.env.STRIPE_BILLING_WEBHOOK_TOKEN??"");
  const endpointId=String(mode==="test"?(configured.config.testWebhookEndpointId??""):(configured.config.webhookEndpointId??""));
  return{mode,apiKey,webhookSecret,webhookToken,endpointId,portalConfigurationId:String(configured.config.portalConfigurationId??"")};
}
export async function getStripeBillingRuntime(){const configured=await getRuntimeIntegration("stripe-billing");return resolveStripeBillingIntegration(configured,process.env.NODE_ENV==="production"?"live":undefined)}
export function resolveTwilioVerifyIntegration(configured:RuntimeIntegration|null){
  if(!configured?.enabled)return null;
  const serviceSid=String(configured.config.serviceSid??"").trim();
  const accountSid=String(configured.config.accountSid??"").trim();
  const apiKey=String(configured.config.apiKey??"").trim();
  const apiSecret=String(configured.secrets.apiSecret??"").trim();
  const authToken=String(configured.secrets.authToken??"").trim();
  const username=apiKey||accountSid;
  const password=apiSecret||authToken;
  return{serviceSid,accountSid,apiKey,apiSecret,authToken,username,password};
}
export async function getTwilioVerifyRuntime(){
  const configured=resolveTwilioVerifyIntegration(await getRuntimeIntegration("twilio-verify"));
  if(configured?.serviceSid&&configured.username&&configured.password)return configured;
  const serviceSid=String(process.env.TWILIO_VERIFY_SERVICE_SID??"").trim();
  const accountSid=String(process.env.TWILIO_ACCOUNT_SID??"").trim();
  const apiKey=String(process.env.TWILIO_API_KEY??"").trim();
  const apiSecret=String(process.env.TWILIO_API_SECRET??"").trim();
  const authToken=String(process.env.TWILIO_AUTH_TOKEN??"").trim();
  const username=apiKey||accountSid;const password=apiSecret||authToken;
  return serviceSid&&username&&password?{serviceSid,accountSid,apiKey,apiSecret,authToken,username,password}:null;
}
export async function getStripeBillingModeRuntime(mode:StripeBillingMode){return resolveStripeBillingIntegration(await getRuntimeIntegration("stripe-billing"),mode)}

export async function getHbxHotelsRuntime(){
  const configured=await getRuntimeIntegration("hbx-hotels");
  if(!configured?.enabled)return null;
  const environment=String(configured.config.environment??"test").toLowerCase()==="live"?"live":"test";
  const apiKey=String(configured.secrets.apiKey??"").trim();
  const secret=String(configured.secrets.secret??"").trim();
  const baseUrl=environment==="live"?"https://api.hotelbeds.com":"https://api.test.hotelbeds.com";
  return{environment,apiKey,secret,baseUrl};
}
function hbxSignature(apiKey:string,secret:string){
  const timestamp=Math.floor(Date.now()/1000);
  return createHash("sha256").update(apiKey+secret+String(timestamp)).digest("hex");
}

export async function ensureStripeWebhook(mode:StripeBillingMode,actor:string|null){
  const configured=await getRuntimeIntegration("stripe-billing");
  const stripe=resolveStripeBillingIntegration(configured,mode);
  if(!configured?.enabled||!stripe?.apiKey)throw new Error("stripe_not_configured");
  if(stripe.endpointId&&stripe.webhookSecret&&stripe.webhookToken)return{existing:true,mode,endpointId:stripe.endpointId,events:13};
  const token=randomBytes(24).toString("base64url");
  const endpointUrl=mode==="test"?`https://petitannonces.fr/api/billing/stripe/test-webhook/${token}`:`https://petitannonces.fr/api/billing/stripe/webhook/${token}`;
  const events=["checkout.session.completed","checkout.session.expired","checkout.session.async_payment_succeeded","checkout.session.async_payment_failed","payment_intent.payment_failed","refund.updated","customer.subscription.created","customer.subscription.updated","customer.subscription.deleted","invoice.paid","invoice.payment_failed","transfer.created","transfer.reversed"];
  const params=new URLSearchParams();params.set("url",endpointUrl);params.set("description",`Petit Annonces · ${mode.toUpperCase()} · paiements et abonnements`);for(const event of events)params.append("enabled_events[]",event);
  const response=await fetch("https://api.stripe.com/v1/webhook_endpoints",{method:"POST",headers:{authorization:`Bearer ${stripe.apiKey}`,"content-type":"application/x-www-form-urlencoded"},body:params.toString()});
  const payload=await response.json().catch(()=>({})) as Record<string,unknown>;
  if(!response.ok)throw new Error(`stripe_webhook_setup_failed_${response.status}_${String((payload.error as any)?.type??"error")}`);
  const endpointId=typeof payload.id==="string"?payload.id:"";const secret=typeof payload.secret==="string"?payload.secret:"";
  if(!endpointId||!secret)throw new Error("stripe_webhook_secret_missing");
  const mergedSecrets={...(configured.secrets??{})};const mergedConfig={...(configured.config??{})};
  if(mode==="test"){mergedSecrets.testWebhookToken=token;mergedSecrets.testWebhookSecret=secret;mergedConfig.testWebhookEndpointId=endpointId}else{mergedSecrets.webhookToken=token;mergedSecrets.webhookSecret=secret;mergedConfig.webhookEndpointId=endpointId}
  const cipher=encryptSecrets(mergedSecrets);
  await prisma.$executeRawUnsafe(`UPDATE "AdminIntegration" SET "config"=$1::jsonb,"secretCiphertext"=$2,"updatedByUserId"=$3,"updatedAt"=CURRENT_TIMESTAMP WHERE "provider"='stripe-billing'`,JSON.stringify(mergedConfig),cipher,actor);
  runtimeCache.delete("stripe-billing");
  await audit(actor,"STRIPE_WEBHOOK_CONFIGURED","INTEGRATION","stripe-billing",{endpointId,events,mode});
  return{existing:false,mode,endpointId,events:events.length};
}

export type MangopayEnvironment="sandbox"|"production";
export function resolveMangopayIntegration(configured:RuntimeIntegration|null){
  if(!configured?.enabled||String(configured.config.provider??"").toLowerCase()!=="mangopay")return null;
  const requested=String(configured.config.environment??"sandbox").toLowerCase();
  const environment:MangopayEnvironment=requested==="production"?"production":"sandbox";
  const clientId=String(configured.config.clientId??"").trim();
  const apiKey=String(configured.secrets.apiKey??"").trim();
  const webhookToken=String(configured.secrets.webhookToken??"").trim();
  const webhookAlertEmail=String(configured.config.webhookAlertEmail??"").trim();
  const baseUrl=environment==="production"?"https://api.mangopay.com":"https://api.sandbox.mangopay.com";
  return{provider:"mangopay" as const,environment,clientId,apiKey,webhookToken,webhookAlertEmail,baseUrl};
}
export async function getMangopayRuntime(){return resolveMangopayIntegration(await getRuntimeIntegration("marketplace-payment"));}
let mangopayTokenCache:{key:string;token:string;expiresAt:number}|null=null;
export async function getMangopayAccessToken(){
  const runtime=await getMangopayRuntime();if(!runtime?.clientId||!runtime.apiKey)throw new Error("mangopay_not_configured");
  const key=`${runtime.environment}:${runtime.clientId}`;if(mangopayTokenCache?.key===key&&mangopayTokenCache.expiresAt>Date.now()+30000)return{runtime,token:mangopayTokenCache.token};
  const auth=Buffer.from(`${runtime.clientId}:${runtime.apiKey}`,"utf8").toString("base64");
  const response=await fetch(`${runtime.baseUrl}/v2.01/oauth/token`,{method:"POST",headers:{authorization:`Basic ${auth}`,"content-type":"application/x-www-form-urlencoded"},body:"grant_type=client_credentials"});
  const payload=await response.json().catch(()=>({})) as Record<string,unknown>;
  if(!response.ok||typeof payload.access_token!=="string")throw new Error(`mangopay_auth_failed_${response.status}`);
  const expires=Math.max(60,Number(payload.expires_in??600));mangopayTokenCache={key,token:payload.access_token,expiresAt:Date.now()+expires*1000};
  return{runtime,token:payload.access_token};
}
export async function mangopayApi(path:string,init:RequestInit={}){
  const {runtime,token}=await getMangopayAccessToken();
  const headers:Record<string,string>={authorization:`Bearer ${token}`};if(init.body)headers["content-type"]="application/json";
  for(const [key,value] of Object.entries((init.headers??{}) as Record<string,string>))headers[key]=value;
  const response=await fetch(`${runtime.baseUrl}${path}`,{...init,headers});
  const payload=await response.json().catch(()=>null);return{runtime,response,payload};
}

export const MANGOPAY_WEBHOOK_EVENTS=["USER_ACCOUNT_VALIDATION_ASKED","USER_ACCOUNT_ACTIVATED","SCA_ENROLLMENT_SUCCEEDED","SCA_ENROLLMENT_FAILED","SCA_ENROLLMENT_EXPIRED","USER_KYC_REGULAR","USER_KYC_LIGHT","USER_KYC_RENEWAL_REQUIRED","USER_KYC_RENEWED","IDENTITY_VERIFICATION_PENDING","IDENTITY_VERIFICATION_VALIDATED","IDENTITY_VERIFICATION_FAILED","IDENTITY_VERIFICATION_INCONCLUSIVE","IDENTITY_VERIFICATION_OUTDATED","RECIPIENT_ACTIVE","RECIPIENT_CANCELED","RECIPIENT_DEACTIVATED","PAYIN_NORMAL_CREATED","PAYIN_NORMAL_SUCCEEDED","PAYIN_NORMAL_FAILED","PAYIN_REFUND_CREATED","PAYIN_REFUND_SUCCEEDED","PAYIN_REFUND_FAILED","PAYOUT_NORMAL_CREATED","PAYOUT_NORMAL_SUCCEEDED","PAYOUT_NORMAL_FAILED","PAYOUT_REFUND_CREATED","PAYOUT_REFUND_SUCCEEDED","PAYOUT_REFUND_FAILED"] as const;
export async function ensureMangopayWebhooks(actor:string|null){
  let configured=await getRuntimeIntegration("marketplace-payment");let runtime=resolveMangopayIntegration(configured);
  if(!configured?.enabled||!runtime?.clientId||!runtime.apiKey)throw new Error("mangopay_not_configured");
  let token=runtime.webhookToken;
  if(!token){
    token=randomBytes(24).toString("base64url");const mergedSecrets={...(configured.secrets??{}),webhookToken:token};const cipher=encryptSecrets(mergedSecrets);
    await prisma.$executeRawUnsafe(`UPDATE "AdminIntegration" SET "secretCiphertext"=$1,"updatedByUserId"=$2,"updatedAt"=CURRENT_TIMESTAMP WHERE "provider"='marketplace-payment'`,cipher,actor);
    runtimeCache.delete("marketplace-payment");configured=await getRuntimeIntegration("marketplace-payment");runtime=resolveMangopayIntegration(configured);
  }
  if(!runtime?.clientId||!runtime.apiKey||!token)throw new Error("mangopay_not_configured");
  const url=`https://petitannonces.fr/api/marketplace/mangopay/webhook/${token}`;
  const listed=await mangopayApi(`/v2.01/${encodeURIComponent(runtime.clientId)}/hooks`);if(!listed.response.ok||!Array.isArray(listed.payload))throw new Error(`mangopay_hooks_list_failed_${listed.response.status}`);
  const hooks=listed.payload as Array<Record<string,unknown>>;let created=0,updated=0,existing=0;
  for(const eventType of MANGOPAY_WEBHOOK_EVENTS){
    const current=hooks.find(h=>String(h.EventType??"")===eventType);const createBody:Record<string,unknown>={EventType:eventType,Url:url,Tag:"Petit Annonces · marketplace"};if(runtime.webhookAlertEmail)createBody.Email=runtime.webhookAlertEmail;
    if(current?.Id){
      if(String(current.Url??"")===url&&String(current.Status??"")==="ENABLED"&&String(current.Validity??"")==="VALID"&&(!runtime.webhookAlertEmail||String(current.Email??"")===runtime.webhookAlertEmail)){existing++;continue;}
      const updateBody:Record<string,unknown>={Url:url,Status:"ENABLED",Validity:"VALID",Tag:"Petit Annonces · marketplace"};if(runtime.webhookAlertEmail)updateBody.Email=runtime.webhookAlertEmail;
      const r=await mangopayApi(`/v2.01/${encodeURIComponent(runtime.clientId)}/hooks/${encodeURIComponent(String(current.Id))}`,{method:"PUT",body:JSON.stringify(updateBody)});if(!r.response.ok)throw new Error(`mangopay_hook_update_failed_${r.response.status}_${eventType}`);updated++;continue;
    }
    const r=await mangopayApi(`/v2.01/${encodeURIComponent(runtime.clientId)}/hooks`,{method:"POST",body:JSON.stringify(createBody)});if(!r.response.ok)throw new Error(`mangopay_hook_create_failed_${r.response.status}_${eventType}`);created++;
  }
  await audit(actor,"MANGOPAY_WEBHOOKS_CONFIGURED","INTEGRATION","marketplace-payment",{environment:runtime.environment,created,updated,existing,events:MANGOPAY_WEBHOOK_EVENTS.length});
  return{environment:runtime.environment,created,updated,existing,events:MANGOPAY_WEBHOOK_EVENTS.length};
}

export async function registerAdminControlRoutes(app: FastifyInstance) {
  for (const mime of BRAND_MIMES) {
    if (!app.hasContentTypeParser(mime)) app.addContentTypeParser(mime, { parseAs: "buffer", bodyLimit: 15 * 1024 * 1024 }, (_request, body, done) => done(null, body));
  }

  app.get("/public/site-config", async (_request, reply) => {
    reply.header("Cache-Control", "public, max-age=30, s-maxage=300, stale-while-revalidate=600");
    const site = await loadSiteSetting().catch(() => siteSchema.parse(DEFAULT_SITE));
    return reply.send({ site: {
      siteName: site.siteName, tagline: site.tagline, logoUrl: site.logoUrl, mobileLogoUrl: site.mobileLogoUrl, pwaIconUrl: site.pwaIconUrl, pwaIcon180Url: site.pwaIcon180Url, pwaIcon192Url: site.pwaIcon192Url, pwaIcon512Url: site.pwaIcon512Url, appLogoUrl: site.appLogoUrl, footerLogoUrl: site.footerLogoUrl, faviconUrl: site.faviconUrl,
      ogImageUrl: site.ogImageUrl, accentColor: site.accentColor, maintenanceMode: site.maintenanceMode,
      allowRegistrations: site.allowRegistrations, watermarkEnabled: site.watermarkEnabled, watermarkReinforced: site.watermarkReinforced, watermarkOpacity: site.watermarkOpacity, seoTitle: site.seoTitle, seoDescription: site.seoDescription,
      heroTitleLine1: site.heroTitleLine1, heroTitleLine2: site.heroTitleLine2, heroLead: site.heroLead,
      navigationCategorySlugs: site.navigationCategorySlugs, footerDescription: site.footerDescription, footerGroups: site.footerGroups, homeSections: site.homeSections,
    }});
  });

  app.get("/public/maintenance-status", async (_request, reply) => {
    reply.header("Cache-Control", "no-store, max-age=0");
    const site = await loadSiteSetting().catch(() => siteSchema.parse(DEFAULT_SITE));
    return reply.send({ maintenanceMode: site.maintenanceMode, siteName: site.siteName, accentColor: site.accentColor, logoUrl: site.logoUrl });
  });

  app.get("/admin/settings/site", { preHandler: requireAdminRoles([...SITE_ADMIN]) }, async (_request, reply) => {
    return reply.send({ site: await loadSiteSetting() });
  });
  app.put("/admin/settings/maintenance", { preHandler: requireAdminRoles([...SITE_ADMIN]) }, async (request, reply) => {
    const parsed = z.object({ enabled: z.boolean() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_maintenance_setting" });
    const actor = await currentAdminId(request);
    const site = await loadSiteSetting();
    site.maintenanceMode = parsed.data.enabled;
    await saveSiteSetting(site, actor);
    await audit(actor, parsed.data.enabled ? "MAINTENANCE_ENABLED" : "MAINTENANCE_DISABLED", "SITE_SETTINGS", "site.settings", { enabled: parsed.data.enabled });
    return reply.send({ saved: true, maintenanceMode: site.maintenanceMode });
  });
  app.put("/admin/settings/site", { preHandler: requireAdminRoles([...SITE_ADMIN]) }, async (request, reply) => {
    const parsed = siteSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_site_settings", details: parsed.error.flatten() });
    const actor = await currentAdminId(request);
    await saveSiteSetting(parsed.data, actor);
    await audit(actor, "SITE_SETTINGS_UPDATED", "SITE_SETTINGS", "site.settings", { fields: Object.keys(parsed.data) });
    return reply.send({ saved: true, site: parsed.data });
  });

  app.post("/admin/settings/branding/upload-intent", { preHandler: requireAdminRoles([...SITE_ADMIN]) }, async (request, reply) => {
    if (!storageConfigured()) return reply.code(503).send({ error: "object_storage_not_configured" });
    const body = z.object({ kind: z.enum(["logo", "mobileLogo", "pwaIcon", "appLogo", "footerLogo", "favicon", "ogImage"]), mimeType: z.string(), sizeBytes: z.number().int().positive() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });
    const allowed = body.data.kind === "ogImage" ? RASTER_BRAND_MIMES : BRAND_MIMES;
    if (!allowed.has(body.data.mimeType)) return reply.code(415).send({ error: "unsupported_media_type" });
    if (body.data.sizeBytes > MAX_BRANDING_BYTES) return reply.code(413).send({ error: "media_too_large", maxBytes: MAX_BRANDING_BYTES });
    const objectKey = `site/branding/${body.data.kind}/${randomUUID()}.${ext(body.data.mimeType)}`;
    return reply.code(201).send({ objectKey, uploadUrl: await createPresignedUpload(objectKey, body.data.mimeType), method: "PUT", headers: { "content-type": body.data.mimeType }, expiresInSeconds: 600 });
  });

  app.post("/admin/settings/branding/upload-direct", { preHandler: requireAdminRoles([...SITE_ADMIN]), bodyLimit: MAX_BRANDING_BYTES }, async (request, reply) => {
    if (!storageConfigured()) return reply.code(503).send({ error: "object_storage_not_configured" });
    const kind = z.enum(["logo", "mobileLogo", "pwaIcon", "appLogo", "footerLogo", "favicon", "ogImage"]).safeParse(request.headers["x-branding-kind"]);
    if (!kind.success) return reply.code(400).send({ error: "invalid_branding_kind" });
    const mimeType = String(request.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
    const allowed = kind.data === "ogImage" ? RASTER_BRAND_MIMES : BRAND_MIMES;
    if (!mimeType || !allowed.has(mimeType)) return reply.code(415).send({ error: "unsupported_media_type" });
    const body = request.body;
    if (!Buffer.isBuffer(body) || body.length < 1) return reply.code(400).send({ error: "empty_media" });
    if (body.length > MAX_BRANDING_BYTES) return reply.code(413).send({ error: "media_too_large", maxBytes: MAX_BRANDING_BYTES });
    if (mimeType === "image/svg+xml") {
      const normalized = body.toString("utf8").toLowerCase();
      if (!/<svg\b/.test(normalized) || /<script\b|javascript:|on[a-z]+\s*=|<foreignobject\b/.test(normalized)) return reply.code(422).send({ error: "unsafe_svg" });
    }
    const objectKey = `site/branding/${kind.data}/${randomUUID()}.${ext(mimeType)}`;
    const url = await uploadStoredObject(objectKey, mimeType, body);
    const site = await loadSiteSetting();
    if (kind.data === "logo") site.logoUrl = url;
    if (kind.data === "mobileLogo") site.mobileLogoUrl = url;
    if (kind.data === "pwaIcon") {
      const variants = await createPwaIconVariants(body).catch(() => null);
      if (!variants) return reply.code(422).send({ error: "invalid_pwa_icon" });
      site.pwaIconUrl = url;
      Object.assign(site, variants);
    }
    if (kind.data === "appLogo") site.appLogoUrl = url;
    if (kind.data === "footerLogo") site.footerLogoUrl = url;
    if (kind.data === "favicon") site.faviconUrl = url;
    if (kind.data === "ogImage") site.ogImageUrl = url;
    const actor = await currentAdminId(request);
    await saveSiteSetting(site, actor);
    await audit(actor, "BRANDING_ASSET_UPDATED", "SITE_SETTINGS", kind.data, { url, directUpload: true });
    return reply.send({ saved: true, url, site });
  });

  app.post("/admin/settings/branding/confirm", { preHandler: requireAdminRoles([...SITE_ADMIN]) }, async (request, reply) => {
    const body = z.object({ kind: z.enum(["logo", "mobileLogo", "pwaIcon", "appLogo", "footerLogo", "favicon", "ogImage"]), objectKey: z.string().min(10).max(500) }).safeParse(request.body);
    if (!body.success || !body.data.objectKey.startsWith(`site/branding/${body.data.kind}/`)) return reply.code(400).send({ error: "invalid_request" });
    const stored = await verifyStoredObject(body.data.objectKey);
    const allowedStored = body.data.kind === "ogImage" ? RASTER_BRAND_MIMES : BRAND_MIMES;
    if (!stored.sizeBytes || stored.sizeBytes > MAX_BRANDING_BYTES || !stored.mimeType || !allowedStored.has(stored.mimeType)) return reply.code(422).send({ error: "stored_media_mismatch" });
    if (stored.mimeType === "image/svg+xml") {
      const svg = await readStoredObjectText(body.data.objectKey, MAX_BRANDING_BYTES);
      const normalized = svg.toLowerCase();
      if (!/<svg\b/.test(normalized) || /<script\b|javascript:|on[a-z]+\s*=|<foreignobject\b/.test(normalized)) return reply.code(422).send({ error: "unsafe_svg" });
    }
    await makeStoredObjectPublic(body.data.objectKey);
    const url = publicObjectUrl(body.data.objectKey);
    const site = await loadSiteSetting();
    if (body.data.kind === "logo") site.logoUrl = url;
    if (body.data.kind === "mobileLogo") site.mobileLogoUrl = url;
    if (body.data.kind === "pwaIcon") {
      const source = await readStoredObjectBuffer(body.data.objectKey, MAX_BRANDING_BYTES).catch(() => null);
      if (!source) return reply.code(422).send({ error: "invalid_pwa_icon" });
      const variants = await createPwaIconVariants(source).catch(() => null);
      if (!variants) return reply.code(422).send({ error: "invalid_pwa_icon" });
      site.pwaIconUrl = url;
      Object.assign(site, variants);
    }
    if (body.data.kind === "appLogo") site.appLogoUrl = url;
    if (body.data.kind === "footerLogo") site.footerLogoUrl = url;
    if (body.data.kind === "favicon") site.faviconUrl = url;
    if (body.data.kind === "ogImage") site.ogImageUrl = url;
    const actor = await currentAdminId(request);
    await saveSiteSetting(site, actor);
    await audit(actor, "BRANDING_ASSET_UPDATED", "SITE_SETTINGS", body.data.kind, { url });
    return reply.send({ saved: true, url, site });
  });

  app.get("/admin/integrations", { preHandler: requireAdminRoles([...FULL_ADMIN]) }, async (_request, reply) => {
    const rows = await prisma.$queryRawUnsafe<Array<{ provider: string; enabled: boolean; config: unknown; secretCiphertext: string | null; updatedAt: Date }>>(
      `SELECT "provider","enabled","config","secretCiphertext","updatedAt" FROM "AdminIntegration" ORDER BY "provider" ASC`,
    );
    const byProvider = new Map(rows.map(row => [row.provider, row]));
    return reply.send({ integrations: PROVIDERS.map(provider => {
      const row = byProvider.get(provider);
      const secrets = row ? decryptSecrets(row.secretCiphertext) : {};
      return { provider, enabled: row?.enabled ?? false, config: (row?.config && typeof row.config === "object" ? row.config : {}) as Record<string, unknown>, configuredSecretKeys: Object.keys(secrets).filter(key => Boolean(secrets[key])), updatedAt: row?.updatedAt ?? null };
    }) });
  });

  app.put("/admin/integrations/:provider", { preHandler: requireAdminRoles([...INTEGRATION_ADMIN]) }, async (request, reply) => {
    const params = z.object({ provider: providerSchema }).safeParse(request.params);
    const body = updateIntegrationSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_integration_settings" });
    const existing = await getRuntimeIntegration(params.data.provider);
    const cleanedSecrets = Object.fromEntries(Object.entries(body.data.secrets).filter(([, value]) => value.trim().length > 0).map(([key, value]) => [key, value.trim()]));
    const mergedSecrets = { ...(existing?.secrets ?? {}), ...cleanedSecrets };
    const cipher = Object.keys(mergedSecrets).length ? encryptSecrets(mergedSecrets) : null;
    const actor = await currentAdminId(request);
    await prisma.$executeRawUnsafe(
      `INSERT INTO "AdminIntegration" ("provider","enabled","config","secretCiphertext","updatedByUserId","updatedAt") VALUES ($1,$2,$3::jsonb,$4,$5,CURRENT_TIMESTAMP)
       ON CONFLICT ("provider") DO UPDATE SET "enabled"=EXCLUDED."enabled","config"=EXCLUDED."config","secretCiphertext"=EXCLUDED."secretCiphertext","updatedByUserId"=EXCLUDED."updatedByUserId","updatedAt"=CURRENT_TIMESTAMP`,
      params.data.provider, body.data.enabled, JSON.stringify(body.data.config), cipher, actor,
    );
    runtimeCache.delete(params.data.provider);
    await audit(actor, "INTEGRATION_UPDATED", "INTEGRATION", params.data.provider, { enabled: body.data.enabled, configKeys: Object.keys(body.data.config), secretKeysUpdated: Object.keys(cleanedSecrets) });
    return reply.send({ saved: true, provider: params.data.provider, enabled: body.data.enabled, config: body.data.config, configuredSecretKeys: Object.keys(mergedSecrets) });
  });

  app.get("/admin/integrations/hbx-hotels/mtls/status", { preHandler: requireAdminRoles([...INTEGRATION_ADMIN]) }, async (_request, reply) => {
    const baseDir="/var/www/petitannonces/shared/hbx-mtls";
    const csrPath=baseDir+"/hbx-client.csr",certPath=baseDir+"/hbx-client.crt",keyPath=baseDir+"/hbx-client.key";
    const [csr,key,cert]=await Promise.all([readFile(csrPath,"utf8").catch(()=>null),readFile(keyPath).then(()=>true).catch(()=>false),readFile(certPath,"utf8").catch(()=>null)]);
    let certificate:Record<string,string>|null=null;
    if(cert){
      try{const {stdout}=await execFileAsync("openssl",["x509","-in",certPath,"-noout","-subject","-issuer","-enddate","-serial"],{timeout:5000,maxBuffer:64*1024});certificate={summary:stdout.trim()}}catch{certificate={summary:"invalid"}}
    }
    return reply.send({csrReady:Boolean(csr),privateKeyReady:key,certificateReady:Boolean(cert),certificate});
  });

  app.post("/admin/integrations/hbx-hotels/mtls/certificate", { preHandler: requireAdminRoles([...INTEGRATION_ADMIN]) }, async (request, reply) => {
    const parsed=z.object({certificatePem:z.string().min(100).max(30000)}).safeParse(request.body);
    if(!parsed.success)return reply.code(400).send({error:"invalid_certificate_payload"});
    const pem=parsed.data.certificatePem.trim()+"\n";
    if(!pem.includes("-----BEGIN CERTIFICATE-----")||!pem.includes("-----END CERTIFICATE-----"))return reply.code(422).send({error:"invalid_certificate_pem"});
    const baseDir="/var/www/petitannonces/shared/hbx-mtls";
    const certPath=baseDir+"/hbx-client.crt",tmpPath=baseDir+"/hbx-client.crt.tmp",keyPath=baseDir+"/hbx-client.key",passPath=baseDir+"/hbx-client.pass";
    try{
      await mkdir(baseDir,{recursive:true,mode:0o700});
      await Promise.all([readFile(keyPath),readFile(passPath)]);
      await writeFile(tmpPath,pem,{encoding:"utf8",mode:0o600});
      const [{stdout:certInfo},{stdout:certMod},{stdout:keyMod}]=await Promise.all([
        execFileAsync("openssl",["x509","-in",tmpPath,"-noout","-subject","-issuer","-enddate","-serial"],{timeout:5000,maxBuffer:64*1024}),
        execFileAsync("openssl",["x509","-in",tmpPath,"-noout","-modulus"],{timeout:5000,maxBuffer:64*1024}),
        execFileAsync("openssl",["rsa","-in",keyPath,"-passin","file:"+passPath,"-noout","-modulus"],{timeout:5000,maxBuffer:64*1024}),
      ]);
      if(certMod.trim()!==keyMod.trim()){await unlink(tmpPath).catch(()=>{});return reply.code(422).send({error:"certificate_private_key_mismatch"})}
      await rename(tmpPath,certPath);await chmod(certPath,0o600);
      await audit(await currentAdminId(request),"HBX_MTLS_CERTIFICATE_INSTALLED","INTEGRATION","hbx-hotels",{certificate:certInfo.trim().slice(0,600)});
      return reply.send({ok:true,certificate:certInfo.trim()});
    }catch(error){await unlink(tmpPath).catch(()=>{});return reply.code(422).send({error:"hbx_certificate_install_failed",detail:String(error instanceof Error?error.message:error).slice(0,220)})}
  });

  app.post("/admin/integrations/hbx-hotels/test", { preHandler: requireAdminRoles([...INTEGRATION_ADMIN]) }, async (_request, reply) => {
    const runtime=await getHbxHotelsRuntime();
    if(!runtime?.apiKey||!runtime.secret)return reply.code(409).send({error:"hbx_not_configured"});
    try{
      const response=await fetch(runtime.baseUrl+"/hotel-api/1.0/status",{headers:{"Api-key":runtime.apiKey,"X-Signature":hbxSignature(runtime.apiKey,runtime.secret),Accept:"application/json"}});
      const raw=await response.text();
      let payload:unknown=null;try{payload=raw?JSON.parse(raw):null}catch{payload=raw.slice(0,500)}
      if(!response.ok)return reply.code(502).send({error:"hbx_connection_failed",status:response.status,environment:runtime.environment,detail:typeof payload==="string"?payload.slice(0,220):payload});
      return reply.send({ok:true,environment:runtime.environment,status:response.status,provider:"hbx-hotels"});
    }catch(error){
      return reply.code(502).send({error:"hbx_connection_failed",environment:runtime.environment,detail:String(error instanceof Error?error.message:error).slice(0,220)});
    }
  });

  app.post("/admin/integrations/paypal-checkout/test", { preHandler: requireAdminRoles([...INTEGRATION_ADMIN]) }, async (_request, reply) => {
    const configured=await getRuntimeIntegration("paypal-checkout");
    if(!configured?.enabled)return reply.code(409).send({error:"paypal_not_configured"});
    const mode=String(configured.config.mode??"sandbox").toLowerCase()==="live"?"live":"sandbox";
    const clientId=String(configured.secrets.clientId??"").trim();
    const clientSecret=String(configured.secrets.clientSecret??"").trim();
    if(!clientId||!clientSecret)return reply.code(409).send({error:"paypal_credentials_missing"});
    try{
      const base=mode==="live"?"https://api-m.paypal.com":"https://api-m.sandbox.paypal.com";
      const auth=Buffer.from(`${clientId}:${clientSecret}`,"utf8").toString("base64");
      const response=await fetch(`${base}/v1/oauth2/token`,{method:"POST",headers:{authorization:`Basic ${auth}`,"content-type":"application/x-www-form-urlencoded","accept":"application/json"},body:"grant_type=client_credentials"});
      if(!response.ok)return reply.code(502).send({error:"paypal_connection_failed",status:response.status});
      const payload=await response.json().catch(()=>({})) as Record<string,unknown>;
      if(!String(payload.access_token??""))return reply.code(502).send({error:"paypal_token_missing"});
      return reply.send({ok:true,mode});
    }catch{return reply.code(502).send({error:"paypal_connection_failed"})}
  });

  app.post("/admin/integrations/twilio-verify/test", { preHandler: requireAdminRoles([...INTEGRATION_ADMIN]) }, async (_request, reply) => {
    const runtime=resolveTwilioVerifyIntegration(await getRuntimeIntegration("twilio-verify"));
    if(!runtime?.serviceSid||!runtime.username||!runtime.password)return reply.code(409).send({error:"twilio_verify_not_configured"});
    try{
      const auth=Buffer.from(`${runtime.username}:${runtime.password}`,"utf8").toString("base64");
      const response=await fetch(`https://verify.twilio.com/v2/Services/${encodeURIComponent(runtime.serviceSid)}`,{headers:{authorization:`Basic ${auth}`}});
      const payload=await response.json().catch(()=>({})) as Record<string,unknown>;
      if(!response.ok)return reply.code(502).send({error:"twilio_verify_connection_failed",status:response.status});
      return reply.send({ok:true,service:{sid:payload.sid,friendlyName:payload.friendly_name,codeLength:payload.code_length,lookupEnabled:payload.lookup_enabled,doForceCheckOnce:payload.do_force_check_once,ttl:payload.ttl}});
    }catch{return reply.code(502).send({error:"twilio_verify_connection_failed"})}
  });

  app.post("/admin/integrations/twilio-verify/setup-service", { preHandler: requireAdminRoles([...INTEGRATION_ADMIN]) }, async (request, reply) => {
    const configured=await getRuntimeIntegration("twilio-verify");
    const runtime=resolveTwilioVerifyIntegration(configured);
    if(!configured?.enabled||!runtime?.username||!runtime.password)return reply.code(409).send({error:"twilio_verify_credentials_missing"});
    if(runtime.serviceSid)return reply.send({ok:true,existing:true,serviceSid:runtime.serviceSid});
    try{
      const auth=Buffer.from(`${runtime.username}:${runtime.password}`,"utf8").toString("base64");
      const rawFriendly=String(configured.config.friendlyName??"Petit Annonces Verification");
      const friendlyName=rawFriendly.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^A-Za-z0-9 _-]+/g," ").replace(/\s+/g," ").trim().slice(0,32)||"Petit Annonces";
      const params=new URLSearchParams();
      params.set("FriendlyName",friendlyName);
      params.set("CodeLength","6");
      params.set("LookupEnabled","true");
      params.set("SkipSmsToLandlines","true");
      const response=await fetch("https://verify.twilio.com/v2/Services",{method:"POST",headers:{authorization:`Basic ${auth}`,"content-type":"application/x-www-form-urlencoded"},body:params.toString()});
      const payload=await response.json().catch(()=>({})) as Record<string,unknown>;
      if(!response.ok)return reply.code(502).send({error:"twilio_verify_service_create_failed",status:response.status,twilioCode:payload.code??null,detail:String(payload.message??"Twilio Verify service creation failed").slice(0,220)});
      const serviceSid=String(payload.sid??"");if(!serviceSid.startsWith("VA"))return reply.code(502).send({error:"twilio_verify_service_sid_missing"});
      const actor=await currentAdminId(request);const mergedConfig={...(configured.config??{}),friendlyName,serviceSid};
      await prisma.$executeRawUnsafe(`UPDATE "AdminIntegration" SET "config"=$1::jsonb,"updatedByUserId"=$2,"updatedAt"=CURRENT_TIMESTAMP WHERE "provider"=$3`,JSON.stringify(mergedConfig),actor,"twilio-verify");
      runtimeCache.delete("twilio-verify");
      await audit(actor,"TWILIO_VERIFY_SERVICE_CONFIGURED","INTEGRATION","twilio-verify",{serviceSid,codeLength:6,lookupEnabled:true,skipSmsToLandlines:true});
      return reply.send({ok:true,existing:false,serviceSid,service:{friendlyName:payload.friendly_name,codeLength:payload.code_length,lookupEnabled:payload.lookup_enabled,skipSmsToLandlines:payload.skip_sms_to_landlines}});
    }catch(error){return reply.code(502).send({error:"twilio_verify_service_create_failed",detail:String(error instanceof Error?error.message:error).slice(0,220)})}
  });



  app.post("/admin/integrations/marketplace-payment/test", { preHandler: requireAdminRoles([...INTEGRATION_ADMIN]) }, async (_request, reply) => {
    const runtime=await getMangopayRuntime();
    if(!runtime?.clientId||!runtime.apiKey)return reply.code(409).send({error:"mangopay_not_configured"});
    try{
      const auth=await getMangopayAccessToken();
      const hooks=await mangopayApi(`/v2.01/${encodeURIComponent(auth.runtime.clientId)}/hooks`);
      return reply.send({ok:true,provider:"mangopay",environment:auth.runtime.environment,clientIdConfigured:true,authentication:true,developerScope:hooks.response.ok,webhookConfigured:Boolean(auth.runtime.webhookToken)});
    }catch(error){return reply.code(502).send({error:"mangopay_connection_failed",detail:String(error instanceof Error?error.message:error).slice(0,160)})}
  });

  app.post("/admin/integrations/marketplace-payment/setup-webhooks", { preHandler: requireAdminRoles([...INTEGRATION_ADMIN]) }, async (request, reply) => {
    try{const result=await ensureMangopayWebhooks(await currentAdminId(request));return reply.send({ok:true,provider:"mangopay",...result})}
    catch(error){const detail=String(error instanceof Error?error.message:error).slice(0,180);return reply.code(detail==="mangopay_not_configured"?409:502).send({error:detail==="mangopay_not_configured"?"mangopay_not_configured":"mangopay_webhook_setup_failed",detail})}
  });

  app.post("/admin/integrations/stripe-billing/test", { preHandler: requireAdminRoles([...INTEGRATION_ADMIN]) }, async (_request, reply) => {
    const configured = await getRuntimeIntegration("stripe-billing");
    const stripe = resolveStripeBillingIntegration(configured);
    if (!stripe?.apiKey) return reply.code(409).send({ error:"stripe_not_configured", mode:stripe?.mode??null });
    try {
      const response = await fetch("https://api.stripe.com/v1/account", { headers:{ authorization:`Bearer ${stripe.apiKey}` } });
      const payload = await response.json().catch(()=>({})) as Record<string,unknown>;
      if (!response.ok) return reply.code(502).send({ error:"stripe_connection_failed", stripeStatus:response.status, mode:stripe.mode });
      return reply.send({ ok:true, mode:stripe.mode, account:{ id:payload.id, country:payload.country, defaultCurrency:payload.default_currency, chargesEnabled:payload.charges_enabled, payoutsEnabled:payload.payouts_enabled }, webhook:{ signatureConfigured:Boolean(stripe.webhookSecret), tokenConfigured:Boolean(stripe.webhookToken), endpointId:stripe.endpointId||null } });
    } catch {
      return reply.code(502).send({ error:"stripe_connection_failed" });
    }
  });

  app.post("/admin/integrations/stripe-billing/smoke-test", { preHandler: requireAdminRoles([...INTEGRATION_ADMIN]) }, async (_request, reply) => {
    let stripe=await getStripeBillingModeRuntime("test");
    if(!stripe?.apiKey||!stripe.apiKey.startsWith("sk_test_"))return reply.code(409).send({error:"stripe_test_not_configured"});
    if(!stripe.webhookSecret||!stripe.webhookToken){
      try{await ensureStripeWebhook("test",await currentAdminId(_request));stripe=await getStripeBillingModeRuntime("test");}
      catch(error){return reply.code(502).send({error:"stripe_test_webhook_setup_failed",detail:String(error instanceof Error?error.message:error).slice(0,240)})}
    }
    if(!stripe?.webhookSecret||!stripe.webhookToken)return reply.code(409).send({error:"stripe_test_webhook_not_configured"});
    const suffix=randomUUID().replace(/-/g,"");
    const stripePost=async(path:string,params:URLSearchParams,idempotencyKey:string)=>{
      const response=await fetch(`https://api.stripe.com${path}`,{method:"POST",headers:{authorization:`Bearer ${stripe.apiKey}`,"content-type":"application/x-www-form-urlencoded","idempotency-key":idempotencyKey},body:params.toString()});
      const payload=await response.json().catch(()=>({})) as Record<string,unknown>;
      if(!response.ok)throw new Error(`stripe_smoke_${response.status}_${String((payload.error as any)?.type??"error")}`);
      return payload;
    };
    try{
      const checkoutParams=new URLSearchParams();checkoutParams.set("mode","payment");checkoutParams.set("success_url","https://admin.petitannonces.fr/integrations?stripeSmoke=success");checkoutParams.set("cancel_url","https://admin.petitannonces.fr/integrations?stripeSmoke=cancel");checkoutParams.set("line_items[0][quantity]","1");checkoutParams.set("line_items[0][price_data][currency]","eur");checkoutParams.set("line_items[0][price_data][unit_amount]","100");checkoutParams.set("line_items[0][price_data][product_data][name]","Petit Annonces · Test Stripe");checkoutParams.set("metadata[pa_admin_smoke]","true");
      const checkout=await stripePost("/v1/checkout/sessions",checkoutParams,`pa-smoke-checkout-${suffix}`);const checkoutId=String(checkout.id??"");if(!checkoutId.startsWith("cs_test_"))throw new Error("stripe_smoke_checkout_invalid");
      const expired=await stripePost(`/v1/checkout/sessions/${encodeURIComponent(checkoutId)}/expire`,new URLSearchParams(),`pa-smoke-expire-${suffix}`);
      const paymentParams=new URLSearchParams();paymentParams.set("amount","100");paymentParams.set("currency","eur");paymentParams.set("payment_method","pm_card_visa");paymentParams.set("confirm","true");paymentParams.append("payment_method_types[]","card");paymentParams.set("metadata[pa_admin_smoke]","true");
      const payment=await stripePost("/v1/payment_intents",paymentParams,`pa-smoke-payment-${suffix}`);const paymentId=String(payment.id??"");if(!paymentId.startsWith("pi_")||String(payment.status??"")!=="succeeded")throw new Error("stripe_smoke_payment_not_succeeded");
      const refundParams=new URLSearchParams();refundParams.set("payment_intent",paymentId);refundParams.set("reason","requested_by_customer");const refund=await stripePost("/v1/refunds",refundParams,`pa-smoke-refund-${suffix}`);if(!String(refund.id??"").startsWith("re_"))throw new Error("stripe_smoke_refund_invalid");
      const eventId=`evt_pa_smoke_${suffix}`;const raw=JSON.stringify({id:eventId,type:"payment_intent.succeeded",data:{object:{id:paymentId,metadata:{pa_admin_smoke:"true"}}}});const timestamp=Math.floor(Date.now()/1000);const signature=createHmac("sha256",stripe.webhookSecret).update(`${timestamp}.${raw}`).digest("hex");
      const webhookResponse=await fetch(`https://petitannonces.fr/api/billing/stripe/test-webhook/${encodeURIComponent(stripe.webhookToken)}`,{method:"POST",headers:{"content-type":"application/json","stripe-signature":`t=${timestamp},v1=${signature}`},body:raw});
      if(!webhookResponse.ok)throw new Error(`stripe_smoke_webhook_${webhookResponse.status}`);
      await audit(await currentAdminId(_request),"STRIPE_TEST_SMOKE_COMPLETED","INTEGRATION","stripe-billing",{checkoutId,paymentId,refundId:String(refund.id??""),refundStatus:String(refund.status??""),webhookEventId:eventId});
      return reply.send({ok:true,mode:"test",checkout:{id:checkoutId,status:String(expired.status??"expired")},payment:{id:paymentId,status:String(payment.status??"")},refund:{id:String(refund.id??""),status:String(refund.status??"")},webhook:{delivered:true,eventId}});
    }catch(error){return reply.code(502).send({error:"stripe_test_smoke_failed",detail:String(error instanceof Error?error.message:error).slice(0,240)})}
  });

  app.post("/admin/integrations/stripe-billing/setup-webhook", { preHandler: requireAdminRoles([...INTEGRATION_ADMIN]) }, async (request, reply) => {
    const configured = await getRuntimeIntegration("stripe-billing");
    const stripe = resolveStripeBillingIntegration(configured);
    if (!configured?.enabled || !stripe?.apiKey) return reply.code(409).send({ error:"stripe_not_configured", mode:stripe?.mode??null });
    if (stripe.endpointId && stripe.webhookSecret && stripe.webhookToken) return reply.send({ ok:true, existing:true, mode:stripe.mode, endpointId:stripe.endpointId });
    const token=randomBytes(24).toString("base64url");
    const endpointUrl=stripe.mode==="test"?`https://petitannonces.fr/api/billing/stripe/test-webhook/${token}`:`https://petitannonces.fr/api/billing/stripe/webhook/${token}`;
    const events=["checkout.session.completed","checkout.session.expired","checkout.session.async_payment_succeeded","checkout.session.async_payment_failed","payment_intent.payment_failed","refund.updated","customer.subscription.created","customer.subscription.updated","customer.subscription.deleted","invoice.paid","invoice.payment_failed","transfer.created","transfer.reversed"];
    const params=new URLSearchParams();params.set("url",endpointUrl);params.set("description",`Petit Annonces · ${stripe.mode.toUpperCase()} · paiements et abonnements`);for(const event of events)params.append("enabled_events[]",event);
    try{
      const response=await fetch("https://api.stripe.com/v1/webhook_endpoints",{method:"POST",headers:{authorization:`Bearer ${stripe.apiKey}`,"content-type":"application/x-www-form-urlencoded"},body:params.toString()});
      const payload=await response.json().catch(()=>({})) as Record<string,unknown>;
      if(!response.ok)return reply.code(502).send({error:"stripe_webhook_setup_failed",stripeStatus:response.status,stripeType:(payload.error as any)?.type??null});
      const endpointId=typeof payload.id==="string"?payload.id:"";const secret=typeof payload.secret==="string"?payload.secret:"";
      if(!endpointId||!secret)return reply.code(502).send({error:"stripe_webhook_secret_missing"});
      const mergedSecrets={...(configured?.secrets??{})};const mergedConfig={...(configured?.config??{})};
      if(stripe.mode==="test"){mergedSecrets.testWebhookToken=token;mergedSecrets.testWebhookSecret=secret;mergedConfig.testWebhookEndpointId=endpointId}else{mergedSecrets.webhookToken=token;mergedSecrets.webhookSecret=secret;mergedConfig.webhookEndpointId=endpointId}
      const cipher=encryptSecrets(mergedSecrets);const actor=await currentAdminId(request);
      await prisma.$executeRawUnsafe(`UPDATE "AdminIntegration" SET "config"=$1::jsonb,"secretCiphertext"=$2,"updatedByUserId"=$3,"updatedAt"=CURRENT_TIMESTAMP WHERE "provider"='stripe-billing'`,JSON.stringify(mergedConfig),cipher,actor);
      runtimeCache.delete("stripe-billing");await audit(actor,"STRIPE_WEBHOOK_CONFIGURED","INTEGRATION","stripe-billing",{endpointId,events,mode:stripe.mode});
      return reply.send({ok:true,existing:false,mode:stripe.mode,endpointId,events:events.length});
    }catch{return reply.code(502).send({error:"stripe_webhook_setup_failed",mode:stripe.mode})}
  });
}
