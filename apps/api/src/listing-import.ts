import { lookup } from "node:dns/promises";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import net from "node:net";
import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import sharp from "sharp";
import { requireListingUser } from "./listing-auth.js";
import { getRuntimeIntegration } from "./admin-control.js";
import { ensureImportLogTable, existingImport, importFingerprint, importHistory, recordImport } from "./import-log.js";
import { publicObjectUrl, storageConfigured, uploadStoredObject } from "./storage.js";
import { evaluateListing } from "./publication.js";

const MAX_HTML_BYTES = 1_500_000;
const allowedProtocols = new Set(["http:", "https:"]);
const supportedReferenceSources = new Set(["leboncoin"]);
function isFacebookHost(host:string){const h=host.toLowerCase();return h==="facebook.com"||h.endsWith(".facebook.com")||h==="fb.com"||h.endsWith(".fb.com")}
function isVintedHost(host:string){const h=host.toLowerCase();return h==="vinted.fr"||h.endsWith(".vinted.fr")}
function importSourceType(raw:string){try{const h=new URL(raw).hostname.toLowerCase();if(h==="leboncoin.fr"||h.endsWith(".leboncoin.fr"))return "LEBONCOIN";if(isVintedHost(h))return "VINTED";return "LINK"}catch{return "LINK"}}
function isFacebookImageHost(host:string){const h=host.toLowerCase();return h.endsWith(".fbcdn.net")||h.endsWith(".fbsbx.com")||isFacebookHost(h)}
function isVintedImageHost(host:string){const h=host.toLowerCase();return /^images\d*\.vinted\.net$/.test(h)||h==="images.vinted.net"}
function relatedImportHosts(a:string,b:string){
  const x=a.toLowerCase().replace(/^www\./,"");const y=b.toLowerCase().replace(/^www\./,"");
  return x===y||x.endsWith(`.${y}`)||y.endsWith(`.${x}`);
}
function allowedImportImageHost(sourceHost:string,imageHost:string){
  const source=sourceHost.toLowerCase(),image=imageHost.toLowerCase();
  const sourceIsLeboncoin=source==="leboncoin.fr"||source.endsWith(".leboncoin.fr");
  if(sourceIsLeboncoin)return image==="img.leboncoin.fr"||image.endsWith(".img.leboncoin.fr");
  if(isVintedHost(source))return isVintedImageHost(image);
  if(isFacebookHost(source))return isFacebookImageHost(image);
  return relatedImportHosts(source,image);
}
function cleanImportedDescription(value:string|null|undefined,sourceUrl?:string|null){
  let text=(value??"").trim();if(!text)return null;
  const variants=new Set<string>();if(sourceUrl)variants.add(sourceUrl);
  if(sourceUrl)try{const u=new URL(sourceUrl);u.hash="";variants.add(u.toString());u.search="";variants.add(u.toString());variants.add(`${u.origin}${u.pathname}`)}catch{}
  for(const variant of variants){if(!variant)continue;text=text.split(variant).join(" ")}
  text=text.replace(/(?:\s|[.·•-])*(?:voir\s+plus|see\s+more)\s*$/i," ");
  return text.replace(/\s{2,}/g," ").trim().slice(0,12000)||null;
}
const execFileAsync=promisify(execFile);

