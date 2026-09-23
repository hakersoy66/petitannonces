import{redirect}from"next/navigation";
export const dynamic="force-dynamic";
export default async function PromotePage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){const q=await searchParams;const id=typeof q.listingId==="string"?q.listingId:"";redirect(`/mon-compte/visibilite${id?`?listingId=${encodeURIComponent(id)}`:""}`)}
