export const dynamic="force-dynamic";
const apiBase=()=> (process.env.API_INTERNAL_URL??process.env.NEXT_PUBLIC_API_URL??"http://127.0.0.1:4000").replace(/\/$/,"");
export async function GET(){
 try {
  const r=await fetch(apiBase()+"/seo/google-merchant.xml",{cache:"no-store",signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new Error("Merchant feed unavailable");
  const body=await r.text();
  if(!body.includes("<rss")||!body.includes("</rss>"))throw new Error("Bad feed");
  return new Response(body,{headers:{"Content-Type":"application/rss+xml; charset=utf-8","Cache-Control":"public, max-age=0, s-maxage=300","X-Content-Type-Options":"nosniff"}});
 }catch{return new Response("Feed temporarily unavailable",{status:503,headers:{"Cache-Control":"no-store"}})}
}