function decode(value:string){return value.replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").trim()}
function normalizeHistovecShareUrl(raw:string|null|undefined){
  const value=(raw??"").trim();if(!value)return null;
  try{const u=new URL(value);if(u.protocol!=="https:"||u.username||u.password)return null;if(u.hostname.toLowerCase()!=="histovec.interieur.gouv.fr")return null;if(u.pathname!=="/histovec/rapport-acheteur")return null;const key=(u.searchParams.get("key")??"").trim();if(!key||key.length>160)return null;u.hash="";return u.toString();}catch{return null}
}
function extractHistovecShareUrl(raw:string|null|undefined){
  if(!raw)return null;
  const text=decode(raw.replace(/\\u002[fF]/g,"/").replace(/\\u003[aA]/g,":").replace(/\\u0026/g,"&").replace(/\\\//g,"/").replace(/&amp;/g,"&"));
  const candidates=text.match(/https:\/\/histovec\.interieur\.gouv\.fr\/histovec\/rapport-acheteur\?[^\s<>"'\])}]+/gi)??[];
  for(const candidate of candidates){const normalized=normalizeHistovecShareUrl(candidate.replace(/[.,;]+$/g,""));if(normalized)return normalized}
  return null;
}
async function ensureVehicleOfficialReportTable(){await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "VehicleOfficialReport" ("listingId" text PRIMARY KEY,"histovecUrl" text,"createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP)`)}
function meta(html:string,key:string){const rx1=new RegExp(`<meta[^>]+(?:property|name)=["']${key.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}["'][^>]+content=["']([^"']*)["'][^>]*>`,"i");const rx2=new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${key.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}["'][^>]*>`,"i");return decode((html.match(rx1)?.[1]??html.match(rx2)?.[1]??""));}
function titleTag(html:string){return decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]??"").replace(/\s+/g," "))}
function stripTags(s:string){return decode(s.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/\s+/g," "))}
function parsePrice(html:string){
  for(const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
    try{const rawJson=m[1];if(!rawJson)continue;const j=JSON.parse(rawJson);const items=Array.isArray(j)?j:[j];for(const x of items){const offer=x?.offers??x?.mainEntity?.offers;if(offer){const raw=Array.isArray(offer)?offer[0]?.price:offer.price;const n=Number(String(raw??"").replace(",","."));if(Number.isFinite(n)&&n>=0)return Math.round(n*100)}}}catch{}
  }
  const raw=meta(html,"product:price:amount")||meta(html,"og:price:amount");const n=Number(raw.replace(",","."));return Number.isFinite(n)&&n>=0?Math.round(n*100):null;
}
function parseLocation(html:string){
  for(const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
    try{const rawJson=m[1];if(!rawJson)continue;const j=JSON.parse(rawJson);const items=Array.isArray(j)?j:[j];for(const x of items){const a=x?.address??x?.itemOffered?.address;if(a&&typeof a==="object")return{city:String(a.addressLocality??"").trim()||null,postalCode:String(a.postalCode??"").trim()||null}}}catch{}
  }
  return {city:null,postalCode:null};
}
function isPrivateIp(ip:string){
  if(net.isIPv4(ip)){const p=ip.split(".").map(Number);const a=p[0]??-1,b=p[1]??-1;return a===10||a===127||a===0||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127)}
  if(net.isIPv6(ip)){const v=ip.toLowerCase();return v==="::1"||v.startsWith("fc")||v.startsWith("fd")||v.startsWith("fe80:")}
  return true;
}
async function safeUrl(raw:string){const u=new URL(raw);if(!allowedProtocols.has(u.protocol))throw new Error("unsupported_url");if(["localhost","0.0.0.0"].includes(u.hostname.toLowerCase()))throw new Error("unsafe_url");const addresses=await lookup(u.hostname,{all:true,verbatim:true});if(!addresses.length||addresses.some(a=>isPrivateIp(a.address)))throw new Error("unsafe_url");return u;}
const BROWSER_HEADERS={
  "user-agent":"Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  accept:"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language":"fr-FR,fr;q=0.9",
  "cache-control":"no-cache",
  pragma:"no-cache",
  "upgrade-insecure-requests":"1",
};
function isChallengeHtml(html:string){const x=html.toLowerCase();return x.includes("captcha-delivery.com")||x.includes("please enable js and disable any ad blocker")||x.includes("datadome");}
async function fetchLeboncoinHtml(raw:string){
  let current=(await safeUrl(raw)).toString();
  for(let redirectCount=0;redirectCount<5;redirectCount++){
    const host=new URL(current).hostname.toLowerCase();
    if(!(host==="leboncoin.fr"||host.endsWith(".leboncoin.fr")))throw new Error("unexpected_redirect_host");
    const args=["-sS","--max-time","12","--max-filesize",String(MAX_HTML_BYTES),"--request","GET","--user-agent",BROWSER_HEADERS["user-agent"],"--header",`Accept: ${BROWSER_HEADERS.accept}`,"--header",`Accept-Language: ${BROWSER_HEADERS["accept-language"]}`,"--header","Cache-Control: no-cache","--header","Pragma: no-cache","--header","Upgrade-Insecure-Requests: 1","--header","Referer: https://www.leboncoin.fr/","--output","-","--write-out","\n__PA_STATUS__:%{http_code}\n__PA_TYPE__:%{content_type}\n__PA_REDIRECT__:%{redirect_url}\n",current];
    let stdout:string;
    try{({stdout}=await execFileAsync("/usr/bin/curl",args,{encoding:"utf8",maxBuffer:MAX_HTML_BYTES+200_000}))}catch(e:any){stdout=typeof e?.stdout==="string"?e.stdout:"";if(!stdout)throw new Error("source_network_error")}
    const marker=stdout.lastIndexOf("\n__PA_STATUS__:");if(marker<0)throw new Error("source_network_error");
    const body=stdout.slice(0,marker);const metaBlock=stdout.slice(marker);
    const status=Number(metaBlock.match(/__PA_STATUS__:(\d+)/)?.[1]??0);const type=metaBlock.match(/__PA_TYPE__:([^\n]*)/)?.[1]??"";const redirect=metaBlock.match(/__PA_REDIRECT__:([^\n]*)/)?.[1]?.trim()??"";
    if(status>=300&&status<400&&redirect){current=(await safeUrl(new URL(redirect,current).toString())).toString();continue}
    if(status<200||status>=300)throw new Error(`source_http_${status||502}`);
    if(!type.includes("text/html")&&!type.includes("application/xhtml+xml"))throw new Error("source_not_html");
    if(isChallengeHtml(body))throw new Error("source_anti_bot_challenge");
    return body;
  }
  throw new Error("too_many_redirects");
}
async function fetchHtml(raw:string){
  const initial=await safeUrl(raw);const host=initial.hostname.toLowerCase();
  if(host==="leboncoin.fr"||host.endsWith(".leboncoin.fr"))return fetchLeboncoinHtml(initial.toString());
  let current=initial.toString();
  for(let redirectCount=0;redirectCount<5;redirectCount++){
    let lastChallenge="";
    for(let attempt=0;attempt<2;attempt++){
      const requestUrl=new URL(current);const referer=isFacebookHost(requestUrl.hostname)?"https://www.facebook.com/":`${requestUrl.origin}/`;
      const r=await fetch(current,{redirect:"manual",headers:{...BROWSER_HEADERS,referer},signal:AbortSignal.timeout(10000)});
      if(r.status>=300&&r.status<400){const location=r.headers.get("location");if(!location)throw new Error(`source_http_${r.status}`);current=(await safeUrl(new URL(location,current).toString())).toString();lastChallenge="";break;}
      if(!r.ok)throw new Error(`source_http_${r.status}`);
      const type=r.headers.get("content-type")??"";if(!type.includes("text/html")&&!type.includes("application/xhtml+xml"))throw new Error("source_not_html");
      const reader=r.body?.getReader();if(!reader)return"";let total=0;const chunks:Uint8Array[]=[];while(true){const {done,value}=await reader.read();if(done)break;if(value){total+=value.length;if(total>MAX_HTML_BYTES){reader.cancel().catch(()=>{});break}chunks.push(value)}}
      const html=new TextDecoder().decode(Buffer.concat(chunks.map(c=>Buffer.from(c))));
      if(!isChallengeHtml(html))return html;lastChallenge=html;
    }
    if(lastChallenge)throw new Error("source_anti_bot_challenge");
  }
  throw new Error("too_many_redirects");
}

async function fetchViaWebExtraction(raw:string){
  const configured=await getRuntimeIntegration("web-extraction");
  if(!configured?.enabled)return null;
  const provider=String(configured.config.provider??"scrapingbee").toLowerCase();
  if(provider!=="scrapingbee")return null;
  const apiKey=configured.secrets.apiKey;
  if(!apiKey)return null;
  const endpoint=new URL("https://app.scrapingbee.com/api/v1");
  endpoint.searchParams.set("url",raw);
  endpoint.searchParams.set("render_js",String(configured.config.renderJs??true));
  if(configured.config.premiumProxy===true)endpoint.searchParams.set("premium_proxy","true");
  const countryCode=String(configured.config.countryCode??"").trim().toLowerCase();if(/^[a-z]{2}$/.test(countryCode))endpoint.searchParams.set("country_code",countryCode);
  const waitMs=Number(configured.config.waitMs??0);if(Number.isFinite(waitMs)&&waitMs>0)endpoint.searchParams.set("wait",String(Math.min(10000,Math.round(waitMs))));
  const r=await fetch(endpoint,{headers:{authorization:`Bearer ${apiKey}`,accept:"text/html,application/xhtml+xml"},signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw new Error(`web_extraction_http_${r.status}`);
  const html=(await r.text()).slice(0,MAX_HTML_BYTES);
  if(!html||isChallengeHtml(html))throw new Error("web_extraction_unavailable");
  return html;
}

function cleanFacebookTitle(value:string){
  return value.replace(/\s*[|·-]\s*(?:Facebook Marketplace|Marketplace|Facebook)\s*$/i,"").replace(/^Marketplace\s*[|·-]\s*/i,"").trim().slice(0,120)||null;
}
function facebookReaderImages(text:string){
  const candidates:string[]=[];
  for(const m of text.matchAll(/!\[[^\]]*\]\((https:\/\/[^)\s]+)\)/gi))candidates.push(decode(m[1]??""));
  for(const m of text.matchAll(/https:\/\/[^\s)"'<>]+(?:fbcdn\.net|fbsbx\.com)[^\s)"'<>]*/gi))candidates.push(decode(m[0]??""));
  const out:string[]=[];const seen=new Set<string>();
  for(const raw of candidates){try{const u=new URL(raw.replace(/&amp;/g,"&"));if(!isFacebookImageHost(u.hostname))continue;const key=`${u.hostname}${u.pathname}`;if(seen.has(key))continue;seen.add(key);out.push(u.toString());if(out.length>=20)break}catch{}}
  return out;
}
function cleanFacebookReaderText(value:string){
  return value.replace(/!\[[^\]]*\]\([^)]*\)/g," ").replace(/\[([^\]]+)\]\([^)]*\)/g,"$1").replace(/<br\s*\/?\s*>/gi,"\n").replace(/&nbsp;/gi," ").replace(/[ \t]+/g," ").replace(/\n{3,}/g,"\n\n").trim();
}
function extractFacebookReaderDescription(markdown:string,title:string|null){
  const cleaned=cleanFacebookReaderText(markdown.replace(/^Title:.*$/gmi,"").replace(/^URL Source:.*$/gmi,"").replace(/^Markdown Content:.*$/gmi,""));
  const headingNames="Description|Description de l[’']article|À propos de cet article|A propos de cet article|Détails de l[’']article|Details|Item description|About this item|Product description";
  const stopNames="Informations? sur le vendeur|Détails du vendeur|Seller information|Seller details|À propos du vendeur|About the seller|Lieu|Location|Meetup|Retrait|Livraison|Message|Envoyer un message|Partager|Share";
  const headingRx=new RegExp(`(?:^|\n)(?:#{1,4}\s*)?(?:${headingNames})\s*[:\-]?\s*(?:\n|$)`,"i");
  const heading=headingRx.exec(cleaned);
  if(heading){
    const tail=cleaned.slice((heading.index??0)+heading[0].length);
    const stopRx=new RegExp(`\n(?:#{1,4}\s*)?(?:${stopNames})\b`,"i");
    const stop=stopRx.exec(tail);
    const block=(stop?tail.slice(0,stop.index):tail).trim();
    const normalized=block.replace(/^[-*•]\s*/gm,"").replace(/\n+/g," ").replace(/\s+/g," ").trim();
    if(normalized.length>=10)return normalized.slice(0,12000);
  }
  const inline=new RegExp(`(?:${headingNames})\s*[:\-]\s*([^\n]{10,12000})`,"i").exec(cleaned)?.[1]?.trim();
  if(inline&&inline.length>=10)return inline.slice(0,12000);
  const noise=/^(facebook|marketplace|facebook marketplace|acheter|buy|vendre|sell|partager|share|enregistrer|save|message|envoyer un message|contacter|contact|voir le profil|seller details|détails du vendeur|seller information|informations? sur le vendeur|connexion|log in|se connecter|voir plus|see more)$/i;
  const meta=/^(?:prix|price|lieu|location|mis en vente à|listed in|état|condition|catégorie|category)\s*[:\-]?/i;
  const lines=cleaned.split("\n").map(x=>x.replace(/^#{1,6}\s*/,"").replace(/^[-*•]\s*/,"").replace(/\s+/g," ").trim()).filter(Boolean);
  const titleNorm=(title??"").trim().toLocaleLowerCase("fr-FR");
  const candidates=lines.filter(line=>{
    const lower=line.toLocaleLowerCase("fr-FR");
    if(noise.test(line)||meta.test(line)||/^https?:\/\//i.test(line)||/^\d+[\d\s.,]*\s*(?:€|eur)$/i.test(line))return false;
    if(titleNorm&&lower===titleNorm)return false;
    if(line.length<18||line.length>1800)return false;
    if(/^(?:title|url source|markdown content)\s*:/i.test(line))return false;
    return true;
  });
  const descriptive=candidates.filter(line=>/[.!?]|\b(?:avec|sans|très|bon|bonne|neuf|neuve|vend|vente|fonctionne|état|utilis|cause|raison|fourni|inclu|disponible|entretien|kilom|année|modèle|marque)\b/i.test(line));
  const fallback=(descriptive.length?descriptive:candidates).slice(0,12).join(" ").replace(/\s+/g," ").trim();
  return fallback.length>=20?fallback.slice(0,12000):null;
}
function summarizeFacebookReader(markdown:string,url:string){
  const rawTitle=(markdown.match(/^Title:\s*(.+)$/mi)?.[1]??markdown.match(/^#\s+(.+)$/m)?.[1]??"").trim();
  const title=cleanFacebookTitle(rawTitle);
  const descriptionBlocks=[
    markdown.match(/(?:^|\n)##?\s*(?:Description|Détails|Details)\s*\n([\s\S]*?)(?=\n##?\s|\n(?:Seller|Vendeur|Location|Lieu|Meetup|À propos)\b|$)/i)?.[1],
    markdown.match(/(?:Description|Détails)\s*[:\-]\s*([^\n]{10,3000})/i)?.[1],
  ].filter((x):x is string=>Boolean(x));
  let description=(descriptionBlocks[0]??"").replace(/!\[[^\]]*\]\([^)]*\)/g," ").replace(/\[([^\]]+)\]\([^)]*\)/g,"$1").replace(/\s+/g," ").trim().slice(0,12000)||null;
  if(!description){try{description=extractFacebookReaderDescription(markdown,title)}catch{description=null}}
  const pricePatterns=[/(?:^|\n)\s*([0-9][0-9\s\u00a0\u202f.,]*)\s*€(?:\s|$)/m,/(?:^|\n)\s*€\s*([0-9][0-9\s\u00a0\u202f.,]*)\b/m,/(?:Prix|Price)\s*[:\-]?\s*([0-9][0-9\s\u00a0\u202f.,]*)\s*(?:€|EUR)/i];
  let priceMinor:number|null=null;for(const rx of pricePatterns){const match=markdown.match(rx);if(!match?.[1])continue;const n=Number(match[1].replace(/[\s\u00a0\u202f]/g,"").replace(",","."));if(Number.isFinite(n)&&n>=0){priceMinor=Math.round(n*100);break}}
  const locationPatterns=[/(?:Listed in|Mis en vente à|Lieu|Location)\s*[:\-]?\s*([^\n]{2,120})/i,/Marketplace\s*·\s*([^\n]{2,120})/i];let city:string|null=null;for(const rx of locationPatterns){const m=markdown.match(rx);if(m?.[1]){city=m[1].replace(/\[[^\]]*\]|\([^)]*\)/g," ").replace(/\s+/g," ").trim().slice(0,120)||null;if(city)break}}
  const postalCode=markdown.match(/\b([0-9]{5})\b/)?.[1]??null;
  const imageUrls=facebookReaderImages(markdown);
  return {sourceUrl:url,title,description,priceMinor,imageUrl:imageUrls[0]??null,imageUrls,city,postalCode,source:"facebook-reader"};
}
function facebookReaderTextUsable(text:string){
  const lower=text.toLowerCase();
  if(text.length<80||lower.includes("page isn't available")||lower.includes("page n’est pas disponible"))return false;
  const hasListingSignals=/fbcdn\.net|facebook\.com\/(?:commerce\/listing|marketplace\/item)\/[0-9]+|(?:^|\s)[€$]?[0-9][0-9 .,'’]*\s*€(?:\s|$)/im.test(text);
  const loginWall=lower.includes("log into facebook")||lower.includes("log in to facebook")||lower.includes("connectez-vous à facebook");
  return !loginWall||hasListingSignals;
}
async function fetchFacebookReader(raw:string){
  const u=await safeUrl(raw);if(!isFacebookHost(u.hostname))throw new Error("reader_source_unsupported");
  const itemMatch=u.pathname.match(/\/marketplace\/item\/([0-9]+)/i);
  const cleanPath=u.pathname.replace(/\/+$/g,"")||"/";
  const targets=itemMatch?
    [`https://www.facebook.com/marketplace/item/${itemMatch[1]}/`,u.toString()]:
    [u.toString(),`https://www.facebook.com${cleanPath}`];
  let lastStatus=0;
  for(const target of [...new Set(targets)]){
    try{
      const r=await fetch(`https://r.jina.ai/${target}`,{redirect:"follow",headers:{accept:"text/plain,text/markdown;q=0.9,*/*;q=0.8","user-agent":"PetitAnnonces/1.0"},signal:AbortSignal.timeout(25000)});
      lastStatus=r.status;if(!r.ok)continue;
      const text=(await r.text()).slice(0,MAX_HTML_BYTES);
      if(!facebookReaderTextUsable(text))continue;
      return text;
    }catch{}
  }
  throw new Error(lastStatus?`facebook_reader_http_${lastStatus}`:"facebook_reader_unavailable");
}
function cleanVintedTitle(value:string){
  return value.replace(/\s*[|·-]\s*Vinted\s*$/i,"").trim().slice(0,120)||null;
}
function vintedReaderImages(markdown:string,title:string|null){
  const beforeSeller=(markdown.split(/\n##\s*(?:Dressing du membre|Articles similaires|Member wardrobe|Similar items)/i)[0]??markdown).slice(0,80000);
  const all=[...beforeSeller.matchAll(/!\[([^\]]*)\]\((https:\/\/images\d*\.vinted\.net\/[^)\s]+)\)/gi)].map(m=>({alt:(m[1]??"").trim(),url:decode(m[2]??"")})).filter(x=>Boolean(x.url));
  const wanted=normalizeMatch(title??"");const matched=wanted?all.filter(x=>normalizeMatch(x.alt).includes(wanted)):all;const source=matched.length?matched:all.filter(x=>/\/f\d{3,4}\//i.test(x.url));
  const out:string[]=[];const seen=new Set<string>();for(const item of source){try{const u=new URL(item.url.replace(/&amp;/g,"&"));if(!isVintedImageHost(u.hostname))continue;const key=`${u.hostname}${u.pathname}`;if(seen.has(key))continue;seen.add(key);out.push(u.toString());if(out.length>=20)break}catch{}}
  return out;
}
function vintedField(section:string,label:string){const rx=new RegExp(`(?:^|\\n)${label}\\s*\\n\\s*([^\\n]{1,160})`,"i");return rx.exec(section)?.[1]?.trim()??null;}
export function summarizeVintedReader(markdown:string,url:string){
  const rawTitle=(markdown.match(/^Title:\s*(.+)$/mi)?.[1]??markdown.match(/^#\s+(.+)$/m)?.[1]??"").trim();const title=cleanVintedTitle(rawTitle);
  const sectionStart=title?markdown.toLowerCase().lastIndexOf(`# ${title}`.toLowerCase()):-1;const section=(sectionStart>=0?markdown.slice(sectionStart):markdown).slice(0,30000);
  const priceMatch=section.match(/(?:^|\n)\s*([0-9][0-9\s\u00a0\u202f]*(?:[.,][0-9]{1,2})?)\s*€(?:\s|$)/m);const priceValue=priceMatch?.[1]?Number(priceMatch[1].replace(/[\s\u00a0\u202f]/g,"").replace(",",".")):NaN;const priceMinor=Number.isFinite(priceValue)&&priceValue>=0?Math.round(priceValue*100):null;
  const shippingIndex=section.search(/\n###\s*(?:Envoi|Shipping)\b/i);const beforeShipping=shippingIndex>=0?section.slice(0,shippingIndex):section.slice(0,8000);
  let description:string|null=null;const added=/(?:^|\n)(?:Ajouté|Added)\s*\n[^\n]*\n+([\s\S]*?)$/i.exec(beforeShipping)?.[1]?.trim()??"";if(added)description=added.replace(/\[([^\]]+)\]\([^)]*\)/g,"$1").replace(/\s+/g," ").trim().slice(0,12000)||null;
  const condition=vintedField(section,"(?:État|Etat|Condition)");const size=vintedField(section,"(?:Taille|Size)");const color=vintedField(section,"(?:Couleur|Color)");const imageUrls=vintedReaderImages(markdown,title);
  const sourceFields:Record<string,string|number|boolean>={};if(condition)sourceFields.condition=condition;if(size)sourceFields.size=size;if(color)sourceFields.color=color;
  return {sourceUrl:url,title,description,priceMinor,imageUrl:imageUrls[0]??null,imageUrls,city:null,postalCode:null,histovecUrl:null,source:"vinted-reader",sourceFields};
}
export async function fetchVintedReader(raw:string){
  const u=await safeUrl(raw);if(!isVintedHost(u.hostname))throw new Error("vinted_reader_source_unsupported");const item=u.pathname.match(/\/items\/(\d{5,20})(?:[-/]|$)/i);if(!item?.[1])throw new Error("vinted_item_id_missing");
  const slug=u.pathname.match(/\/items\/\d+(-[^/?#]+)/i)?.[1]??"";const canonical=`https://www.vinted.fr/items/${item[1]}${slug}`;let lastStatus=0;
  for(const target of [...new Set([canonical,u.toString()])]){try{const r=await fetch(`https://r.jina.ai/${target}`,{redirect:"follow",headers:{accept:"text/plain,text/markdown;q=0.9,*/*;q=0.8","user-agent":"PetitAnnonces/1.0"},signal:AbortSignal.timeout(25000)});lastStatus=r.status;if(!r.ok)continue;const text=(await r.text()).slice(0,MAX_HTML_BYTES);const lower=text.toLowerCase();if(text.length<100||lower.includes("page not found")||lower.includes("article introuvable"))continue;if(!/images\d*\.vinted\.net/i.test(text)&&!/^#\s+/m.test(text))continue;return text}catch{}}
  throw new Error(lastStatus?`vinted_reader_http_${lastStatus}`:"vinted_reader_unavailable");
}

async function fetchLeboncoinApiAd(raw:string){
  const u=await safeUrl(raw);const host=u.hostname.toLowerCase();if(!(host==="leboncoin.fr"||host.endsWith(".leboncoin.fr")))throw new Error("leboncoin_api_source_unsupported");
  const adId=u.pathname.match(/\/ad\/[^/]+\/(\d{6,20})(?:\/|$)/i)?.[1];if(!adId)throw new Error("leboncoin_ad_id_missing");
  const python=(process.env.LEBONCOIN_HELPER_PYTHON??"/var/www/petitannonces/shared/lbc-client-venv/bin/python").trim();
  const script=(process.env.LEBONCOIN_HELPER_SCRIPT??"/var/www/petitannonces/repository/apps/api/scripts/leboncoin-public-ad.py").trim();
  try{
    const {stdout}=await execFileAsync(python,[script,adId],{encoding:"utf8",maxBuffer:MAX_HTML_BYTES+200_000,timeout:25_000});
    const parsed=JSON.parse(stdout);if(!parsed||typeof parsed!=="object"||parsed.error)throw new Error(String(parsed?.error??"leboncoin_api_invalid_response"));return parsed;
  }catch(e:any){const msg=String(e?.message??"");if(msg.includes("leboncoin_api_http_"))throw e;throw new Error("leboncoin_api_unavailable")}
}
async function fetchLeboncoinReader(raw:string){
  const u=await safeUrl(raw);const host=u.hostname.toLowerCase();if(!(host==="leboncoin.fr"||host.endsWith(".leboncoin.fr")))throw new Error("reader_source_unsupported");
  const cleanPath=u.pathname.replace(/\/+$/g,"")||"/";
  const targets=[`https://www.leboncoin.fr${cleanPath}`,`https://${u.host}${cleanPath}`];
  let lastStatus=0;
  for(const target of [...new Set(targets)]){
    try{
      const readerUrl=`https://r.jina.ai/${target}`;
      const r=await fetch(readerUrl,{redirect:"follow",headers:{accept:"text/plain,text/markdown;q=0.9,*/*;q=0.8","user-agent":"PetitAnnonces/1.0"},signal:AbortSignal.timeout(20000)});lastStatus=r.status;
      if(!r.ok)continue;const text=await r.text();const lower=text.toLowerCase();if(text.length<80||lower.includes("maybe requiring captcha")||lower.includes("page not found"))continue;
      return text.slice(0,MAX_HTML_BYTES);
    }catch{}
  }
  throw new Error(lastStatus?`reader_http_${lastStatus}`:"reader_unavailable");
}
function numberFromSource(value:unknown){const m=String(value??"").replace(/\u00a0|\u202f/g," ").match(/-?[0-9][0-9 .]*(?:[.,][0-9]+)?/);if(!m)return null;const n=Number(m[0].replace(/ /g,"").replace(",","."));return Number.isFinite(n)?n:null}
export function readerKeyFields(markdown:string){
  const section=markdown.match(/##\s*(?:Les informations clés|Caractéristiques(?: du (?:bien|véhicule))?|Informations principales|Détails du bien|Informations sur le bien|Détails du véhicule)\s*\n([\s\S]*?)(?=\n## |$)/i)?.[1]??markdown.slice(0,20000);
  const lines=section.split(/\r?\n/).map(x=>x.replace(/^\s*[-*•]\s*/,"").replace(/\*\*/g,"").replace(/\[([^\]]+)\]\([^)]*\)/g,"$1").trim()).filter(Boolean).filter(x=>!/^!\[/.test(x));
  const labels=["Marque","Modèle","Année modèle","Kilométrage","Énergie","Boîte de vitesse","Nombre de portes","Nombre de place(s)","Nombre de places","Finition Constructeur","Version Constructeur","Date de première mise en circulation","Type de véhicule","Carrosserie","Couleur","Crit'Air","Puissance fiscale","Puissance DIN","État du véhicule","État","Garantie","Garantie véhicule","Type de bien","Surface habitable","Surface","Nombre de pièces","Pièces","Nombre de chambres","Chambres","Étage","Nombre d'étages","Surface du terrain","Meublé","Ascenseur","Balcon","Terrasse","Jardin","Piscine","Parking","Garage","Chauffage","Type de chauffage","Charges","Charges de copropriété","Dépôt de garantie","Classe énergie","Classe climat","GES"];
  const labelSet=new Set(labels.map(normalizeMatch));const raw:Record<string,string>={};
  for(let i=0;i<lines.length;i++){
    const line=lines[i]??"";const inline=line.match(/^(.{2,80}?)\s*[:：]\s*(.+)$/);
    if(inline&&labelSet.has(normalizeMatch(inline[1]??""))){raw[normalizeMatch(inline[1]??"")]=(inline[2]??"").trim();continue;}
    const key=normalizeMatch(line);if(!labelSet.has(key))continue;const next=lines[i+1];if(next&&!labelSet.has(normalizeMatch(next)))raw[key]=next;
  }
  const out:Record<string,string|number|boolean>={};const get=(...names:string[])=>{for(const name of names){const v=raw[normalizeMatch(name)];if(v)return v}return null};
  const boolFrom=(value:string|null)=>{if(!value)return null;const v=normalizeMatch(value);if(/^(oui|yes|true|present|avec|1)\b/.test(v))return true;if(/^(non|no|false|sans|aucun|aucune|0)\b/.test(v))return false;return null};
  const grade=(value:string|null)=>value?.trim().match(/^[A-G]/i)?.[0]?.toUpperCase()??null;
  const brand=get("Marque");if(brand)out.brand=brand;
  const model=get("Modèle");if(model)out.model=model;
  const version=get("Finition Constructeur","Version Constructeur");if(version)out.version=version;
  const year=numberFromSource(get("Année modèle"));if(year)out.modelYear=Math.round(year);
  const mileage=numberFromSource(get("Kilométrage"));if(mileage!=null)out.mileage=Math.round(mileage);
  const fuel=get("Énergie");if(fuel)out.fuel=fuel;
  const gearbox=get("Boîte de vitesse");if(gearbox)out.gearbox=gearbox;
  const doors=numberFromSource(get("Nombre de portes"));if(doors!=null)out.doors=Math.round(doors);
  const seats=numberFromSource(get("Nombre de place(s)","Nombre de places"));if(seats!=null)out.seats=Math.round(seats);
  const first=get("Date de première mise en circulation");if(first){const m=first.match(/^(\d{1,2})\/(\d{4})$/);out.firstRegistration=m?`${m[2]}-${String(Number(m[1])).padStart(2,"0")}-01`:first;}
  const color=get("Couleur");if(color)out.color=color;
  const critAir=numberFromSource(get("Crit'Air"));if(critAir!=null)out.critAir=Math.round(critAir);
  const fiscal=numberFromSource(get("Puissance fiscale"));if(fiscal!=null)out.fiscalPower=Math.round(fiscal);
  const hp=numberFromSource(get("Puissance DIN"));if(hp!=null){out.powerDinHp=Math.round(hp);out.powerKw=Math.round(hp*.735499)}
  const bodyStyle=get("Type de véhicule","Carrosserie");if(bodyStyle)out.bodyStyle=bodyStyle;
  const condition=get("État du véhicule","État");if(condition)out.condition=condition;
  const warranty=get("Garantie véhicule","Garantie");if(warranty)out.warranty=!/aucune|sans garantie|non/i.test(warranty);
  const propertyType=get("Type de bien");if(propertyType)out.propertyType=propertyType;
  const surface=numberFromSource(get("Surface habitable","Surface"));if(surface!=null)out.surface=surface;
  const rooms=numberFromSource(get("Nombre de pièces","Pièces"));if(rooms!=null)out.rooms=Math.round(rooms);
  const bedrooms=numberFromSource(get("Nombre de chambres","Chambres"));if(bedrooms!=null)out.bedrooms=Math.round(bedrooms);
  const floor=numberFromSource(get("Étage"));if(floor!=null)out.floor=Math.round(floor);
  const totalFloors=numberFromSource(get("Nombre d'étages"));if(totalFloors!=null)out.totalFloors=Math.round(totalFloors);
  const land=numberFromSource(get("Surface du terrain"));if(land!=null)out.landM2=land;
  const furnished=get("Meublé");if(furnished){const b=boolFrom(furnished);out.furnished=b??/meubl/i.test(furnished)}
  const elevator=boolFrom(get("Ascenseur"));if(elevator!=null)out.elevator=elevator;
  const parkingRaw=get("Parking","Garage");if(parkingRaw){const b=boolFrom(parkingRaw);out.parking=b??!/non|aucun|sans/i.test(parkingRaw)}
  const heating=get("Type de chauffage","Chauffage");if(heating)out.heating=heating;
  const charges=numberFromSource(get("Charges de copropriété","Charges"));if(charges!=null)out.charges=charges;
  const deposit=numberFromSource(get("Dépôt de garantie"));if(deposit!=null)out.deposit=deposit;
  const outdoor=["Balcon","Terrasse","Jardin","Piscine"].filter(name=>{const value=get(name);if(!value)return false;const b=boolFrom(value);return b??!/non|aucun|sans/i.test(value)});if(outdoor.length)out.outdoor=outdoor.join(",");
  const dpe=grade(get("Classe énergie"));if(dpe)out.dpe=dpe;
  const ges=grade(get("Classe climat","GES"));if(ges)out.ges=ges;
  return out;
}
function adStructuredFields(ad:any){
  const out:Record<string,string|number|boolean>={};const rawAttrs=[ad?.attributes,ad?.ad_attributes,ad?.params,ad?.vehicle?.attributes,ad?.real_estate?.attributes].flatMap((value:any)=>Array.isArray(value)?value:value&&typeof value==="object"?Object.entries(value).map(([key,v])=>({key,value:v})):[]);const attrs=rawAttrs;
  const addOutdoor=(value:string)=>{const current=String(out.outdoor??"").split(",").map(x=>x.trim()).filter(Boolean);if(!current.includes(value))current.push(value);out.outdoor=current.join(",")};
  const boolish=(raw:unknown)=>{const v=normalizeMatch(String(raw??""));if(/^(oui|yes|true|present|avec|1)\b/.test(v))return true;if(/^(non|no|false|sans|aucun|aucune|0)\b/.test(v))return false;return null};
  for(const attr of attrs){const key=normalizeMatch(String(attr?.key??attr?.key_label??attr?.label??""));const label=normalizeMatch(String(attr?.key_label??attr?.label??attr?.key??""));const raw=attr?.value_label??attr?.value??(Array.isArray(attr?.values)?attr.values[0]:undefined);if(raw===undefined||raw===null||raw==="")continue;const match=(...terms:string[])=>terms.some(t=>key===normalizeMatch(t)||label===normalizeMatch(t)||key.includes(normalizeMatch(t))||label.includes(normalizeMatch(t)));
    if(match("brand","marque"))out.brand=String(raw);else if(match("model","modele"))out.model=String(raw);else if(match("version","finition","vehicle_version"))out.version=String(raw);else if(match("first_registration_date","date de premiere mise en circulation","regdate")){const s=String(raw).trim();const d=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);const m=s.match(/^(\d{1,2})[\/-](\d{4})$/);out.firstRegistration=d?`${d[3]}-${String(Number(d[2])).padStart(2,"0")}-${String(Number(d[1])).padStart(2,"0")}`:m?`${m[2]}-${String(Number(m[1])).padStart(2,"0")}-01`:s}
    else if(match("model_year","annee modele","annee")){const n=numberFromSource(raw);if(n)out.modelYear=Math.round(n)}else if(match("mileage","kilometrage")){const n=numberFromSource(raw);if(n!=null)out.mileage=Math.round(n)}else if(match("fuel","energie"))out.fuel=String(raw);else if(match("gearbox","boite de vitesse","transmission"))out.gearbox=String(raw);else if(match("doors","nombre de portes")){const n=numberFromSource(raw);if(n!=null)out.doors=Math.round(n)}else if(match("seats","places","nombre de places")){const n=numberFromSource(raw);if(n!=null)out.seats=Math.round(n)}else if(match("horsepower","puissance fiscale")){const n=numberFromSource(raw);if(n!=null)out.fiscalPower=Math.round(n)}else if(match("power_din","puissance din")){const n=numberFromSource(raw);if(n!=null){out.powerDinHp=Math.round(n);out.powerKw=Math.round(n*.735499)}}else if(match("critair","crit air")){const n=numberFromSource(raw);if(n!=null)out.critAir=Math.round(n)}else if(match("vehicle_type","type de vehicule","body_type","carrosserie"))out.bodyStyle=String(raw);else if(match("color","couleur"))out.color=String(raw);else if(match("vehicle_condition","condition","etat du vehicule"))out.condition=String(raw);else if(match("warranty","garantie")){const b=boolish(raw);out.warranty=b??!/aucune|sans garantie|non/i.test(String(raw))}
    else if(match("real_estate_type","type de bien"))out.propertyType=String(raw);else if(match("square","surface habitable","surface")){const n=numberFromSource(raw);if(n!=null)out.surface=n}else if(match("rooms","nombre de pieces")){const n=numberFromSource(raw);if(n!=null)out.rooms=Math.round(n)}else if(match("bedrooms","nombre de chambres")){const n=numberFromSource(raw);if(n!=null)out.bedrooms=Math.round(n)}else if(match("floor_number","etage")){const n=numberFromSource(raw);if(n!=null)out.floor=Math.round(n)}else if(match("building_floors","total_floors","nombre d etages")){const n=numberFromSource(raw);if(n!=null)out.totalFloors=Math.round(n)}else if(match("land_plot_surface","surface du terrain")){const n=numberFromSource(raw);if(n!=null)out.landM2=n}else if(match("furnished","meuble")){const b=boolish(raw);if(b!=null)out.furnished=b}else if(match("elevator","ascenseur")){const b=boolish(raw);if(b!=null)out.elevator=b}else if(match("parking","garage")){const b=boolish(raw);out.parking=b??true}else if(match("balcony","balcon")){const b=boolish(raw);if(b!==false)addOutdoor("Balcon")}else if(match("terrace","terrasse")){const b=boolish(raw);if(b!==false)addOutdoor("Terrasse")}else if(match("garden","jardin")){const b=boolish(raw);if(b!==false)addOutdoor("Jardin")}else if(match("pool","piscine")){const b=boolish(raw);if(b!==false)addOutdoor("Piscine")}else if(match("heating","chauffage"))out.heating=String(raw);else if(match("charges","charges de copropriete")){const n=numberFromSource(raw);if(n!=null)out.charges=n}else if(match("deposit","depot de garantie")){const n=numberFromSource(raw);if(n!=null)out.deposit=n}else if(match("energy_rate","classe energie","dpe")){const s=String(raw).trim().toUpperCase().match(/^[A-G]/)?.[0];if(s)out.dpe=s}else if(match("ges","classe climat")){const s=String(raw).trim().toUpperCase().match(/^[A-G]/)?.[0];if(s)out.ges=s}}
  return out;
}
function normalizeLeboncoinImageUrl(raw:string){
  try{
    const u=new URL(raw.replace(/&amp;/g,"&"));const host=u.hostname.toLowerCase();
    if(!(host==="img.leboncoin.fr"||host.endsWith(".img.leboncoin.fr")))return raw;
    // Only classified photos. Tenant/domain assets are logos, avatars or recommendation UI.
    if(!/^\/api\/v1\/lbcpb1\/images\//i.test(u.pathname))return "";
    u.search="";u.searchParams.set("rule","ad-large");return u.toString();
  }catch{return ""}
}
function isLeboncoinUiImageAlt(raw:string){
  const alt=normalizeMatch(raw);if(!alt)return false;
  if(/\b(logo|avatar|profil|professionnel|boutique|couverture|icone|icon|vendeur|initiale|photo de profil)\b/.test(alt))return true;
  return /^[a-z0-9]$/i.test(alt.trim());
}
function cleanLeboncoinImageUrls(items:Array<{url:string;alt?:string}>){
  const out:string[]=[];const seen=new Set<string>();
  for(const item of items){if(item.alt&&isLeboncoinUiImageAlt(item.alt))continue;const normalized=normalizeLeboncoinImageUrl(item.url);if(!normalized)continue;let key=normalized;try{const u=new URL(normalized);key=`${u.hostname}${u.pathname}`}catch{}if(seen.has(key))continue;seen.add(key);out.push(normalized);if(out.length>=20)break}
  return out;
}
function collectLeboncoinImageUrls(value:unknown){
  const out:string[]=[];const stack:unknown[]=[value];let seen=0;
  while(stack.length&&seen<2000&&out.length<60){seen++;const item=stack.pop();if(item==null)continue;if(typeof item==="string"){if(/^https?:\/\/img\.leboncoin\.fr\//i.test(item))out.push(item);continue}if(Array.isArray(item)){for(const v of item)stack.push(v);continue}if(typeof item==="object"){for(const v of Object.values(item as Record<string,unknown>))stack.push(v)}}
  return out;
}
function readerListingImages(markdown:string,title:string|null){
  const stop=markdown.search(/\n##\s*(?:Description|À propos|Caracteristiques vendeur|Caractéristiques vendeur)/i);const galleryText=stop>0?markdown.slice(0,stop):markdown.slice(0,60000);
  const all=[...galleryText.matchAll(/!\[([^\]]*)\]\((https:\/\/img\.leboncoin\.fr\/[^)]+)\)/gi)].map(m=>({alt:(m[1]??"").trim(),url:(m[2]??"").trim()})).filter(x=>Boolean(x.url));
  const numbered=all.filter(x=>/\bimage\s+\d+\b/i.test(normalizeMatch(x.alt)));
  if(!title)return cleanLeboncoinImageUrls(numbered.length?numbered:all);
  const wanted=normalizeMatch(title);
  const exactGallery=numbered.filter(x=>normalizeMatch(x.alt).includes(wanted));
  // Keep title-matched gallery first, then numbered images from the pre-description gallery area.
  return cleanLeboncoinImageUrls([...(exactGallery.length?exactGallery:[]),...numbered]);
}
export function readerSummaryFields(markdown:string){
  const out:Record<string,string|number|boolean>={};
  const propertyType=markdown.match(/(?:^|\n)\s*(Appartement|Maison|Terrain|Parking|Garage|Local commercial|Bureau|Immeuble)\s*(?:·|,)/im)?.[1];if(propertyType)out.propertyType=/garage/i.test(propertyType)?"Parking":propertyType;
  const rooms=markdown.match(/\b(\d{1,2})\s*pi[eè]ces?\b/i)?.[1];if(rooms)out.rooms=Number(rooms);
  const surface=markdown.match(/\b(\d{1,5}(?:[.,]\d+)?)\s*m(?:²|2)(?![a-z0-9])/i)?.[1];if(surface)out.surface=Number(surface.replace(",","."));
  const floor=markdown.match(/(?:^|\s)Étage\s*(\d{1,2})(?:\s*\/\s*(\d{1,2}))?/im);if(floor?.[1])out.floor=Number(floor[1]);if(floor?.[2])out.totalFloors=Number(floor[2]);
  const rdc=markdown.match(/(?:^|\s)RDC(?:\s*\/\s*(\d{1,2}))?/im);if(rdc){out.floor=0;if(rdc[1])out.totalFloors=Number(rdc[1])}
  const land=markdown.match(/(?:Surface du terrain|Terrain)\s*[:·-]?\s*(\d{1,6}(?:[.,]\d+)?)\s*m(?:²|2)(?![a-z0-9])/i)?.[1];if(land)out.landM2=Number(land.replace(",","."));
  const dpe=markdown.match(/Classe énergie\s*([A-G])/i)?.[1];if(dpe)out.dpe=dpe.toUpperCase();
  const ges=markdown.match(/(?:Classe climat|GES)\s*([A-G])/i)?.[1];if(ges)out.ges=ges.toUpperCase();
  const outdoor=["Balcon","Terrasse","Jardin","Piscine"].filter(label=>new RegExp(`(?:^|\\n)\\s*${label}\\s*(?:\\n|$)`,"i").test(markdown));if(outdoor.length)out.outdoor=outdoor.join(",");
  if(/(?:^|\n)\s*(?:Parking|Garage)\s*(?:\n|$)/i.test(markdown))out.parking=true;
  if(/(?:^|\n)\s*Ascenseur\s*(?:\n|$)/i.test(markdown))out.elevator=true;
  return out;
}
function summarizeReader(markdown:string,url:string){
  const title=(markdown.match(/^Title:\s*(.+)$/m)?.[1]??markdown.match(/^#\s+(.+)$/m)?.[1]??"").trim().replace(/\s*[-|·]\s*leboncoin.*$/i,"").slice(0,120)||null;
  const descBlock=markdown.match(/##\s*(?:Description(?:\s+(?:du véhicule|de l’annonce|du bien|de ce bien))?|À propos de (?:cette|l’)annonce|À propos du bien)\s*\n\s*([\s\S]*?)(?=\n## |\nSponsorisé|$)/i)?.[1]??"";
  const description=descBlock.replace(/!\[[^\]]*\]\([^)]*\)/g," ").replace(/\[([^\]]+)\]\([^)]*\)/g,"$1").replace(/\s+/g," ").trim().slice(0,12000)||null;
  const pricePatterns=[/(?:^|\n)\s*(?:Prix(?:\s+TTC)?\s*[:\-]?\s*)?([0-9][0-9\s\u00a0\u202f.,]*)\s*€\s*(?:\n|$)/mi,/(?:^|\n)\s*Prix\s*[:\-]?\s*€\s*([0-9][0-9\s\u00a0\u202f.,]*)/mi];let priceMinor:number|null=null;for(const rx of pricePatterns){const priceMatch=markdown.match(rx);if(!priceMatch?.[1])continue;const n=Number(priceMatch[1].replace(/[\s\u00a0\u202f]/g,"").replace(",","."));if(Number.isFinite(n)&&n>=0){priceMinor=Math.round(n*100);break}}
  const city=(markdown.match(/^\[([^\]]+)\]\(https?:\/\/www\.leboncoin\.fr\/ad\/[^)#]+#map\)/m)?.[1]??markdown.match(/(?:Localisation|Lieu)\s*[:\-]?\s*([^\n]{2,120})/i)?.[1]??"").replace(/\b\d{5}\b/g,"").trim()||null;
  const postalCode=(markdown.match(/(?:code postal|postal code)\s*[:\-]?\s*([0-9]{5})/i)?.[1]??markdown.match(/\b([0-9]{5})\b/)?.[1]??"").trim()||null;
  const imageUrls=readerListingImages(markdown,title);
  return {sourceUrl:url,title,description,priceMinor,imageUrl:imageUrls[0]??null,imageUrls,city,postalCode,histovecUrl:extractHistovecShareUrl(markdown),source:"leboncoin-reader",sourceFields:{...readerSummaryFields(markdown),...readerKeyFields(markdown)}};
}
function findLeboncoinAd(value:unknown):any|null{
  const stack:unknown[]=[value];let seen=0;let best:any|null=null;let bestScore=0;
  while(stack.length&&seen<70000){seen++;const item=stack.pop();if(!item)continue;if(Array.isArray(item)){for(const v of item)stack.push(v);continue}if(typeof item!=="object")continue;const obj=item as Record<string,unknown>;const subject=obj.subject??obj.title;const id=obj.list_id??obj.listId??obj.ad_id??obj.id;let score=0;if((typeof id==="number"||typeof id==="string")&&String(id).length>=5)score+=4;if(typeof subject==="string"&&subject.trim().length>=3)score+=5;if(typeof (obj.body??obj.description)==="string")score+=3;if(obj.images||obj.photos)score+=3;if(obj.price!==undefined||obj.price_cents!==undefined||obj.priceCents!==undefined)score+=2;if(obj.attributes||obj.ad_attributes||obj.params)score+=2;if(obj.location||obj.address)score+=1;if(score>bestScore&&typeof subject==="string"){best=obj;bestScore=score}for(const v of Object.values(obj))stack.push(v)}
  return bestScore>=7?best:null;
}
function nextDataAd(html:string){
  const scripts=[...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)];
  for(const match of scripts){const attrs=match[1]??"",raw=(match[2]??"").trim();if(!raw||raw.length>MAX_HTML_BYTES)continue;const likely=/__NEXT_DATA__|application\/json/i.test(attrs)||/"(?:list_id|listId|subject|ad_id)"\s*:/.test(raw);if(!likely)continue;const candidates=[raw];const first=raw.indexOf("{"),last=raw.lastIndexOf("}");if(first>0&&last>first)candidates.push(raw.slice(first,last+1));for(const candidate of candidates){try{const ad=findLeboncoinAd(JSON.parse(candidate));if(ad)return ad}catch{}}}
  return null;
}
async function resolveReference(source:string,reference:string){
  if(source==="leboncoin"){
    const id=reference.replace(/\D/g,"");if(id.length<6)throw new Error("reference_not_found");
    const search=`https://www.leboncoin.fr/recherche?text=${encodeURIComponent(id)}`;
    try{
      const html=await fetchHtml(search);
      const links=[...html.matchAll(/href=["']([^"']*\/ad\/[^"']+)["']/gi)].map(m=>decode(m[1]??"")).filter(x=>x.includes(id));
      if(links[0])return new URL(links[0],"https://www.leboncoin.fr").toString();
    }catch{}
    try{
      const markdown=await fetchLeboncoinReader(search);
      const links=[...markdown.matchAll(/\((https?:\/\/www\.leboncoin\.fr\/ad\/[^)\s]+)\)/gi)].map(m=>m[1]??"").filter(x=>x.includes(id));
      if(links[0])return links[0];
    }catch{}
    throw new Error("reference_not_found");
  }
  throw new Error("reference_source_unsupported");
}
function sanitizedPreview<T extends {sourceUrl:string;description:string|null}>(preview:T):T{
  return {...preview,description:cleanImportedDescription(preview.description,preview.sourceUrl)};
}
function manualImportPreview(url:string){return {sourceUrl:url,title:null,description:null,priceMinor:null,imageUrl:null,imageUrls:[],city:null,postalCode:null,histovecUrl:null,suggestedCategorySlug:null,suggestionReason:null,detectedFields:{},manualRequired:true};}
function summarizePastedListingText(input:string,sourceUrl?:string|null,sourcePlatform:"facebook"|"leboncoin"|"other"="other"){
  const raw=input.replace(/\r/g,"").trim().slice(0,30000);const lines=raw.split("\n").map(x=>x.replace(/\s+/g," ").trim()).filter(Boolean);
  const noise=/^(facebook|marketplace|facebook marketplace|leboncoin|le bon coin|partager|share|enregistrer|save|envoyer un message|message|contacter|contact|voir le profil|seller details|détails du vendeur|à propos de ce vendeur|about this seller|connexion|log in|se connecter)$/i;
  const meaningful=lines.filter(line=>!noise.test(line)&&!/^https?:\/\//i.test(line));
  let priceMinor:number|null=null;for(const line of meaningful){const m=line.match(/(?:prix\s*[:\-]?\s*)?([0-9][0-9\s\u00a0\u202f.,]*)\s*(?:€|eur)(?:\s|$)/i)||line.match(/(?:€|eur)\s*([0-9][0-9\s\u00a0\u202f.,]*)\b/i);if(!m?.[1])continue;const n=Number(m[1].replace(/[\s\u00a0\u202f]/g,"").replace(",","."));if(Number.isFinite(n)&&n>=0){priceMinor=Math.round(n*100);break}}
  const postalCode=raw.match(/\b([0-9]{5})\b/)?.[1]??null;let city:string|null=null;
  for(const line of meaningful){const m=line.match(/^(?:lieu|localisation|location|mis en vente à|listed in)\s*[:\-]?\s*(.+)$/i);if(m?.[1]){city=m[1].replace(/\b\d{5}\b/g,"").replace(/^[,\s-]+|[,\s-]+$/g,"").trim().slice(0,120)||null;if(city)break}}
  if(!city&&postalCode){const hit=meaningful.find(line=>line.includes(postalCode));if(hit)city=hit.replace(postalCode,"").replace(/^(?:lieu|localisation|location)\s*[:\-]?/i,"").replace(/^[,\s-]+|[,\s-]+$/g,"").trim().slice(0,120)||null}
  const descriptionIndex=meaningful.findIndex(line=>/^(?:description|détails|details)\s*[:\-]?$/i.test(line));let description:string|null=null;
  if(descriptionIndex>=0){const parts:string[]=[];for(const line of meaningful.slice(descriptionIndex+1)){if(/^(?:lieu|localisation|location|vendeur|seller|état|condition)\s*[:\-]?/i.test(line)&&parts.length)break;parts.push(line);if(parts.join(" ").length>=12000)break}description=parts.join(" ").trim().slice(0,12000)||null}
  const excluded=(line:string)=>noise.test(line)||/^(?:description|détails|details|prix|lieu|localisation|location|mis en vente à|listed in)\s*[:\-]?/i.test(line)||/(?:€|eur)\b/i.test(line)||/^\d{5}\b/.test(line);
  const title=(meaningful.find(line=>!excluded(line)&&line.length>=5&&line.length<=120)??"").slice(0,120)||null;
  if(!description){const parts=meaningful.filter(line=>line!==title&&!excluded(line)).slice(0,25);description=parts.join(" ").trim().slice(0,12000)||null}
  return {sourceUrl:sourceUrl??null,title,description,priceMinor,imageUrl:null,imageUrls:[],city,postalCode,source:`${sourcePlatform}-pasted`,manualRequired:false};
}
function usableImportPreview(preview:{title:string|null;description:string|null;priceMinor:number|null;imageUrls?:string[]}){
  const title=normalizeMatch(preview.title??"");
  if(!title||["leboncoin fr","leboncoin","facebook","marketplace","facebook marketplace","marketplace facebook"].includes(title))return false;
  return Boolean((preview.description??"").trim().length>=10||preview.priceMinor!==null||(preview.imageUrls?.length??0)>0);
}
function summarizeLeboncoinAdObject(ad:any,url:string,source="leboncoin-api"){
  const images=ad?.images&&typeof ad.images==="object"?ad.images:{};const media=ad?.media&&typeof ad.media==="object"?ad.media:{};const photos=Array.isArray(ad?.photos)?ad.photos:[];
  const imageCandidates=[...(Array.isArray(images.urls_large)?images.urls_large:[]),...(Array.isArray(media.urls_large)?media.urls_large:[]),...(Array.isArray(images.urls)?images.urls:[]),...(Array.isArray(media.urls)?media.urls:[]),...(Array.isArray(media.all_urls)?media.all_urls:[]),...(Array.isArray(images.urls_small)?images.urls_small:[]),...(Array.isArray(media.urls_small)?media.urls_small:[]),...(Array.isArray(images.urls_thumb)?images.urls_thumb:[]),...(Array.isArray(media.urls_thumb)?media.urls_thumb:[]),images.small_url,images.thumb_url,media.small_url,media.thumb_url,...photos.flatMap((photo:any)=>[photo?.url,photo?.large_url,photo?.urls?.large,photo?.urls?.medium]),...collectLeboncoinImageUrls([ad?.images,ad?.media,ad?.photos,ad?.image])].filter((x):x is string=>typeof x==="string"&&x.startsWith("http"));
  const location=(ad?.location&&typeof ad.location==="object"?ad.location:ad?.address&&typeof ad.address==="object"?ad.address:{});
  const locationLabel=String(location.city_label??location.label??location.name??"").trim();
  const labelPostal=locationLabel.match(/\b([0-9]{5})\b/)?.[1]??null;
  const explicitCity=String(location.city??location.addressLocality??ad?.city??"").trim();
  const inferredCity=!explicitCity&&locationLabel?(labelPostal?locationLabel.split(labelPostal)[0]!.trim():locationLabel):"";
  const normalizedCity=(explicitCity||inferredCity).replace(/\s+\d{5}(?:\s+.*)?$/," ").replace(/\s{2,}/g," ").trim();
  const normalizedPostal=String(location.zipcode??location.postal_code??location.postalCode??ad?.zipcode??labelPostal??"").trim();
  const pc=Number(ad?.price_cents??ad?.priceCents);const rawPrice=Array.isArray(ad?.price)?ad.price[0]:ad?.price&&typeof ad.price==="object"?(ad.price.amount??ad.price.value??ad.price.price):ad?.price;const p=Number(rawPrice);
  const priceMinor=Number.isFinite(pc)&&pc>=0?Math.round(pc):Number.isFinite(p)&&p>=0?Math.round(p*100):null;
  const imageUrls=cleanLeboncoinImageUrls(imageCandidates.map(url=>({url})));
  const subject=String(ad?.subject??ad?.title??"").trim().slice(0,120)||null;const body=String(ad?.body??ad?.description??ad?.description_text??"").trim().slice(0,12000)||null;
  const city=normalizedCity||null;const postalCode=/^[0-9]{5}$/.test(normalizedPostal)?normalizedPostal:null;
  return {sourceUrl:url,title:subject,description:body,priceMinor,imageUrl:imageUrls[0]??null,imageUrls,city,postalCode,histovecUrl:extractHistovecShareUrl(JSON.stringify(ad)),source,sourceFields:adStructuredFields(ad)};
}
function summarize(html:string,url:string){
  const ad=nextDataAd(html);
  if(ad){
    const preview=summarizeLeboncoinAdObject(ad,url,"leboncoin-embedded-data");
    if(preview.priceMinor===null)preview.priceMinor=parsePrice(html);
    if(!preview.histovecUrl)preview.histovecUrl=extractHistovecShareUrl(html);
    return preview;
  }
  const rawTitle=(meta(html,"og:title")||meta(html,"twitter:title")||titleTag(html)).slice(0,180);
  const sourceHost=(()=>{try{return new URL(url).hostname.toLowerCase()}catch{return""}})();
  const isFacebookSource=isFacebookHost(sourceHost);const title=(isFacebookSource?cleanFacebookTitle(rawTitle):rawTitle.slice(0,120))??"";
  const description=(meta(html,"og:description")||meta(html,"description")||"").slice(0,12000);
  const rawImage=meta(html,"og:image")||meta(html,"twitter:image");
  const isLeboncoinSource=sourceHost==="leboncoin.fr"||sourceHost.endsWith(".leboncoin.fr");
  const image=isLeboncoinSource&&rawImage?normalizeLeboncoinImageUrl(rawImage):rawImage;
  const priceMinor=parsePrice(html);const location=parseLocation(html);
  const imageUrls=image?[image]:[];
  return {sourceUrl:url,title:title||null,description:description||null,priceMinor,imageUrl:image||null,imageUrls,city:location.city,postalCode:location.postalCode,histovecUrl:extractHistovecShareUrl(html),source:"metadata"};
}


function mergeImportPreview(base:any|null,supplement:any|null){
  if(!base)return supplement;if(!supplement)return base;
  const imageUrls=[...(base.imageUrls??[]),...(supplement.imageUrls??[])].filter((value:string,index:number,all:string[])=>Boolean(value)&&all.indexOf(value)===index).slice(0,20);
  const baseDescription=String(base.description??"").trim(),supplementDescription=String(supplement.description??"").trim();
  return {
    ...supplement,...base,
    title:base.title??supplement.title??null,
    description:(baseDescription.length>=supplementDescription.length?baseDescription:supplementDescription)||null,
    priceMinor:base.priceMinor??supplement.priceMinor??null,
    imageUrls,imageUrl:imageUrls[0]??base.imageUrl??supplement.imageUrl??null,
    city:base.city??supplement.city??null,postalCode:base.postalCode??supplement.postalCode??null,
    histovecUrl:base.histovecUrl??supplement.histovecUrl??null,
    sourceFields:{...(supplement.sourceFields??{}),...(base.sourceFields??{})},manualRequired:false,
  };
}
async function enrichedLeboncoinPreview(url:string,base:any|null){
  let merged=base;
  try{const ad=await fetchLeboncoinApiAd(url);merged=mergeImportPreview(sanitizedPreview(summarizeLeboncoinAdObject(ad,url,"leboncoin-api")),merged);}catch{}
  try{const extracted=await fetchViaWebExtraction(url);if(extracted)merged=mergeImportPreview(merged,sanitizedPreview(summarize(extracted,url)));}catch{}
  try{const markdown=await fetchLeboncoinReader(url);merged=mergeImportPreview(merged,sanitizedPreview(summarizeReader(markdown,url)));}catch{}
  return merged;
}

function normalizeMatch(value:string){return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()}
function sourceCategorySlug(url:string,title:string|null,description:string|null){
  let source="";try{source=new URL(url).pathname.toLowerCase().match(/\/ad\/([^/]+)/)?.[1]??""}catch{return null}
  const titleText=normalizeMatch(title??"");const text=normalizeMatch(`${title??""} ${description??""}`);const has=(...terms:string[])=>terms.some(t=>text.includes(normalizeMatch(t)));const titleHas=(...terms:string[])=>terms.some(t=>titleText.includes(normalizeMatch(t)));
  const direct:Record<string,string>={tablettes_liseuses:"tablettes-liseuses",consoles:"consoles",jeux_video:"jeux-video",ameublement:"meubles",arts_de_la_table:"arts-de-la-table",decoration:"decoration",linge_de_maison:"linge-de-maison",papeterie_fournitures_scolaires:"papeterie-fournitures-scolaires",bricolage:"bricolage",jardinage:"jardin-exterieur",jardin_plantes:"jardin-exterieur",electromenager:"electromenager",informatique:"accessoires-informatique",accessoires_informatique:"accessoires-informatique",ordinateurs:"ordinateurs",telephones_objets_connectes:"telephones-smartphones",accessoires_telephone_objets_connectes:"accessoires-telephone-objets-connectes",photo_audio_video:"photo-video",livres:"livres-bd",cd_musique:"films-musique",dvd_films:"films-musique",instruments_de_musique:"instruments-musique",jeux_jouets:"jouets-jeux",collection:"collection",antiquites:"antiquites",modelisme:"modelisme",vins_gastronomie:"vins-gastronomie",equipement_bebe:"equipement-bebe",mobilier_enfant:"mobilier-enfant",chaussures:"chaussures",montres_bijoux:"montres-bijoux",sacs_accessoires:"sacs-accessoires",velos:"velos",nautisme:"nautisme",pieces_auto:"pieces-accessoires-auto",equipement_auto:"pieces-accessoires-auto",animaux:"animaux",chiens_chats:"animaux",emploi:"emploi",services:"services",baby_sitting:"baby-sitting",covoiturage:"covoiturage",cours_particuliers:"cours-particuliers",services_aux_animaux:"services-animaux",reparations_electroniques:"reparations-electroniques",reparations_mecaniques:"reparations-mecaniques"};
  if(direct[source])return direct[source];
  if(source==="sport_plein_air"){
    if(titleHas("chaussure","chaussures","basket","baskets","botte","bottes"))return "chaussures";
    if(has("vtt"))return "vtt";if(has("velo electrique","vélo électrique","vae"))return "velos-electriques";if(has("velo","vélo","cyclisme"))return "velos";if(has("peche","pêche","canne a peche","canne à pêche"))return "peche";if(has("musculation","fitness","halteres","haltères"))return "fitness-musculation";return "camping-randonnee";
  }
  if(source==="antiquites")return titleHas("chaise","chaises","table","commode","armoire","buffet","fauteuil","meuble","meubles")?"meubles":"collection";
  if(source==="vetements"){
    if(titleHas("enfant","bébé","bebe","garçon","garcon","fille"))return "vetements-enfant";
    if(titleHas("homme","costume","chemise homme","pantalon homme"))return "vetements-homme";
    if(titleHas("femme","robe","jupe","soutien gorge","soutien-gorge"))return "vetements-femme";
    return null;
  }
  if(source==="voitures"){
    if(has("suv","crossover"))return "voitures-suv";if(has("break"))return "voitures-breaks";if(has("citadine"))return "voitures-citadines";if(has("cabriolet","coupé","coupe"))return "voitures-coupes-cabriolets";if(has("monospace"))return "voitures-monospaces";if(has("hybride"))return "voitures-hybrides";if(has("electrique","électrique"))return "voitures-electriques";if(has("utilitaire","fourgon","caddy","camionnette"))return "utilitaires";return "voitures";
  }
  if(source==="motos")return "motos";if(source==="scooters")return "scooters";if(source==="utilitaires")return "utilitaires";if(source==="caravaning")return "camping-cars-caravanes";
  if(source==="ventes_immobilieres")return titleHas("terrain")?"terrains":titleHas("garage","parking")?"parkings-garages":titleHas("bureau","local commercial","fonds de commerce")?"bureaux-commerces":"vente-immobilier";
  if(source==="locations")return "location-immobilier";if(source==="locations_gites")return "locations-saisonnieres";if(source==="bureaux_commerces")return "bureaux-commerces";
  return null;
}
function suggestCategorySlug(url:string,title:string|null,description:string|null){
  const sourceMatch=sourceCategorySlug(url,title,description);if(sourceMatch)return sourceMatch;
  const path=new URL(url).pathname.toLowerCase();
  const titleText=normalizeMatch(title??"");
  const text=normalizeMatch(`${title??""} ${description??""}`);
  const has=(...terms:string[])=>terms.some(t=>text.includes(normalizeMatch(t)));
  const titleHas=(...terms:string[])=>terms.some(t=>titleText.includes(normalizeMatch(t)));
  const realEstatePath=/\/ad\/(?:ventes_immobilieres|locations|locations_gites|bureaux_commerces|immobilier)(?:\/|$)/.test(path)||path.includes("immobilier");
  const strongRealEstateTitle=titleHas("appartement","studio","terrain constructible","maison à vendre","maison a vendre","maison en vente","villa à vendre","villa a vendre","local commercial","fonds de commerce","parking à vendre","garage à vendre","garage a vendre");
  if(path.includes("/ad/voitures")||has("voiture","automobile")){
    if(has("suv","crossover"))return "voitures-suv";if(has("break"))return "voitures-breaks";if(has("citadine"))return "voitures-citadines";if(has("cabriolet","coupé","coupe"))return "voitures-coupes-cabriolets";if(has("monospace"))return "voitures-monospaces";if(has("hybride rechargeable","hybride"))return "voitures-hybrides";if(has("électrique","electrique"))return "voitures-electriques";return "voitures";
  }
  if(path.includes("/ad/motos")||has("moto ","motocycle"))return "motos";
  if(path.includes("/ad/scooters")||has("scooter"))return "scooters";
  if(path.includes("/ad/utilitaires")||has("utilitaire","fourgon","camionnette"))return "utilitaires";
  if(has("camping car","camping-car","caravane"))return "camping-cars-caravanes";
  if(realEstatePath||strongRealEstateTitle){
    if(path.includes("locations")||titleHas("location","à louer","a louer")||has("loyer"))return "location-immobilier";
    if(titleHas("terrain constructible","terrain à vendre","terrain a vendre")||path.includes("terrains"))return "terrains";
    if(titleHas("garage à vendre","garage a vendre","parking à vendre","parking a vendre")||path.includes("parkings"))return "parkings-garages";
    if(titleHas("bureau","local commercial","fonds de commerce")||path.includes("bureaux_commerces"))return "bureaux-commerces";
    return "vente-immobilier";
  }
  if(has("iphone"))return "apple-iphone";if(has("galaxy"))return "samsung-galaxy";if(has("pixel"))return "google-pixel";if(has("xiaomi","redmi","poco"))return "xiaomi-redmi-poco";
  if(has("smartphone","telephone","téléphone"))return "telephones-smartphones";if(has("macbook"))return "macbook";if(has("pc gamer","ordinateur portable","laptop"))return "ordinateurs-portables";
  if(has("lave linge","lave-linge"))return "lave-linge";if(has("lave vaisselle","lave-vaisselle"))return "lave-vaisselle";if(has("réfrigérateur","refrigerateur","congélateur","congelateur"))return "refrigerateurs-congelateurs";if(has("aspirateur"))return "aspirateurs";if(has("four ","plaque induction","plaque cuisson"))return "fours-plaques";if(has("canapé","canape","table ","chaise","armoire","meuble"))return "meubles";
  if(has("chaussure","baskets","sneakers"))return "chaussures";if(has("robe","jupe","femme"))return "vetements-femme";if(has("homme","pantalon","chemise"))return "vetements-homme";if(has("sac ","sac à main","sac a main"))return "sacs-accessoires";
  if(has("emploi","cdi","cdd","recrute","recherche serveur","recherche vende"))return "emploi";if(has("service","dépannage","depannage","ménage","menage","déménagement","demenagement"))return "services";
  if(has("chiot","chien"))return "chiens";if(has("chaton","chat "))return "chats";if(has("vélo","velo","vtt"))return has("vtt")?"vtt":"velos";
  return null;
}
function categorySuggestionReason(slug:string|null,url:string,title:string|null,description:string|null){
  if(!slug)return null;
  const host=(()=>{try{return new URL(url).hostname.replace(/^www\./,"")}catch{return"source"}})();
  const label=slug.replace(/-/g," ");
  return `Suggestion basée sur la catégorie source et les mots-clés détectés (${label}) depuis ${host}.`;
}

function inferCommonImportedValues(title:string|null,description:string|null){
  const raw=`${title??""} ${description??""}`;const text=normalizeMatch(raw);const out:Record<string,string|number|boolean>={};
  const brands=["Apple","Samsung","Google","Xiaomi","Honor","OnePlus","Huawei","Oppo","Motorola","Nothing","Sony","LG","Bosch","Siemens","Whirlpool","Dyson","Nike","Adidas","Puma","Renault","Peugeot","Citroën","Volkswagen","BMW","Mercedes","Audi","Toyota","Ford","Dacia","Tesla","Nissan","Kia","Hyundai"];
  const brand=brands.find(b=>new RegExp(`(^|[^a-z0-9])${normalizeMatch(b).replace(/ /g,"\\s+")}([^a-z0-9]|$)`).test(text));if(brand)out.brand=brand;
  const shoe=raw.match(/(?:pointure|taille)\s*[:\-]?\s*(3[5-9]|4[0-9]|5[0-2])\b/i);if(shoe)out.shoeSize=Number(shoe[1]);
  const screen=raw.match(/(?:écran|ecran|tv|téléviseur|televiseur)?\s*(\d{2,3}(?:[.,]\d+)?)\s*(?:pouces|")/i);if(screen?.[1])out.screenSize=Number(screen[1].replace(",","."));
  const storage=raw.match(/\b(64|128|256|512|1024|2048)\s*(?:go|gb)\b/i);if(storage)out.storage=Number(storage[1]);
  const ram=raw.match(/\b(4|6|8|12|16|24|32|48|64|128)\s*(?:go|gb)\s*(?:ram|mémoire|memoire)\b/i)||raw.match(/(?:ram|mémoire|memoire)\s*[:\-]?\s*(4|6|8|12|16|24|32|48|64|128)\s*(?:go|gb)/i);if(ram)out.ram=Number(ram[1]);
  if(/\b4k(?:\s*uhd)?\b/i.test(raw))out.resolution="4K UHD";else if(/\b8k\b/i.test(raw))out.resolution="8K";else if(/full\s*hd/i.test(raw))out.resolution="Full HD";
  const size=raw.match(/(?:taille|size)\s*[:\-]?\s*(XXS|XS|S|M|L|XL|XXL|3XL)\b/i);if(size?.[1])out.size=size[1].toUpperCase();
  if(/\bneuf(?:ve)?\b/i.test(raw))out.condition="Neuf";else if(/tr[èe]s bon [ée]tat/i.test(raw))out.condition="Très bon état";else if(/bon [ée]tat/i.test(raw))out.condition="Bon état";
  const propertyType=raw.match(/\b(appartement|maison|terrain|parking|garage|local commercial|bureau|immeuble)\b/i)?.[1];if(propertyType)out.propertyType=/garage/i.test(propertyType)?"Parking":propertyType.charAt(0).toUpperCase()+propertyType.slice(1).toLowerCase();
  const surface=raw.match(/(?:surface\s*[:\-]?\s*)?(\d{1,5}(?:[.,]\d+)?)\s*m(?:²|2)(?![a-z0-9])/i)?.[1];if(surface)out.surface=Number(surface.replace(",","."));
  const rooms=raw.match(/\b(\d{1,2})\s*pi[eè]ces?\b/i)?.[1];if(rooms)out.rooms=Number(rooms);
  const bedrooms=raw.match(/\b(\d{1,2})\s*chambres?\b/i)?.[1];if(bedrooms)out.bedrooms=Number(bedrooms);
  const floor=raw.match(/(?:^|\s)Étage\s*(\d{1,2})(?:\s*\/\s*(\d{1,2}))?/im);if(floor?.[1])out.floor=Number(floor[1]);if(floor?.[2])out.totalFloors=Number(floor[2]);
  if(/\bRDC\b/i.test(raw))out.floor=0;
  const outdoor=["Balcon","Terrasse","Jardin","Piscine"].filter(label=>new RegExp(`\\b${label}\\b`,"i").test(raw));if(outdoor.length)out.outdoor=outdoor.join(",");
  if(/\b(?:parking|garage)\b/i.test(raw))out.parking=true;if(/\bascenseur\b/i.test(raw)&&!/sans ascenseur/i.test(raw))out.elevator=true;
  const heating=raw.match(/(?:chauffage|type de chauffage)\s*[:\-]?\s*(électrique|electrique|gaz|fioul|bois|pompe à chaleur|pompe a chaleur|collectif)/i)?.[1];if(heating)out.heating=/electrique/i.test(heating)?"Électrique":/pompe/i.test(heating)?"Pompe à chaleur":heating.charAt(0).toUpperCase()+heating.slice(1).toLowerCase();
  return out;
}
async function applyImportedCommonAttributes(listingId:string,categoryId:string,title:string|null,description:string|null,sourceHints:Record<string,string|number|boolean>={}){
  const hints={...inferCommonImportedValues(title,description),...sourceHints};
  const raw=`${title??""}\n${description??""}`;
  const explicitBrand=raw.match(/\bmarque\s*[:\-]\s*([A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9 .&\'+-]{1,60}?)(?=\s+-\s+(?:mod[eè]le|taille|couleur|cadre|[ée]tat)\s*:|[\r\n]|$)/i)?.[1]?.trim();
  if(explicitBrand&&normalizeMatch(explicitBrand)!=="autre")hints.brand=explicitBrand;
  if(/\bv[ée]lo\s+de\s+route\b/i.test(raw))hints.bikeType="Route";
  else if(/\bgravel\b/i.test(raw))hints.bikeType="Gravel";
  else if(/\bvtt\b|\bmountain\s*bike\b/i.test(raw))hints.bikeType="VTT";
  else if(/\bbmx\b/i.test(raw))hints.bikeType="BMX";
  else if(/\bv[ée]lo\s+(?:de\s+)?ville\b/i.test(raw))hints.bikeType="Ville";
  if(!Object.keys(hints).length)return 0;
  const defs=await prisma.categoryAttribute.findMany({where:{categoryId},include:{options:true}});let saved=0;
  const findOption=(options:Array<{value:string;label:string}>,raw:unknown)=>{const wanted=normalizeMatch(String(raw));if(!wanted)return null;const exact=options.find(o=>normalizeMatch(o.value)===wanted||normalizeMatch(o.label)===wanted);if(exact)return exact;return [...options].sort((a,b)=>Math.max(normalizeMatch(b.value).length,normalizeMatch(b.label).length)-Math.max(normalizeMatch(a.value).length,normalizeMatch(a.label).length)).find(o=>{const value=normalizeMatch(o.value),label=normalizeMatch(o.label);return (value.length>2&&(wanted.includes(value)||value.includes(wanted)))||(label.length>2&&(wanted.includes(label)||label.includes(wanted)))})??null};
  const boolish=(raw:unknown)=>{if(typeof raw==="boolean")return raw;const v=normalizeMatch(String(raw??""));if(/^(oui|yes|true|present|avec|1)\b/.test(v))return true;if(/^(non|no|false|sans|aucun|aucune|0)\b/.test(v))return false;return null};
  for(const def of defs){let value=hints[def.key];if(value===undefined)continue;
    const data:any={valueText:null,valueNumber:null,valueBoolean:null,valueJson:null};
    if(def.type==="NUMBER"){const n=Number(value);if(!Number.isFinite(n))continue;data.valueNumber=n;}
    else if(def.type==="BOOLEAN"){const b=boolish(value);if(b===null)continue;data.valueBoolean=b;}
    else if(def.type==="SELECT"){const option=findOption(def.options,value);if(!option)continue;data.valueText=option.value;}
    else if(def.type==="MULTISELECT"){
      const rawValues=String(value).split(/[,;|]/).map(x=>x.trim()).filter(Boolean);const selected=rawValues.map(v=>findOption(def.options,v)?.value).filter((v):v is string=>Boolean(v));const unique=[...new Set(selected)];if(!unique.length)continue;data.valueJson=unique;
    }
    else if(def.type==="TEXT"||def.type==="DATE"){data.valueText=String(value).slice(0,1000);} else continue;
    await prisma.listingAttributeValue.upsert({where:{listingId_attributeId:{listingId,attributeId:def.id}},create:{listingId,attributeId:def.id,...data},update:data});saved++;
  }
  return saved;
}

const IMPORT_IMAGE_TYPES=new Map([["image/jpeg","jpg"],["image/png","png"],["image/webp","webp"],["image/avif","avif"]]);
const MAX_IMPORT_IMAGE_BYTES=15*1024*1024;
async function importImageToListing(listingId:string, rawUrl:string, index:number, sourceUrl:string){
  if(!storageConfigured())throw new Error("object_storage_not_configured");
  const source=(await safeUrl(sourceUrl));const sourceHost=source.hostname.toLowerCase();const sourceIsLeboncoin=sourceHost==="leboncoin.fr"||sourceHost.endsWith(".leboncoin.fr");
  const effectiveUrl=sourceIsLeboncoin?normalizeLeboncoinImageUrl(rawUrl):rawUrl;if(!effectiveUrl)throw new Error("image_not_listing_photo");
  let current=(await safeUrl(effectiveUrl)).toString();let response:Response|null=null;
  for(let redirects=0;redirects<4;redirects++){
    const u=await safeUrl(current);const host=u.hostname.toLowerCase();if(!allowedImportImageHost(sourceHost,host))throw new Error("image_host_not_allowed");
    const r=await fetch(u,{redirect:"manual",headers:{"user-agent":BROWSER_HEADERS["user-agent"],accept:"image/avif,image/webp,image/apng,image/*,*/*;q=0.8","accept-language":"fr-FR,fr;q=0.9",referer:source.toString()},signal:AbortSignal.timeout(12000)});
    if(r.status>=300&&r.status<400){const location=r.headers.get("location");if(!location)throw new Error(`image_http_${r.status}`);const next=(await safeUrl(new URL(location,u).toString()));if(!allowedImportImageHost(sourceHost,next.hostname.toLowerCase()))throw new Error("image_redirect_host_not_allowed");current=next.toString();continue}
    response=r;break;
  }
  if(!response)throw new Error("image_too_many_redirects");if(!response.ok)throw new Error(`image_http_${response.status}`);
  const type=(response.headers.get("content-type")??"").split(";")[0]!.trim().toLowerCase();const ext=IMPORT_IMAGE_TYPES.get(type);if(!ext)throw new Error("unsupported_image_type");
  const declared=Number(response.headers.get("content-length")??0);if(declared>MAX_IMPORT_IMAGE_BYTES)throw new Error("image_too_large");
  const reader=response.body?.getReader();if(!reader)throw new Error("image_empty");let total=0;const chunks:Buffer[]=[];
  while(true){const {done,value}=await reader.read();if(done)break;if(!value)continue;total+=value.length;if(total>MAX_IMPORT_IMAGE_BYTES){reader.cancel().catch(()=>{});throw new Error("image_too_large")}chunks.push(Buffer.from(value));}
  const buf=Buffer.concat(chunks);if(!buf.length)throw new Error("image_empty");
  const metadata=await sharp(buf,{failOn:"none"}).metadata();const width=Number(metadata.width??0),height=Number(metadata.height??0);
  const sourceIsFacebook=isFacebookHost(sourceHost);
  const minWidth=sourceIsFacebook?240:320,minHeight=sourceIsFacebook?180:240,minArea=sourceIsFacebook?120000:240000,minEdge=sourceIsFacebook?480:600;
  if(!width||!height||width<minWidth||height<minHeight||width*height<minArea||Math.max(width,height)<minEdge)throw new Error("image_quality_too_low");
  const ratio=Math.max(width/height,height/width);if(ratio>4.5)throw new Error("image_not_listing_photo");
  const mediaId=randomUUID();const objectKey=`listings/${listingId}/${mediaId}.${ext}`;const publicUrl=await uploadStoredObject(objectKey,type,buf);
  await prisma.$executeRawUnsafe(`INSERT INTO "ListingMedia" ("id","listingId","objectKey","publicUrl","mimeType","sizeBytes","status","sortOrder","isCover","altText","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,'READY',$7,$8,$9,NOW(),NOW())`,mediaId,listingId,objectKey,publicUrl,type,buf.length,index*10,index===0,"Photo importée");
  return publicUrl;
}
export async function importListingImages(listingId:string, urls:string[], sourceUrl:string){
  const unique=[...new Set(urls)].slice(0,20);let imported=0;const failures:string[]=[];
  for(const url of unique){try{await importImageToListing(listingId,url,imported,sourceUrl);imported++;}catch(e){failures.push(e instanceof Error?e.message:"image_import_failed");}}
  return {imported,failed:failures.length,reasons:[...new Set(failures)].slice(0,5)};
}
async function fetchImportPreviewImage(rawUrl:string,sourceUrl:string){
  const source=await safeUrl(sourceUrl);const sourceHost=source.hostname.toLowerCase();const sourceIsLeboncoin=sourceHost==="leboncoin.fr"||sourceHost.endsWith(".leboncoin.fr");
  const effectiveUrl=sourceIsLeboncoin?normalizeLeboncoinImageUrl(rawUrl):rawUrl;if(!effectiveUrl)throw new Error("image_not_listing_photo");
  let current=(await safeUrl(effectiveUrl)).toString();let response:Response|null=null;
  for(let redirects=0;redirects<4;redirects++){
    const u=await safeUrl(current);if(!allowedImportImageHost(sourceHost,u.hostname.toLowerCase()))throw new Error("image_host_not_allowed");
    const r=await fetch(u,{redirect:"manual",headers:{"user-agent":BROWSER_HEADERS["user-agent"],accept:"image/avif,image/webp,image/apng,image/*,*/*;q=0.8","accept-language":"fr-FR,fr;q=0.9",referer:source.toString()},signal:AbortSignal.timeout(12000)});
    if(r.status>=300&&r.status<400){const location=r.headers.get("location");if(!location)throw new Error(`image_http_${r.status}`);const next=await safeUrl(new URL(location,u).toString());if(!allowedImportImageHost(sourceHost,next.hostname.toLowerCase()))throw new Error("image_redirect_host_not_allowed");current=next.toString();continue}
    response=r;break;
  }
  if(!response||!response.ok)throw new Error(`image_http_${response?.status??502}`);
  const type=(response.headers.get("content-type")??"").split(";")[0]!.trim().toLowerCase();if(!IMPORT_IMAGE_TYPES.has(type))throw new Error("unsupported_image_type");
  const declared=Number(response.headers.get("content-length")??0);if(declared>MAX_IMPORT_IMAGE_BYTES)throw new Error("image_too_large");
  const reader=response.body?.getReader();if(!reader)throw new Error("image_empty");let total=0;const chunks:Buffer[]=[];
  while(true){const {done,value}=await reader.read();if(done)break;if(!value)continue;total+=value.length;if(total>MAX_IMPORT_IMAGE_BYTES){reader.cancel().catch(()=>{});throw new Error("image_too_large")}chunks.push(Buffer.from(value));}
  const buf=Buffer.concat(chunks);if(!buf.length)throw new Error("image_empty");return{buf,type};
}

const VEHICLE_BRANDS=["Volkswagen","Renault","Peugeot","Citroën","Citroen","BMW","Mercedes-Benz","Mercedes","Audi","Toyota","Ford","Opel","Fiat","Dacia","Nissan","Hyundai","Kia","Volvo","Seat","Skoda","Mazda","Honda","Tesla","Mini","Jeep","Land Rover","Porsche","Alfa Romeo","Suzuki","Mitsubishi"] as const;
const VEHICLE_COLORS=["Noir","Blanc","Gris","Argent","Bleu","Rouge","Vert","Beige","Marron","Orange","Jaune","Violet"] as const;
function extractVehicleHints(title:string|null|undefined,description:string|null|undefined){
  const text=`${title??""}\n${description??""}`.replace(/\u00a0/g," ");const lower=text.toLocaleLowerCase("fr-FR");
  const brand=VEHICLE_BRANDS.find(b=>lower.includes(b.toLocaleLowerCase("fr-FR")))??null;
  const km=text.match(/(?:kilom[eè]trage\s*[:\-]?\s*)?([0-9][0-9 .]{2,8})\s*km\b/i);const mileage=Number((km?.[1]??"").replace(/[ .]/g,""));
  const explicitDate=text.match(/(?:mise en circulation|1(?:è|e|er)?re? mise en circulation|ann[eé]e)\s*[:\-]?\s*((?:19|20)\d{2})(?:[-/.](\d{1,2}))?(?:[-/.](\d{1,2}))?/i);
  const yearOnly=!explicitDate?text.match(/\b((?:19|20)\d{2})\b/):null;const year=Number(explicitDate?.[1]??yearOnly?.[1]??0);const month=Number(explicitDate?.[2]??1);const day=Number(explicitDate?.[3]??1);
  const firstRegistration=year>=1900&&year<=2100?`${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`:null;
  const fuel=lower.includes("hybride rechargeable")?"Hybride rechargeable":lower.includes("électrique")||lower.includes("electrique")?"Électrique":lower.includes("hybride")?"Hybride":lower.includes("diesel")?"Diesel":lower.includes("essence")?"Essence":lower.includes("e85")?"E85":lower.includes("gpl")?"GPL":null;
  const gearbox=/\b(bva|dsg|edc|automatique)\b|bo[iî]te[^\n]{0,18}automatique/i.test(text)?"Automatique":/\b(bvm|manuelle)\b|bo[iî]te[^\n]{0,18}manuelle/i.test(text)?"Manuelle":null;
  const fiscal=text.match(/(?:puissance fiscale|chevaux fiscaux|cv fiscaux)\s*[:\-]?\s*(\d{1,2})|\b(\d{1,2})\s*cv\b/i);const fiscalPower=Number(fiscal?.[1]??fiscal?.[2]??0);
  const kw=text.match(/(?:puissance\s*[:\-]?\s*)?(\d{2,4})\s*kw\b/i);const powerKw=Number(kw?.[1]??0);
  const doorM=text.match(/\b([2-6])\s*portes?\b|portes?\s*[:\-]?\s*([2-6])/i);const seatM=text.match(/\b([2-9])\s*(?:places?|si[eè]ges?)\b|(?:places?|si[eè]ges?)\s*[:\-]?\s*([2-9])/i);const doors=Number(doorM?.[1]??doorM?.[2]??0);const seats=Number(seatM?.[1]??seatM?.[2]??0);
  const color=VEHICLE_COLORS.find(c=>new RegExp(`\\b${c}\\b`,"i").test(text))??null;
  const bodyStyle=lower.includes("cabriolet")?"Cabriolet":lower.includes("coupé")||lower.includes("coupe")?"Coupé":lower.includes("break")?"Break":lower.includes("monospace")?"Monospace":lower.includes("suv")||lower.includes("crossover")?"SUV":lower.includes("berline")?"Berline":lower.includes("citadine")?"Citadine":null;
  let model:string|null=null;if(brand&&title){const idx=title.toLocaleLowerCase("fr-FR").indexOf(brand.toLocaleLowerCase("fr-FR"));if(idx>=0){const after=title.slice(idx+brand.length).replace(/^\s*[-–—:]?\s*/,"").trim();model=after.split(/\s+(?:essence|diesel|hybride|électrique|electrique|automatique|manuelle|19\d{2}|20\d{2})\b/i)[0]?.trim().slice(0,120)||null;}}
  return {brand,model,firstRegistration,mileage:Number.isFinite(mileage)&&mileage>0?mileage:null,fuel,gearbox,fiscalPower:fiscalPower>0?fiscalPower:null,powerKw:powerKw>0?powerKw:null,doors:doors>0?doors:null,seats:seats>0?seats:null,color,bodyStyle};
}
async function applyVehicleHints(listingId:string,categoryId:string,title:string|null|undefined,description:string|null|undefined,sourceHints:Record<string,string|number|boolean>={}){
  const base=extractVehicleHints(title,description);const num=(key:string,fallback:number|null)=>{const n=Number(sourceHints[key]);return Number.isFinite(n)&&n>0?n:fallback};const text=(key:string,fallback:string|null)=>sourceHints[key]!==undefined&&String(sourceHints[key]).trim()?String(sourceHints[key]).trim():fallback;const sourceYear=num("modelYear",null);const first=text("firstRegistration",base.firstRegistration)??(sourceYear?`${Math.round(sourceYear)}-01-01`:null);const sourceModel=text("model",null);const modelLooksInvalid=Boolean(sourceModel&&(/^(?:19|20)\d{2}$/.test(sourceModel)||sourceModel.length>60||/\b\d{2,4}\s*(?:ch|cv|kw)\b/i.test(sourceModel)));const cleanModel=modelLooksInvalid?base.model:(sourceModel??base.model);
  const h={brand:text("brand",base.brand),model:cleanModel,firstRegistration:first,mileage:num("mileage",base.mileage),fuel:text("fuel",base.fuel),gearbox:text("gearbox",base.gearbox),fiscalPower:num("fiscalPower",base.fiscalPower),powerKw:num("powerKw",base.powerKw),doors:num("doors",base.doors),seats:num("seats",base.seats),color:text("color",base.color),bodyStyle:text("bodyStyle",base.bodyStyle)};const data={make:h.brand,model:h.model,firstRegistrationDate:h.firstRegistration?new Date(`${h.firstRegistration}T00:00:00.000Z`):null,modelYear:h.firstRegistration?Number(h.firstRegistration.slice(0,4)):sourceYear?Math.round(sourceYear):null,mileageKm:h.mileage,fuel:h.fuel,transmission:h.gearbox,fiscalPowerCv:h.fiscalPower,powerKw:h.powerKw,doors:h.doors,seats:h.seats,color:h.color,bodyType:h.bodyStyle};
  if(Object.values(data).some(v=>v!==null))await prisma.vehicleDetails.upsert({where:{listingId},create:{listingId,...data},update:data});
  const defs=await prisma.categoryAttribute.findMany({where:{categoryId,key:{in:["brand","model","firstRegistration","mileage","fuel","gearbox","fiscalPower","powerKw","doors","seats","color","critAir","bodyStyle","condition","warranty"]}},include:{options:true}});
  const vals:Record<string,unknown>={brand:h.brand,model:h.model,firstRegistration:h.firstRegistration,mileage:h.mileage,fuel:h.fuel,gearbox:h.gearbox,fiscalPower:h.fiscalPower,powerKw:h.powerKw,doors:h.doors?String(h.doors):null,seats:h.seats,color:h.color,critAir:sourceHints.critAir??null,bodyStyle:h.bodyStyle};
  for(const d of defs){let v=vals[d.key];if(v===null||v===undefined||v==="")continue;const data:any={valueText:null,valueNumber:null,valueBoolean:null,valueJson:null};if(d.type==="NUMBER"){const n=Number(v);if(!Number.isFinite(n))continue;data.valueNumber=n}else if(d.type==="SELECT"){let wanted=normalizeMatch(String(v));if(d.key==="doors"&&Number(v)>=6)wanted=normalizeMatch("6+");const option=d.options.find(o=>normalizeMatch(o.value)===wanted||normalizeMatch(o.label)===wanted);if(!option)continue;data.valueText=option.value}else if(d.type==="BOOLEAN"){if(typeof v!=="boolean")continue;data.valueBoolean=v}else data.valueText=String(v).slice(0,1000);await prisma.listingAttributeValue.upsert({where:{listingId_attributeId:{listingId,attributeId:d.id}},create:{listingId,attributeId:d.id,...data},update:data});}
  return h;
}

function inferRealEstateImportedValues(title:string|null,description:string|null,categorySlug:string,city:string|null,postalCode:string|null,sourceHints:Record<string,string|number|boolean>={}){
  const raw=`${title??""} ${description??""}`;
  const surface=raw.match(/(?:surface\s*[:\-]?\s*)?(\d{1,5}(?:[.,]\d+)?)\s*m(?:²|2)\b/i);
  const rooms=raw.match(/(?:^|\b)(\d{1,2})\s*(?:pi[eè]ces?|p)\b/i);
  const bedrooms=raw.match(/(?:^|\b)(\d{1,2})\s*(?:chambres?|ch)\b/i);
  let propertyType="Appartement";
  if(/\bmaison\b/i.test(raw))propertyType="Maison";else if(/\bterrain\b/i.test(raw)||categorySlug==="terrains")propertyType="Terrain";else if(/\b(?:local|commerce|bureau)\b/i.test(raw)||categorySlug==="bureaux-commerces")propertyType="Local commercial";else if(/\b(?:parking|garage)\b/i.test(raw)||categorySlug==="parkings-garages")propertyType="Parking";
  if(sourceHints.propertyType)propertyType=String(sourceHints.propertyType);
  const rental=categorySlug==="location-immobilier"||categorySlug==="locations-saisonnieres"||categorySlug==="colocation"||/\b(?:location|louer|loyer)\b/i.test(raw);
  const furnished=sourceHints.furnished!==undefined?Boolean(sourceHints.furnished):/\bmeubl[ée]\b/i.test(raw);const transactionType:"SALE"|"RENTAL"=rental?"RENTAL":"SALE";const num=(key:string,fallback:number|null)=>{const n=Number(sourceHints[key]);return Number.isFinite(n)&&n>=0?n:fallback};
  return {transactionType,propertyType,surfaceM2:num("surface",surface?Number((surface[1]??"").replace(",",".")):null),rooms:num("rooms",rooms?Number(rooms[1]):null),bedrooms:num("bedrooms",bedrooms?Number(bedrooms[1]):null),floor:num("floor",null),totalFloors:num("totalFloors",null),landM2:num("landM2",null),furnished,postalCode:postalCode||null,city:city||null,countryCode:"FR",dpe:sourceHints.dpe?String(sourceHints.dpe):null,ges:sourceHints.ges?String(sourceHints.ges):null};
}
async function applyImportedRealEstate(listingId:string,category:{slug:string;domain:string},title:string|null,description:string|null,city:string|null,postalCode:string|null,sourceHints:Record<string,string|number|boolean>={}){
  if(category.domain!=="REAL_ESTATE")return null;
  const v=inferRealEstateImportedValues(title,description,category.slug,city,postalCode,sourceHints);
  if(!v.surfaceM2||v.surfaceM2<=0)return v;
  const data={transactionType:v.transactionType,propertyType:v.propertyType,surfaceM2:v.surfaceM2,rooms:v.rooms,bedrooms:v.bedrooms,furnished:v.furnished,floor:v.floor,totalFloors:v.totalFloors,landM2:v.landM2,postalCode:v.postalCode,city:v.city,countryCode:v.countryCode};
  await prisma.propertyDetails.upsert({where:{listingId},create:{listingId,...data},update:data});
  return v;
}
function importResumeStep(errors:string[]){
  const steps=errors.map(code=>{
    if(code==="title_required")return 0;
    if(code==="ready_photo_required")return 1;
    if(["price_required","monthly_rent_required","hourly_rate_required","package_weight_required","package_dimensions_required","no_delivery_method"].includes(code))return 3;
    return 2;
  });
  return steps.length?Math.min(...steps):4;
}
function importIssueLabel(code:string){
  if(code==="title_required")return "Titre à compléter";
  if(code==="description_required")return "Description à compléter";
  if(code==="city_required"||code==="postal_code_required")return "Localisation à compléter";
  if(code==="ready_photo_required")return "Photo à ajouter";
  if(code==="price_required"||code==="monthly_rent_required"||code==="hourly_rate_required")return "Prix à compléter";
  if(code.startsWith("required_attribute:"))return "Caractéristique obligatoire à compléter";
  if(code==="vehicle_details_required")return "Informations véhicule à compléter";
  if(code==="property_details_required")return "Informations du bien à compléter";
  if(code.includes("dpe")||code.includes("energy")||code.includes("ges"))return "Diagnostic énergétique à compléter";
  if(code==="package_weight_required"||code==="package_dimensions_required")return "Informations colis à compléter";
  return "Information obligatoire à compléter";
}

export async function registerListingImportRoutes(app:FastifyInstance){
  await ensureImportLogTable();
  app.get("/listing-import/image-preview",async(request,reply)=>{
    const user=await requireListingUser(request,reply);if(!user)return;
    const q=z.object({sourceUrl:z.string().url(),imageUrl:z.string().url()}).safeParse(request.query);if(!q.success)return reply.code(400).send({error:"invalid_request"});
    try{const image=await fetchImportPreviewImage(q.data.imageUrl,q.data.sourceUrl);reply.header("Cache-Control","private, max-age=300");reply.type(image.type);return reply.send(image.buf)}catch{return reply.code(404).send({error:"image_unavailable"})}
  });
  app.get("/listing-import/history",async(request,reply)=>{const user=await requireListingUser(request,reply);if(!user)return;return reply.send({imports:await importHistory(user.id)});});
  app.post("/listing-import/preview",async(request,reply)=>{
    const user=await requireListingUser(request,reply);if(!user)return;
    const body=z.object({url:z.string().trim().url()}).safeParse(request.body);
    if(!body.success)return reply.code(400).send({error:"invalid_request"});
    try{
      const url=(await safeUrl(body.data.url)).toString();
      const host=new URL(url).hostname.toLowerCase();
      const isLeboncoin=host==="leboncoin.fr"||host.endsWith(".leboncoin.fr");
      const isVinted=isVintedHost(host);
      const respond=(preview:any,extra:Record<string,unknown>={})=>{
        const imageUrls=Array.isArray(preview.imageUrls)?preview.imageUrls.filter((x:unknown):x is string=>typeof x==="string"&&Boolean(x)).slice(0,20):[];
        const imageUrl=(typeof preview.imageUrl==="string"&&preview.imageUrl)?preview.imageUrl:(imageUrls[0]??null);
        const suggestedCategorySlug=suggestCategorySlug(url,preview.title,preview.description);
        return reply.send({preview:{...preview,imageUrl,imageUrls,suggestedCategorySlug,suggestionReason:categorySuggestionReason(suggestedCategorySlug,url,preview.title,preview.description),detectedFields:{...inferCommonImportedValues(preview.title,preview.description),...(preview.sourceFields??{})}},...extra});
      };

      if(isLeboncoin){
        let direct:any|null=null;
        try{direct=sanitizedPreview(summarize(await fetchHtml(url),url));}catch{}
        const preview=await enrichedLeboncoinPreview(url,direct);
        if(preview&&usableImportPreview(preview)){
          request.log.info({source:"LEBONCOIN",fallback:Boolean(!direct),hasTitle:Boolean(preview.title),hasDescription:Boolean(preview.description),hasPrice:preview.priceMinor!==null,hasCity:Boolean(preview.city),hasPostalCode:Boolean(preview.postalCode),imageCount:(preview.imageUrls??[]).length},"listing_import_preview");
          return respond(preview,{fallback:Boolean(!direct),provider:"leboncoin-public-combined"});
        }
        request.log.warn({source:"LEBONCOIN"},"listing_import_preview_manual_fallback");
        return reply.send({preview:manualImportPreview(url),fallback:true,provider:"manual-leboncoin"});
      }

      if(isVinted){
        try{const markdown=await fetchVintedReader(url);const preview=sanitizedPreview(summarizeVintedReader(markdown,url));if(usableImportPreview(preview)){request.log.info({source:"VINTED",hasTitle:Boolean(preview.title),hasDescription:Boolean(preview.description),hasPrice:preview.priceMinor!==null,imageCount:(preview.imageUrls??[]).length},"listing_import_preview");return respond(preview,{fallback:true,provider:"vinted-reader"});}}catch{}
        try{const html=await fetchViaWebExtraction(url);if(html){const preview=sanitizedPreview(summarize(html,url));if(usableImportPreview(preview))return respond(preview,{fallback:true,provider:"web-extraction"});}}catch{}
        request.log.warn({source:"VINTED"},"listing_import_preview_manual_fallback");
        return reply.send({preview:manualImportPreview(url),fallback:true,provider:"manual-vinted"});
      }

      try{
        const preview=sanitizedPreview(summarize(await fetchHtml(url),url));
        if(!usableImportPreview(preview))throw new Error("source_listing_unavailable");
        return respond(preview);
      }catch(primaryError){
        const code=primaryError instanceof Error?primaryError.message:"import_failed";
        if(!["unsafe_url","unsupported_url","unexpected_redirect_host"].includes(code))return reply.send({preview:manualImportPreview(url),fallback:true,provider:"manual-other"});
        throw primaryError;
      }
    }catch(e){const code=e instanceof Error?e.message:"import_failed";return reply.code(422).send({error:code});}
  });
  app.post("/listing-import/create-draft",async(request,reply)=>{
    const user=await requireListingUser(request,reply);if(!user)return;
    const body=z.object({categoryId:z.string().min(1),sourceUrl:z.string().url(),title:z.string().trim().min(5).max(120).nullable().optional(),description:z.string().trim().max(12000).nullable().optional(),priceMinor:z.number().int().nonnegative().nullable().optional(),city:z.string().trim().max(120).nullable().optional(),postalCode:z.string().trim().max(12).nullable().optional(),histovecUrl:z.string().url().nullable().optional(),imageUrls:z.array(z.string().url()).max(20).optional(),detectedFields:z.record(z.string(),z.union([z.string(),z.number(),z.boolean()])).optional(),rightsConfirmed:z.literal(true),allowSimilarDuplicate:z.boolean().optional().default(false)}).safeParse(request.body);
    if(!body.success)return reply.code(400).send({error:"invalid_request"});
    const category=await prisma.category.findUnique({where:{id:body.data.categoryId}});if(!category||!category.isActive)return reply.code(404).send({error:"category_not_found"});
    const d=body.data;if(d.sourceUrl)try{await safeUrl(d.sourceUrl)}catch{return reply.code(400).send({error:"invalid_source_url"})}
    const sourceType=importSourceType(d.sourceUrl);let effectiveCity=d.city??null,effectivePostalCode=d.postalCode??null;
    if(sourceType==="LEBONCOIN"&&(!effectiveCity||!effectivePostalCode)){
      try{
        const fresh=summarizeLeboncoinAdObject(await fetchLeboncoinApiAd(d.sourceUrl),d.sourceUrl,"leboncoin-api-create");
        const filledCity=!effectiveCity&&Boolean(fresh.city),filledPostal=!effectivePostalCode&&Boolean(fresh.postalCode);
        if(filledCity)effectiveCity=fresh.city;if(filledPostal)effectivePostalCode=fresh.postalCode;
        if(filledCity||filledPostal)request.log.info({source:"LEBONCOIN",filledCity,filledPostal},"listing_import_geo_recovered");
      }catch{}
    }
    const histovecUrl=d.histovecUrl?normalizeHistovecShareUrl(d.histovecUrl):null;if(d.histovecUrl&&!histovecUrl)return reply.code(400).send({error:"invalid_histovec_url"});
    const cleanDescription=cleanImportedDescription(d.description,d.sourceUrl);const fingerprint=importFingerprint({sourceUrl:d.sourceUrl,category:category.slug,title:d.title,priceMinor:d.priceMinor,city:effectiveCity,postalCode:effectivePostalCode});const prior=await existingImport(user.id,fingerprint,d.sourceUrl);if(prior){const existing=await prisma.listing.findFirst({where:{id:prior.listingId,sellerId:user.id},select:{id:true,title:true,status:true}});if(existing){let recoveredMedia=0;if(sourceType==="VINTED"){const count=await prisma.$queryRawUnsafe<Array<{count:bigint}>>(`SELECT COUNT(*)::bigint AS count FROM "ListingMedia" WHERE "listingId"=$1 AND "status"='READY'`,existing.id).catch(()=>[]);if(Number(count[0]?.count??0n)===0){try{const fresh=summarizeVintedReader(await fetchVintedReader(d.sourceUrl),d.sourceUrl);const recovery=await importListingImages(existing.id,fresh.imageUrls??[],d.sourceUrl);recoveredMedia=recovery.imported;if(recoveredMedia>0)request.log.info({listingId:existing.id,source:"VINTED",recoveredMedia},"listing_import_duplicate_media_recovered");}catch(e){request.log.warn({listingId:existing.id,source:"VINTED",reason:e instanceof Error?e.message:"vinted_duplicate_recovery_failed"},"listing_import_duplicate_media_recovery_failed");}}}return reply.send({duplicate:true,duplicateKind:"exact",listing:existing,recoveredMedia,editUrl:`/deposer-une-annonce?listingId=${encodeURIComponent(existing.id)}`});}}
    if(d.title&&!d.allowSimilarDuplicate){const similar=await prisma.$queryRawUnsafe<Array<{id:string;title:string|null;status:string;priceMinor:number|null;city:string|null}>>(`SELECT "id","title","status","priceMinor","city" FROM "Listing" WHERE "sellerId"=$1 AND "status" NOT IN ('EXPIRED','DELETED') AND (lower(COALESCE("title",''))=lower($2) OR lower(COALESCE("title",'')) LIKE '%'||lower($2)||'%' OR lower($2) LIKE '%'||lower(COALESCE("title",''))||'%') AND ($3::int IS NULL OR "priceMinor" IS NULL OR abs("priceMinor"-$3)<=GREATEST(500,ROUND($3*0.08))) AND ($4::text IS NULL OR lower(COALESCE("city",''))=lower($4)) ORDER BY "updatedAt" DESC LIMIT 1`,user.id,d.title,d.priceMinor??null,effectiveCity).catch(()=>[]);if(similar[0])return reply.send({duplicate:true,duplicateKind:"similar",listing:similar[0],editUrl:`/deposer-une-annonce?listingId=${encodeURIComponent(similar[0].id)}`});}
    const listing=await prisma.listing.create({data:{sellerId:user.id,categoryId:category.id,title:d.title||undefined,description:cleanDescription&&cleanDescription.length>=20?cleanDescription:undefined,priceMinor:d.priceMinor??undefined,city:effectiveCity||undefined,postalCode:effectivePostalCode||undefined,draftSavedAt:new Date()},include:{category:true}});
    const recorded=await recordImport(user.id,listing.id,sourceType,d.sourceUrl,fingerprint);
    if(!recorded){await prisma.listing.delete({where:{id:listing.id}}).catch(()=>undefined);const winner=await existingImport(user.id,fingerprint,d.sourceUrl);if(winner){const existing=await prisma.listing.findFirst({where:{id:winner.listingId,sellerId:user.id},select:{id:true,title:true,status:true}});if(existing)return reply.send({duplicate:true,duplicateKind:"exact",listing:existing,editUrl:`/deposer-une-annonce?listingId=${encodeURIComponent(existing.id)}`});}return reply.code(409).send({error:"import_conflict"});}
    if(category.domain==="VEHICLE"&&histovecUrl){await ensureVehicleOfficialReportTable();await prisma.$executeRawUnsafe(`INSERT INTO "VehicleOfficialReport" ("listingId","histovecUrl","createdAt","updatedAt") VALUES ($1,$2,NOW(),NOW()) ON CONFLICT ("listingId") DO UPDATE SET "histovecUrl"=EXCLUDED."histovecUrl","updatedAt"=NOW()`,listing.id,histovecUrl);}
    const sourceHints=d.detectedFields??{};let vehicleHints:Awaited<ReturnType<typeof applyVehicleHints>>|null=null;if(category.domain==="VEHICLE")vehicleHints=await applyVehicleHints(listing.id,category.id,d.title,cleanDescription,sourceHints);
    const importedAttributes=await applyImportedCommonAttributes(listing.id,category.id,d.title??null,cleanDescription,sourceHints);
    const propertyHints=await applyImportedRealEstate(listing.id,category,d.title??null,cleanDescription,effectiveCity,effectivePostalCode,sourceHints);
    let effectiveImageUrls=d.imageUrls??[];
    if(sourceType==="VINTED"&&effectiveImageUrls.length===0){try{const fresh=summarizeVintedReader(await fetchVintedReader(d.sourceUrl),d.sourceUrl);effectiveImageUrls=(fresh.imageUrls??[]).slice(0,20);if(effectiveImageUrls.length)request.log.info({listingId:listing.id,source:"VINTED",imageCount:effectiveImageUrls.length},"listing_import_media_recovered");}catch(e){request.log.warn({listingId:listing.id,source:"VINTED",reason:e instanceof Error?e.message:"vinted_media_recovery_failed"},"listing_import_media_recovery_failed");}}
    let media:{imported:number;failed:number;reasons?:string[]}={imported:0,failed:0,reasons:[]};if(effectiveImageUrls.length&&d.sourceUrl){media=await importListingImages(listing.id,effectiveImageUrls,d.sourceUrl);}
    const preflight=await evaluateListing(listing.id,user.id);
    const preflightErrors=preflight?.errors??[];
    const resumeStep=importResumeStep(preflightErrors);
    const missing=[...new Set(preflightErrors.map(importIssueLabel))];
    if(media.failed>0){
      request.log.warn({listingId:listing.id,source:sourceType,imported:media.imported,failed:media.failed,reasons:media.reasons??[]}, "listing_import_media_partial");
    }
    request.log.info({listingId:listing.id,source:sourceType,resumeStep,ready:Boolean(preflight?.ready),errors:preflightErrors,media}, "listing_import_preflight");
    return reply.code(201).send({
      duplicate:false,
      listing,
      media,
      vehicleHints,
      propertyHints,
      importedAttributes,
      preflight:{ready:Boolean(preflight?.ready),errors:preflightErrors,missing,resumeStep,quality:preflight?.quality??null},
      editUrl:`/deposer-une-annonce?listingId=${encodeURIComponent(listing.id)}&resumeStep=${resumeStep}`
    });
  });
}
