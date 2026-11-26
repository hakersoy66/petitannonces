import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { requireAdminRoles } from "./rbac.js";

type Row={id:string;title:string;slug:string;description:string;priceMinor:number;currency:string;sellerId:string;categoryName:string;imageUrl:string;conditionValue:string|null;brandValue:string|null;supplier:boolean;imageWidth:number|null;imageHeight:number|null};
type Item={id:string;title:string;description:string;link:string;image:string;price:string;condition:"new"|"used"|"refurbished";sellerId:string;category:string;brand?:string;supplier:boolean};
const QUERY=[
  'WITH RECURSIVE allowed AS (',
  ' SELECT "id" FROM "Category" WHERE "parentId" IS NULL AND "isActive"=TRUE AND "slug" IN (\'high-tech\',\'maison-jardin\',\'mode\',\'enfants-bebe\')',
  ' UNION ALL SELECT c."id" FROM "Category" c JOIN allowed p ON c."parentId"=p."id" WHERE c."isActive"=TRUE',
  ') SELECT l."id",l."title",l."slug",l."description",l."priceMinor",l."currency",l."sellerId",c."name" AS "categoryName",m."publicUrl" AS "imageUrl",m.width AS "imageWidth",m.height AS "imageHeight",(sp.id IS NOT NULL) AS supplier,',
  ' (SELECT v."valueText" FROM "ListingAttributeValue" v JOIN "CategoryAttribute" a ON a."id"=v."attributeId" WHERE v."listingId"=l."id" AND LOWER(a."key") IN (\'condition\',\'etat\',\'productcondition\') LIMIT 1) AS "conditionValue",',
  ' (SELECT v."valueText" FROM "ListingAttributeValue" v JOIN "CategoryAttribute" a ON a."id"=v."attributeId" WHERE v."listingId"=l."id" AND LOWER(a."key") IN (\'brand\',\'marque\') LIMIT 1) AS "brandValue"',
  ' FROM "Listing" l JOIN allowed ac ON ac."id"=l."categoryId" JOIN "Category" c ON c."id"=l."categoryId"',
  ' JOIN "User" u ON u."id"=l."sellerId" AND u."status"=\'ACTIVE\'',
  ' LEFT JOIN "AdminCommercialPermission" perm ON perm."userId"=l."sellerId"',
  ' LEFT JOIN "SupplierCatalogProduct" sp ON sp."publishedListingId"=l.id',
  ' JOIN "ListingCommerceSettings" commerce ON commerce."listingId"=l."id" AND commerce."securePaymentEnabled"=TRUE AND ((sp.id IS NOT NULL AND sp.provider=\'CJ\' AND sp.status=\'LIVE\' AND sp."stockStatus"=\'IN_STOCK\' AND (sp."stockQuantity" IS NULL OR sp."stockQuantity">0)) OR (sp.id IS NULL AND commerce."packageWeightG">0 AND (commerce."mondialRelayEnabled"=TRUE OR commerce."colissimoEnabled"=TRUE) AND EXISTS(SELECT 1 FROM "Address" a WHERE a."userId"=l."sellerId" AND a.type IN (\'SHIPPING\',\'BUSINESS\',\'HOME\'))))',
  ' JOIN LATERAL (SELECT "publicUrl",width,height FROM "ListingMedia" WHERE "listingId"=l."id" AND "status"=\'READY\' AND "publicUrl" IS NOT NULL ORDER BY "isCover" DESC,"sortOrder" ASC LIMIT 1) m ON TRUE',
  ' WHERE l."status"=\'PUBLISHED\' AND l."slug" IS NOT NULL AND l."title" IS NOT NULL AND LENGTH(BTRIM(l."title"))>2 AND l."description" IS NOT NULL AND LENGTH(BTRIM(l."description"))>=15 AND l."priceMinor">0 AND l."currency"=\'EUR\' AND c."slug" NOT IN (\'jeux-video\')',
  ' AND NOT COALESCE(perm."salesBlocked",FALSE) AND NOT EXISTS(SELECT 1 FROM "AdminListingArchive" ar WHERE ar."listingId"=l.id) AND EXISTS(SELECT 1 FROM "ListingLifecycle" lc WHERE lc."listingId"=l.id AND lc."expiresAt">NOW())',
  ' ORDER BY l."updatedAt" DESC LIMIT 10000'
].join(" ");
function condition(v:string|null):Item["condition"]|null {
  const s=(v??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
  if(/reconditionn|refurbished/.test(s))return "refurbished";
  if(/comme neuf|occasion|bon etat|etat correct|tres bon|satisfaisant|seconde main|used/.test(s))return "used";
  if(/^neuf\b|^new\b|jamais utilise/.test(s))return "new";
  return null;
}
function validImage(v:string):string|null{
  try{const u=new URL(v);return u.protocol==="https:" && ["media.petitannonces.fr","petitannonces.fr"].includes(u.hostname)?u.toString():null}catch{return null}
}
function product(r:Row):Item|null {
  const c=condition(r.conditionValue)??(r.supplier?"new":null),img=validImage(r.imageUrl);
  if(!c||!img||!r.priceMinor)return null;
  const d=r.description.replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim();
  if(d.length<15)return null;
  return {id:r.id,title:r.title.trim().slice(0,150),description:d.slice(0,4900),link:"https://petitannonces.fr/annonce/"+encodeURIComponent(r.slug),image:img,price:(r.priceMinor/100).toFixed(2)+" EUR",condition:c,sellerId:r.sellerId,category:r.categoryName,supplier:r.supplier,...(r.brandValue?.trim()?{brand:r.brandValue.trim().slice(0,70)}:{})};
}
function x(v:string):string{return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;")}
function tag(n:string,v:string){return "<"+n+">"+x(v)+"</"+n+">"}
export async function gather(){const rows=await prisma.$queryRawUnsafe<Row[]>(QUERY);const items=rows.map(product).filter((v):v is Item=>v!==null);return {items,candidates:rows.length,diagnostics:{missingCondition:rows.filter(r=>!condition(r.conditionValue)&&!r.supplier).length,invalidImage:rows.filter(r=>!validImage(r.imageUrl)).length,smallImage:rows.filter(r=>r.imageWidth!=null&&r.imageHeight!=null&&(r.imageWidth<500||r.imageHeight<500)).length,unknownImageDimensions:rows.filter(r=>r.imageWidth==null||r.imageHeight==null).length,supplierProducts:items.filter(i=>i.supplier).length}}}
function xml(items:Item[]):string{
 const out=['<?xml version="1.0" encoding="UTF-8"?>','<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">','<channel>',tag("title","Petitannonces.fr produits"),tag("link","https://petitannonces.fr"),tag("description","Offres produits de vendeurs tiers")];
 for(const p of items){out.push("<item>",tag("g:id",p.id),tag("g:title",p.title),tag("g:description",p.description),tag("g:link",p.link),tag("g:image_link",p.image),tag("g:price",p.price),tag("g:availability","in_stock"),tag("g:condition",p.condition),tag("g:external_seller_id",p.sellerId),tag("g:product_type",p.category));if(p.brand)out.push(tag("g:brand",p.brand));if(p.supplier)out.push("<g:shipping>"+tag("g:country","FR")+tag("g:price","0.00 EUR")+"</g:shipping>");out.push("</item>")}
 out.push("</channel>","</rss>");return out.join("\n");
}
export async function registerGoogleMerchantRoutes(app:FastifyInstance){
 app.get("/seo/google-merchant.xml",async(_req,reply)=>{
  const data=await gather();
  reply.header("Content-Type","application/rss+xml; charset=utf-8").header("Cache-Control","public, max-age=0, s-maxage=300");
  return reply.send(xml(data.items));
 });
 app.get("/admin/merchant/status",{preHandler:requireAdminRoles(["SUPER_ADMIN","ADMIN","MARKETING"])},async(_req,reply)=>{
  const [data,published]=await Promise.all([gather(),prisma.listing.count({where:{status:"PUBLISHED"}})]);
  const categories:Record<string,number>={};
  for(const item of data.items)categories[item.category]=(categories[item.category]??0)+1;
  return reply.send({checkedAt:new Date().toISOString(),publishedListings:published,eligibleProducts:data.items.length,candidatesAfterCommerceFilters:data.candidates,categories,diagnostics:data.diagnostics,feedUrl:"https://petitannonces.fr/google-merchant.xml",accountConnection:"NOT_VERIFIED"});
 });
}
