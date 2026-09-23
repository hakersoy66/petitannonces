export type CompareSelection={
 id:string;slug:string|null;title:string|null;imageUrl:string|null;priceMinor:number|null;currency:string;city:string|null;
 category:{name:string;slug:string;domain:string};
};

export const COMPARE_STORAGE_KEY="pa_compare_listings_v1";
export const COMPARE_EVENT="pa:compare-changed";
export const COMPARE_LIMIT_EVENT="pa:compare-limit";
export const COMPARE_MAX=4;

export function readCompareSelections():CompareSelection[]{
 if(typeof window==="undefined")return[];
 try{
  const raw=JSON.parse(window.localStorage.getItem(COMPARE_STORAGE_KEY)??"[]") as unknown;
  if(!Array.isArray(raw))return[];
  return raw.filter((item):item is CompareSelection=>Boolean(item&&typeof item==="object"&&typeof (item as CompareSelection).id==="string"&&typeof (item as CompareSelection).category?.domain==="string")).slice(0,COMPARE_MAX);
 }catch{return[]}
}

function persist(items:CompareSelection[]){
 if(typeof window==="undefined")return;
 window.localStorage.setItem(COMPARE_STORAGE_KEY,JSON.stringify(items.slice(0,COMPARE_MAX)));
 window.dispatchEvent(new CustomEvent(COMPARE_EVENT,{detail:{items:items.slice(0,COMPARE_MAX)}}));
}

export function toggleCompareSelection(item:CompareSelection){
 const current=readCompareSelections();
 if(current.some(entry=>entry.id===item.id)){
  const items=current.filter(entry=>entry.id!==item.id);persist(items);return{status:"removed" as const,items};
 }
 if(current.length>=COMPARE_MAX)return{status:"limit" as const,items:current};
 const items=[...current,item];persist(items);return{status:"added" as const,items};
}

export function removeCompareSelection(id:string){const items=readCompareSelections().filter(item=>item.id!==id);persist(items);return items}
export function clearCompareSelections(){persist([])}
export function compareHref(items:CompareSelection[]){return `/comparer?ids=${encodeURIComponent(items.map(item=>item.id).join(","))}`}
