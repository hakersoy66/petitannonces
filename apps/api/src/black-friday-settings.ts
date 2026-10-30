import {prisma} from "@pa/database";
import {z} from "zod";

// Single, versioned campaign configuration. Reused every year from the admin dashboard.
// No financial decision uses an in-process cache.
export const blackFridaySettingsSchema=z.object({
  enabled:z.boolean(),
  edition:z.number().int().min(2026).max(2100),
  startsAt:z.string().datetime({offset:true}),
  endsAt:z.string().datetime({offset:true}),
  discountPercent:z.number().int().min(0).max(90),
  giftMonthsMultiplier:z.number().int().min(0).max(3),
  maxPrepaidMonths:z.number().int().min(1).max(24),
  promotionCodes:z.array(z.string().regex(/^[A-Z0-9_-]{2,60}$/)).min(1).max(40),
});
export type BlackFridaySettings=z.infer<typeof blackFridaySettingsSchema>;
export const defaultBlackFridaySettings:BlackFridaySettings={
  enabled:true,edition:2026,
  startsAt:"2026-11-19T23:00:00.000Z",
  endsAt:"2026-11-30T23:00:00.000Z",
  discountPercent:50,giftMonthsMultiplier:1,maxPrepaidMonths:12,
  promotionCodes:["BUMP_NOW","URGENT_7D","GALLERY_7D","FEATURED_7D","SPONSORED_7D"],
};
export function blackFridaySettingsValid(s:BlackFridaySettings){
  const start=Date.parse(s.startsAt),end=Date.parse(s.endsAt);
  return Number.isFinite(start)&&Number.isFinite(end)&&end>start&&end-start<=45*86400_000&&new Date(start).getUTCFullYear()===s.edition;
}
export async function getBlackFridaySettings():Promise<BlackFridaySettings>{
  const rows=await prisma.$queryRawUnsafe<Array<{value:unknown}>>(
    'SELECT "value" FROM "AdminSetting" WHERE "key"=$1 LIMIT 1',"campaign.black-friday"
  );
  const parsed=blackFridaySettingsSchema.safeParse(rows[0]?.value??defaultBlackFridaySettings);
  return parsed.success&&blackFridaySettingsValid(parsed.data)?parsed.data:defaultBlackFridaySettings;
}
export function blackFridayPhase(s:BlackFridaySettings,now=Date.now()){
  if(!s.enabled)return "disabled" as const;
  if(now<Date.parse(s.startsAt))return "upcoming" as const;
  if(now>=Date.parse(s.endsAt))return "ended" as const;
  return "active" as const;
}
export function blackFridayDiscount(product:{code:string;currency:string;priceMinor:number},s:BlackFridaySettings,now=Date.now()){
  if(blackFridayPhase(s,now)!=="active"||!s.promotionCodes.includes(product.code)||
      product.currency.toUpperCase()!=="EUR"||!Number.isSafeInteger(product.priceMinor)||
      product.priceMinor<1)return 0;
  return Math.max(0,product.priceMinor-Math.floor(product.priceMinor*(100-s.discountPercent)/100));
}
export function blackFridayPublic(s:BlackFridaySettings){
  const phase=blackFridayPhase(s);
  return {campaign:"BLACK_FRIDAY",...s,phase,active:phase==="active",visible:s.enabled&&phase!=="ended"};
}
