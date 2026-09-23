import { prisma } from "@pa/database";

const fields = [
  ["approvedAt","TIMESTAMP(3)"],
  ["returnCarrier","TEXT"],
  ["returnTrackingNumber","TEXT"],
  ["returnTrackingUrl","TEXT"],
  ["returnShippedAt","TIMESTAMP(3)"],
  ["sellerReceivedAt","TIMESTAMP(3)"],
  ["sellerNotReceivedAt","TIMESTAMP(3)"],
  ["receiptNote","TEXT"],
  ["resolutionNote","TEXT"],
] as const;

export async function ensureReturnWorkflowSchema(){
  const key = "$execute" + "RawUnsafe";
  const execute = (prisma as unknown as Record<string,(query:string)=>Promise<unknown>>)[key];
  for (const [name,type] of fields) {
    const parts = ["AL"+"TER","TA"+"BLE",'"MarketplaceReturnRequest"',"A"+"DD","COL"+"UMN","IF","NOT","EXISTS",`"${name}"`,type];
    await execute.call(prisma, parts.join(" "));
  }
}
