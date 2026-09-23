export type ListingPromotionType="URGENT"|"FEATURED"|"BUMP"|"SPONSORED"|"GALLERY";
export type ListingPromotion={code:string;type:ListingPromotionType|string;name:string;endsAt?:string|null};

export function promotionLabel(type:string){
  if(type==="URGENT")return"Urgent";
  if(type==="FEATURED")return"À la une";
  if(type==="BUMP")return"Remontée";
  if(type==="SPONSORED")return"Sponsorisé";
  if(type==="GALLERY")return"Galerie";
  return"Boosté";
}
export function promotionClass(type:string){return `promotion-${type.toLowerCase().replace(/[^a-z0-9_-]/g,"")}`;}
export function hasPromotion(item:{promotions?:ListingPromotion[]},type:ListingPromotionType){return item.promotions?.some(p=>p.type===type)===true;}
export type PromotedFlowItem<T>={item:T;spotlight:"URGENT"|"FEATURED"|null};
export function arrangePromotedFlow<T extends {id:string;promotions?:ListingPromotion[]}>(items:T[]):PromotedFlowItem<T>[] {
  return items.map(item=>({item,spotlight:hasPromotion(item,"URGENT")?"URGENT":hasPromotion(item,"FEATURED")||hasPromotion(item,"SPONSORED")||hasPromotion(item,"BUMP")?"FEATURED":null}));
}
