import { prisma } from "@pa/database";
import { getRuntimeIntegration, getMangopayRuntime } from "./admin-control.js";
import { refreshStripeSellerAccount, stripeMarketplaceConfigured, transferMarketplacePayout } from "./marketplace-stripe.js";
import { ensureMangopayMarketplaceSchema } from "./marketplace-mangopay.js";

export type PayoutProviderRuntime={
  provider:"mangopay"|"stripe-connect"|"mock"|"unconfigured";
  configured:boolean;
  operational:boolean;
  environment:"sandbox"|"production"|null;
  adapterReady:boolean;
};

export async function getPayoutProviderRuntime():Promise<PayoutProviderRuntime>{
  const configured=await getRuntimeIntegration("marketplace-payment");
  if(!configured?.enabled)return{provider:"unconfigured",configured:false,operational:false,environment:null,adapterReady:false};
  const provider=String(configured.config.provider??"").toLowerCase();
  if(provider==="mangopay"){
    const mg=await getMangopayRuntime();
    const ready=Boolean(mg?.clientId&&mg.apiKey);
    return{provider:"mangopay",configured:ready,operational:false,environment:mg?.environment??"sandbox",adapterReady:false};
  }
  if(provider==="stripe-connect"){
    const ready=await stripeMarketplaceConfigured();
    return{provider:"stripe-connect",configured:ready,operational:ready,environment:"production",adapterReady:true};
  }
  if(provider==="mock"){
    const sandbox=String(configured.config.environment??"sandbox").toLowerCase()!=="production";
    const allowed=Boolean(configured.config.allowMockPayouts===true)&&sandbox&&process.env.NODE_ENV!=="production";
    return{provider:"mock",configured:allowed,operational:allowed,environment:"sandbox",adapterReady:allowed};
  }
  return{provider:"unconfigured",configured:false,operational:false,environment:null,adapterReady:false};
}

type MangopayProfile={providerUserId:string|null;providerRecipientId:string|null;kycLevel:string;recipientStatus:string;payoutsEnabled:boolean;bankLast4:string|null;bankName:string|null;userStatus:string};

export async function getSellerPayoutReadiness(userId:string){
  const runtime=await getPayoutProviderRuntime();
  if(runtime.provider==="mangopay"){
    await ensureMangopayMarketplaceSchema();
    const rows=await prisma.$queryRawUnsafe<MangopayProfile[]>(`SELECT "providerUserId","providerRecipientId","kycLevel","recipientStatus","payoutsEnabled","bankLast4","bankName","userStatus" FROM "MarketplaceSellerPayoutProfile" WHERE "userId"=$1 LIMIT 1`,userId);
    const p=rows[0]??null;
    let reason:string|null=null;
    if(!p?.providerUserId)reason="SELLER_PROFILE_REQUIRED";
    else if(p.userStatus!=="ACTIVE")reason="USER_VERIFICATION_REQUIRED";
    else if(p.kycLevel!=="REGULAR")reason="KYC_REQUIRED";
    else if(!p.providerRecipientId||p.recipientStatus!=="ACTIVE")reason="IBAN_REQUIRED";
    else if(!p.payoutsEnabled)reason="VERIFICATION_PENDING";
    const sellerReady=Boolean(p&&!reason);
    return{sellerReady,reason,provider:runtime.provider,providerConfigured:runtime.configured,providerOperational:runtime.operational,adapterReady:runtime.adapterReady,environment:runtime.environment,profile:p};
  }
  if(runtime.provider==="stripe-connect"){
    try{await refreshStripeSellerAccount(userId)}catch{}
    const rows=await prisma.$queryRawUnsafe<Array<{onboardingStatus:string;payoutsEnabled:boolean;detailsSubmitted:boolean}>>(`SELECT "onboardingStatus","payoutsEnabled","detailsSubmitted" FROM "MarketplaceSellerAccount" WHERE "userId"=$1 LIMIT 1`,userId);
    const p=rows[0]??null;
    let reason:string|null=null;
    if(!p)reason="IBAN_REQUIRED";
    else if(!p.detailsSubmitted)reason="KYC_REQUIRED";
    else if(!p.payoutsEnabled)reason="BANK_ACCOUNT_OR_VERIFICATION_REQUIRED";
    else if(p.onboardingStatus!=="ACTIVE")reason="VERIFICATION_PENDING";
    const sellerReady=Boolean(p&&!reason);
    return{sellerReady,reason,provider:runtime.provider,providerConfigured:runtime.configured,providerOperational:runtime.operational,adapterReady:runtime.adapterReady,environment:runtime.environment,profile:p};
  }
  return{sellerReady:false,reason:"PROVIDER_PENDING",provider:runtime.provider,providerConfigured:false,providerOperational:false,adapterReady:false,environment:runtime.environment,profile:null};
}

export async function executeSellerPayout(input:{sellerId:string;orderId:string;amountMinor:number;currency:string;idempotencyKey:string}){
  const runtime=await getPayoutProviderRuntime();
  if(runtime.provider==="stripe-connect"&&runtime.operational){
    const result=await transferMarketplacePayout(input);return{provider:runtime.provider,id:result.id,status:"processing"};
  }
  if(runtime.provider==="mock"&&runtime.operational)return{provider:"mock",id:`mock_${input.orderId}`,status:"processing"};
  if(runtime.provider==="mangopay")throw new Error(runtime.configured?"mangopay_payout_adapter_pending":"payout_provider_not_configured");
  throw new Error("payout_provider_not_configured");
}

