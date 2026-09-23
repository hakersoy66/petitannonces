import { prisma } from "@pa/database";

type Row={orderNumber:string;status:string;paymentStatus:string|null;shipmentStatus:string|null;protectionEndsAt:Date|null;payoutEligibleAt:Date|null;payoutStatus:string|null;activeDispute:boolean;activeRefund:boolean;activeReturn:boolean;sellerPaymentReady:boolean};

const rows=await prisma.$queryRawUnsafe<Row[]>(`SELECT o."orderNumber",o."status"::text AS "status",p."status"::text AS "paymentStatus",s."status"::text AS "shipmentStatus",bp."endsAt" AS "protectionEndsAt",bp."payoutEligibleAt",po."status"::text AS "payoutStatus",EXISTS(SELECT 1 FROM "MarketplaceDispute" d WHERE d."orderId"=o."id" AND d."status" NOT IN ('RESOLVED_BUYER','RESOLVED_SELLER','CLOSED')) AS "activeDispute",EXISTS(SELECT 1 FROM "MarketplaceRefund" r WHERE r."orderId"=o."id" AND r."status" IN ('PENDING','PROCESSING')) AS "activeRefund",EXISTS(SELECT 1 FROM "MarketplaceReturnRequest" rr WHERE rr."orderId"=o."id" AND rr."status" IN ('OPEN','APPROVED','PROCESSING')) AS "activeReturn",EXISTS(SELECT 1 FROM "MarketplaceSellerAccount" msa WHERE msa."userId"=o."sellerId" AND msa."onboardingStatus"='ACTIVE' AND msa."payoutsEnabled"=TRUE AND msa."detailsSubmitted"=TRUE) AS "sellerPaymentReady" FROM "MarketplaceOrder" o LEFT JOIN LATERAL(SELECT "status" FROM "MarketplacePayment" WHERE "orderId"=o."id" ORDER BY "createdAt" DESC LIMIT 1)p ON TRUE LEFT JOIN "MarketplaceShipment" s ON s."orderId"=o."id" LEFT JOIN "BuyerProtectionWindow" bp ON bp."orderId"=o."id" LEFT JOIN "MarketplacePayout" po ON po."orderId"=o."id" ORDER BY o."createdAt" DESC LIMIT 500`);

const findings:Array<{order:string;issues:string[]}>=[];
for(const r of rows){
  const issues:string[]=[];
  if(["PAID","PROCESSING","SHIPPED","DELIVERED","COMPLETED"].includes(r.status)&&!["CAPTURED","PARTIALLY_REFUNDED","REFUNDED"].includes(String(r.paymentStatus)))issues.push("ORDER_PAYMENT_MISMATCH");
  if(["SHIPPED","DELIVERED","COMPLETED"].includes(r.status)&&!r.shipmentStatus)issues.push("SHIPMENT_MISSING");
  if(["DELIVERED","COMPLETED"].includes(r.status)&&!r.protectionEndsAt)issues.push("PROTECTION_WINDOW_MISSING");
  if(r.payoutStatus==="PAID"&&(r.activeDispute||r.activeRefund||r.activeReturn))issues.push("PAID_WHILE_BLOCKED");
  if(r.status==="COMPLETED"&&r.payoutEligibleAt&&!r.sellerPaymentReady&&r.payoutStatus==="PAID")issues.push("PAID_WITHOUT_SELLER_READINESS");
  if(issues.length)findings.push({order:r.orderNumber,issues});
}
console.log(JSON.stringify({mode:"read-only",checked:rows.length,findings:findings.length,orders:findings},null,2));
await prisma.$disconnect();
if(findings.length>0)process.exitCode=2;
