import { randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import { evaluateListing } from "../src/publication.js";

type AuditResult={slug:string;ready:boolean;errors:string[];warnings:string[];quality:number};

async function addMedia(listingId:string){
  const id=randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO "ListingMedia" ("id","listingId","objectKey","publicUrl","mimeType","sizeBytes","status","sortOrder","isCover","altText","createdAt","updatedAt") VALUES ($1,$2,$3,$4,'image/jpeg',1024,'READY',0,TRUE,'Photo QA',NOW(),NOW())`,id,listingId,`qa/${listingId}/${id}.jpg`,`https://petitannonces.fr/qa/${id}.jpg`);
}
async function addCommerce(listingId:string,shipping=false){
  await prisma.$executeRawUnsafe(`INSERT INTO "ListingCommerceSettings" ("listingId","acceptsOffers","securePaymentEnabled","handDeliveryEnabled","mondialRelayEnabled","colissimoEnabled","packageWeightG","packageLengthCm","packageWidthCm","packageHeightCm","createdAt","updatedAt") VALUES ($1,TRUE,FALSE,TRUE,$2,FALSE,$3,$4,$5,$6,NOW(),NOW())`,listingId,shipping,shipping?700:null,shipping?25:null,shipping?18:null,shipping?10:null);
}
async function setAttr(listingId:string,categoryId:string,key:string,value:string|number|boolean){
  const def=await prisma.categoryAttribute.findFirst({where:{categoryId,key},include:{options:true}});if(!def)throw new Error(`attribute_missing:${key}`);
  const data:any={valueText:null,valueNumber:null,valueBoolean:null,valueJson:null};
  if(def.type==="NUMBER")data.valueNumber=Number(value);else if(def.type==="BOOLEAN")data.valueBoolean=Boolean(value);else data.valueText=String(value);
  await prisma.listingAttributeValue.create({data:{listingId,attributeId:def.id,...data}});
}
async function audit(slug:string,build:(userId:string,categoryId:string)=>Promise<string>):Promise<AuditResult>{
  const category=await prisma.category.findUnique({where:{slug}});if(!category)throw new Error(`category_missing:${slug}`);
  const userId=(globalThis as any).__qaUserId as string;const id=await build(userId,category.id);const result=await evaluateListing(id,userId);if(!result)throw new Error(`evaluation_missing:${slug}`);
  return{slug,ready:result.ready,errors:result.errors,warnings:result.warnings,quality:result.quality.score};
}
async function main(){
  const user=await prisma.user.create({data:{email:`qa-wizard-${randomUUID()}@example.test`,passwordHash:"qa-not-used",kind:"PARTICULIER",status:"ACTIVE",emailVerifiedAt:new Date(),profile:{create:{displayName:"QA Wizard",locale:"fr-FR",countryCode:"FR"}}},select:{id:true}});(globalThis as any).__qaUserId=user.id;
  try{
    const electronics=await audit("apple-iphone",async(userId,categoryId)=>{const l=await prisma.listing.create({data:{sellerId:userId,categoryId,title:"QA iPhone 15 Pro 256 Go",description:"Annonce de test complète pour vérifier le wizard électronique, les caractéristiques obligatoires, la photo, le prix et la livraison sans publier réellement.",priceMinor:89900,city:"Saint-Étienne",postalCode:"42000"}});await setAttr(l.id,categoryId,"condition","Neuf");await addMedia(l.id);await addCommerce(l.id,true);return l.id});
    const vehicle=await audit("voitures-citadines",async(userId,categoryId)=>{const l=await prisma.listing.create({data:{sellerId:userId,categoryId,title:"QA Renault Clio 2022 Essence",description:"Annonce véhicule de test QA : Renault Clio 2022, 40491 km, essence, boîte manuelle, cinq chevaux fiscaux. Vérification du wizard véhicule.",priceMinor:1599000,city:"Saint-Étienne",postalCode:"42000"}});await setAttr(l.id,categoryId,"brand","Renault");await setAttr(l.id,categoryId,"model","Clio");await setAttr(l.id,categoryId,"mileage",40491);await prisma.vehicleDetails.create({data:{listingId:l.id,make:"Renault",model:"Clio",firstRegistrationDate:new Date("2022-05-01T00:00:00Z"),modelYear:2022,mileageKm:40491,fuel:"Essence",transmission:"Manuelle",bodyType:"Citadine",fiscalPowerCv:5,powerKw:67,doors:5,seats:5,color:"Blanc"}});await addMedia(l.id);await addCommerce(l.id,false);return l.id});
    const realEstate=await audit("vente-immobilier",async(userId,categoryId)=>{const l=await prisma.listing.create({data:{sellerId:userId,categoryId,title:"QA Appartement 3 pièces 68 m²",description:"Annonce immobilière de test QA pour vérifier surface, pièces, chambres, étage, DPE, GES, localisation, prix et contrôle final du wizard immobilier.",priceMinor:17900000,city:"Saint-Étienne",postalCode:"42000"}});await prisma.propertyDetails.create({data:{listingId:l.id,transactionType:"SALE",propertyType:"Appartement",surfaceM2:68,rooms:3,bedrooms:2,furnished:false,floor:2,totalFloors:5,landM2:0,postalCode:"42000",city:"Saint-Étienne",countryCode:"FR"}});await prisma.propertyEnergyPerformance.create({data:{listingId:l.id,isExempt:false,dpeNumber:"QA202609070001",dpeDate:new Date("2025-01-15T00:00:00Z"),validUntil:new Date("2035-01-15T00:00:00Z"),energyClass:"C",climateClass:"A",energyConsumptionKwhM2Year:145,ghgKgCo2M2Year:5,annualCostMinMinor:85000,annualCostMaxMinor:120000,energyPriceReferenceYears:"2021-2023",excessiveConsumption:false}});await addMedia(l.id);await addCommerce(l.id,false);return l.id});
    console.log(JSON.stringify({ok:[electronics,vehicle,realEstate].every(x=>x.ready),electronics,vehicle,realEstate},null,2));
  } finally {
    await prisma.listing.deleteMany({where:{sellerId:user.id}});
    await prisma.user.delete({where:{id:user.id}});
    await prisma.$disconnect();
  }
}
main().catch(async e=>{console.error(e);await prisma.$disconnect();process.exit(1)});