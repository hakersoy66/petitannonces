import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdminRoles } from "./rbac.js";
import { marketplaceQuote, type CommissionPayer } from "./marketplace-fees.js";

export type MarketplaceSimulationScenario="HAPPY_PATH"|"PAYMENT_FAILED"|"BUYER_DISPUTE"|"RETURN_REFUND"|"SELLER_VERIFICATION_MISSING"|"PROVIDER_PENDING";
type Step={at:string;orderStatus:string;paymentStatus:string;shipmentStatus:string|null;protectionStatus:string|null;payoutStatus:string|null;label:string;detail:string};

function addHours(date:Date,hours:number){return new Date(date.getTime()+hours*60*60*1000)}
function addDays(date:Date,days:number){return new Date(date.getTime()+days*24*60*60*1000)}
export function simulateMarketplaceFlow(input:{scenario:MarketplaceSimulationScenario;itemAmountMinor:number;shippingAmountMinor:number;commissionPayer?:CommissionPayer;startAt?:Date}){
 const start=input.startAt??new Date("2026-09-07T10:00:00.000Z");const deliveredAt=addDays(start,3);const protectionEndsAt=addHours(deliveredAt,48);const payoutEligibleAt=addDays(deliveredAt,21);const q=marketplaceQuote(input.itemAmountMinor,input.shippingAmountMinor,input.commissionPayer??"SELLER");const steps:Step[]=[];
 const push=(at:Date,orderStatus:string,paymentStatus:string,shipmentStatus:string|null,protectionStatus:string|null,payoutStatus:string|null,label:string,detail:string)=>steps.push({at:at.toISOString(),orderStatus,paymentStatus,shipmentStatus,protectionStatus,payoutStatus,label,detail});
 push(start,"PENDING_PAYMENT","CREATED",null,null,null,"Commande créée",`Total acheteur ${q.totalAmountMinor} centimes; net vendeur ${q.sellerNetMinor} centimes.`);
 if(input.scenario==="PAYMENT_FAILED"){push(addHours(start,0.1),"CANCELED","FAILED",null,null,null,"Paiement refusé","Aucune expédition, protection ou payout n'est créé.");return result()}
 const paidAt=addHours(start,0.1);push(paidAt,"PAID","CAPTURED",null,null,null,"Paiement confirmé","La commande peut être préparée pour expédition.");
 const labelAt=addHours(start,4);push(labelAt,"PROCESSING","CAPTURED","LABEL_CREATED",null,null,"Envoi préparé","Bordereau généré; le vendeur peut remettre le colis au transporteur.");
 const shippedAt=addDays(start,1);push(shippedAt,"SHIPPED","CAPTURED","IN_TRANSIT",null,null,"Colis expédié","Le suivi transporteur devient la source de vérité de livraison.");
 push(deliveredAt,"DELIVERED","CAPTURED","DELIVERED","WAITING",null,"Colis livré","Protection acheteur ouverte pour 48 h; la date de payout est fixée à livraison + 21 jours.");
 if(input.scenario==="BUYER_DISPUTE"){push(addHours(deliveredAt,6),"DISPUTED","CAPTURED","DELIVERED","WAITING","BLOCKED","Litige ouvert","Le payout vendeur est bloqué jusqu'à résolution du dossier.");return result()}
 if(input.scenario==="RETURN_REFUND"){push(addHours(deliveredAt,8),"DISPUTED","CAPTURED","DELIVERED","WAITING","BLOCKED","Retour autorisé","Le payout reste bloqué pendant le retour.");push(addDays(deliveredAt,5),"REFUNDED","REFUNDED","RETURNED","BUYER_CONFIRMED","CANCELED","Remboursement terminé","Le payout est annulé et la commande est remboursée.");return result()}
 push(protectionEndsAt,"COMPLETED","CAPTURED","DELIVERED","AUTO_CONFIRMED",null,"Protection terminée","La commande est terminée mais le payout reste interdit avant le 21e jour.");
 if(input.scenario==="SELLER_VERIFICATION_MISSING"){push(payoutEligibleAt,"COMPLETED","CAPTURED","DELIVERED","AUTO_CONFIRMED","BLOCKED","Vérification vendeur requise","KYC ou IBAN manque; aucun virement n'est envoyé.");return result()}
 if(input.scenario==="PROVIDER_PENDING"){push(payoutEligibleAt,"COMPLETED","CAPTURED","DELIVERED","AUTO_CONFIRMED","BLOCKED","Prestataire en attente","Le vendeur est prêt mais le provider payout n'est pas opérationnel; la transaction reste en file.");return result()}
 push(payoutEligibleAt,"COMPLETED","CAPTURED","DELIVERED","AUTO_CONFIRMED","PROCESSING","Payout déclenché","KYC, IBAN, absence de litige et provider opérationnel sont validés.");push(addHours(payoutEligibleAt,6),"COMPLETED","CAPTURED","DELIVERED","AUTO_CONFIRMED","PAID","Vendeur payé","Le provider confirme le versement.");return result();
 function result(){const payoutSteps=steps.filter(s=>s.payoutStatus==="PROCESSING"||s.payoutStatus==="PAID");const payoutBeforeEligible=payoutSteps.some(s=>new Date(s.at)<payoutEligibleAt);return{scenario:input.scenario,quote:q,dates:{deliveredAt:deliveredAt.toISOString(),protectionEndsAt:protectionEndsAt.toISOString(),payoutEligibleAt:payoutEligibleAt.toISOString()},checks:{buyerProtectionHours:(protectionEndsAt.getTime()-deliveredAt.getTime())/3600000,payoutDelayDays:(payoutEligibleAt.getTime()-deliveredAt.getTime())/86400000,noPayoutBeforeDay21:!payoutBeforeEligible,realProviderCalls:0,financialWrites:0},steps}}
}

export async function registerMarketplaceFlowSimulatorRoutes(app:FastifyInstance){
 const guard=requireAdminRoles(["SUPER_ADMIN","ADMIN","FINANCE"]);
 app.get("/admin/finance/marketplace-simulator",{preHandler:guard},async()=>({scenarios:["HAPPY_PATH","PAYMENT_FAILED","BUYER_DISPUTE","RETURN_REFUND","SELLER_VERIFICATION_MISSING","PROVIDER_PENDING"],safe:true,realProviderCalls:0,financialWrites:0}));
 app.post("/admin/finance/marketplace-simulator",{preHandler:guard},async(request,reply)=>{const parsed=z.object({scenario:z.enum(["HAPPY_PATH","PAYMENT_FAILED","BUYER_DISPUTE","RETURN_REFUND","SELLER_VERIFICATION_MISSING","PROVIDER_PENDING"]).default("HAPPY_PATH"),itemAmountMinor:z.number().int().min(100).max(10_000_000).default(10000),shippingAmountMinor:z.number().int().min(0).max(100000).default(499),commissionPayer:z.enum(["SELLER","BUYER"]).default("SELLER")}).safeParse(request.body??{});if(!parsed.success)return reply.code(400).send({error:"invalid_simulation",details:parsed.error.flatten()});return reply.send(simulateMarketplaceFlow(parsed.data));});
}
