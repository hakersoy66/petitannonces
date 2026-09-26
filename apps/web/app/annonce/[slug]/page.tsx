import type { Metadata } from "next";
import { preload } from "react-dom";
import { ListingViewTracker } from "../../../components/listing-view-tracker";
import { notFound } from "next/navigation";
import { FavoriteButton } from "../../../components/favorite-button";
import { FollowButton } from "../../../components/follow-button";
import { ListingContactActions } from "../../../components/listing-contact-actions";
import { ListingAppointmentButton } from "../../../components/listing-appointment-button";
import { ListingGallery } from "../../../components/listing-gallery";
import { CreditSimulator } from "../../../components/credit-simulator";
import { ShareListingButton } from "../../../components/share-listing-button";
import { MarketplaceListingCard } from "../../../components/marketplace-listing-card";
import { ReputationBadges, type ReputationBadgeView } from "../../../components/reputation-badges";
import { AppIcon, type AppIconName } from "../../../components/app-icon";
import { VacationAvailabilityChecker } from "../../../components/vacation-availability-checker";
import { VacationListingReviews } from "../../../components/vacation-listing-reviews";
import { PayPalPayLaterBadge } from "../../../components/paypal-pay-later-badge";
import { attributeToText, fetchPublicListing, fetchSimilarListings, formatMoney } from "../../../lib/public-listing";
import { formatListingPrice, listingPriceCopy } from "../../../lib/listing-price";
import { promotionClass, promotionLabel } from "../../../lib/listing-promotions";
import styles from "./page.module.css";

export const revalidate=0;

type Props={params:Promise<{slug:string}>};
type Spec={label:string;value:string;icon:AppIconName};
type HeaderCategory={id:string;name:string;slug:string;domain:string;children?:HeaderCategory[]};
type HeaderBrand={siteName:string;tagline:string;logoUrl:string|null;mobileLogoUrl:string|null;accentColor:string;navigationCategorySlugs?:string[]};
const FALLBACK_BRAND:HeaderBrand={siteName:"Petit Annonces",tagline:"",logoUrl:null,mobileLogoUrl:null,accentColor:"#5b4cf0"};
const apiBase=()=> (process.env.API_INTERNAL_URL??process.env.NEXT_PUBLIC_API_URL??"http://127.0.0.1:4000").replace(/\/$/,"");
const protectedMediaPath=(mediaId:string)=>`/api/media/watermark/${encodeURIComponent(mediaId)}`;
const protectedMediaAbsolute=(mediaId:string)=>`https://petitannonces.fr${protectedMediaPath(mediaId)}`;

async function headerData(){
 const safe=(promise:Promise<Response>)=>promise.catch(()=>null);
 const [brandRes,categoryRes]=await Promise.all([
  safe(fetch(`${apiBase()}/public/site-config`,{next:{revalidate:300}})),
  safe(fetch(`${apiBase()}/categories/tree`,{next:{revalidate:300}})),
 ]);
 let brand=FALLBACK_BRAND,categories:HeaderCategory[]=[];
 if(brandRes?.ok){const payload=await brandRes.json() as {site?:Partial<HeaderBrand>};brand={...FALLBACK_BRAND,...(payload.site??{})}}
 if(categoryRes?.ok){const payload=await categoryRes.json() as {categories?:HeaderCategory[]};categories=(payload.categories??[]).map(({id,name,slug,domain})=>({id,name,slug,domain}))}
 return{brand,categories};
}

function vehicleSpecs(vehicle:Record<string,unknown>|null,attributes:Array<{key:string;label:string;value:unknown;unit:string|null}>):Spec[]{
 const pairs:Array<[string,unknown,AppIconName,string?]>=[
  ["Marque",vehicle?.make,"car"],["Modèle",vehicle?.model,"car"],["Version",vehicle?.version,"list"],["Année",vehicle?.modelYear,"calendar"],
  ["Kilométrage",vehicle?.mileageKm,"gauge","km"],["Carburant",vehicle?.fuel,"fuel"],["Boîte de vitesse",vehicle?.transmission,"gears"],
  ["Puissance",vehicle?.powerKw,"bolt","kW"],["Puissance fiscale",vehicle?.fiscalPowerCv,"bolt","CV"],["Couleur",vehicle?.color,"palette"],["CO₂",vehicle?.co2GKm,"gauge","g/km"]
 ];
 const result=pairs.filter(([,v])=>v!==null&&v!==undefined&&v!=="").map(([label,v,icon,unit])=>({label,value:attributeToText(v,unit),icon}));
 const coreKeys=new Set(["brand","marque","model","modele","version","modelYear","year","firstRegistration","mileage","mileageKm","fuel","gearbox","transmission","powerKw","fiscalPower","fiscalPowerCv","color","co2","co2GKm"]);
 const normalize=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"");
 const seen=new Set(result.map(item=>normalize(item.label)));
 const icons:AppIconName[]=["circle-check","list","info","car","gauge","gears","palette","bolt"];
 for(const attribute of attributes){
  if(attribute.value===null||attribute.value===undefined||attribute.value===""||(Array.isArray(attribute.value)&&attribute.value.length===0))continue;
  if(coreKeys.has(attribute.key))continue;
  const labelKey=normalize(attribute.label);if(!labelKey||seen.has(labelKey))continue;
  seen.add(labelKey);
  result.push({label:attribute.label,value:detailAttributeToText(attribute),icon:icons[result.length%icons.length]!});
 }
 return result;
}
function propertySpecs(property:Record<string,unknown>|null,attributes:Array<{key:string;label:string;value:unknown;unit:string|null}>):Spec[]{
 const transaction=property?.transactionType==="SALE"?"Vente":property?.transactionType==="RENTAL"?"Location":property?.transactionType;
 const floor=property?.floor===0?"Rez-de-chaussée":property?.floor;
 const core:Array<[string,unknown,AppIconName,string?]>=[
  ["Transaction",transaction,"home"],["Type de bien",property?.propertyType,"home"],["Surface",property?.surfaceM2,"ruler","m²"],["Pièces",property?.rooms,"door"],["Chambres",property?.bedrooms,"door"],
  ["Étage",floor,"list"],["Nombre d’étages",property?.totalFloors,"list"],["Terrain",typeof property?.landM2==="number"&&property.landM2>0?property.landM2:null,"ruler","m²"],["Meublé",property?.furnished,"couch"]
 ];
 const result=core.filter(([,v])=>v!==null&&v!==undefined&&v!=="").map(([label,v,icon,unit])=>({label,value:attributeToText(v,unit),icon}));
 const normalize=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"");
 const energyPattern=/(^|_)(dpe|ges|energy|energie|climate|climat|ghg|co2)(_|$)|classe.*ener|performance.*ener/i;
 const seen=new Set(result.map(item=>normalize(item.label)));
 const coreKeys=new Set<string>();
 if(property?.transactionType!==null&&property?.transactionType!==undefined)coreKeys.add("transactionType");
 if(property?.propertyType!==null&&property?.propertyType!==undefined&&property?.propertyType!=="")coreKeys.add("propertyType");
 if(property?.surfaceM2!==null&&property?.surfaceM2!==undefined){coreKeys.add("surface");coreKeys.add("surfaceM2")}
 if(property?.rooms!==null&&property?.rooms!==undefined)coreKeys.add("rooms");
 if(property?.bedrooms!==null&&property?.bedrooms!==undefined)coreKeys.add("bedrooms");
 if(property?.floor!==null&&property?.floor!==undefined)coreKeys.add("floor");
 if(property?.totalFloors!==null&&property?.totalFloors!==undefined)coreKeys.add("totalFloors");
 if(typeof property?.landM2==="number"&&property.landM2>0)coreKeys.add("landM2");
 if(property&&property.furnished!==null&&property.furnished!==undefined)coreKeys.add("furnished");
 const icons:AppIconName[]=["circle-check","home","list","info","ruler","couch"];
 for(const attribute of attributes){
  if(attribute.value===null||attribute.value===undefined||attribute.value==="")continue;
  if(coreKeys.has(attribute.key))continue;
  if(energyPattern.test(attribute.key)||energyPattern.test(attribute.label))continue;
  const labelKey=normalize(attribute.label);if(!labelKey||seen.has(labelKey))continue;
  seen.add(labelKey);
  result.push({label:attribute.label,value:attributeToText(attribute.value,attribute.unit),icon:icons[result.length%icons.length]!});
 }
 return result;
}
const VACATION_AMENITY_LABELS:Record<string,string>={wifi:"Wi-Fi",parking:"Parking",pool:"Piscine","air-conditioning":"Climatisation",kitchen:"Cuisine",washer:"Lave-linge","terrace-balcony":"Terrasse / balcon","sea-view":"Vue sur la mer",spa:"Spa",breakfast:"Petit-déjeuner"};
function detailAttributeToText(attribute:{key?:string;label:string;value:unknown;unit:string|null}){
 if(attribute.key==="amenities"&&Array.isArray(attribute.value))return attribute.value.map(value=>VACATION_AMENITY_LABELS[String(value)]??String(value)).join(", ");
 return attributeToText(attribute.value,attribute.unit);
}
function genericSpecs(attributes:Array<{key?:string;label:string;value:unknown;unit:string|null}>):Spec[]{
 const icons:AppIconName[]=["list","circle-check","info","store"];
 return attributes.filter(x=>x.value!==null&&x.value!==undefined&&x.value!==""&&(!Array.isArray(x.value)||x.value.length>0)).map((x,i)=>({label:x.label,value:detailAttributeToText(x),icon:icons[i%icons.length]!}));
}
function isEnergySpec(label:string,value:unknown){return /(énerg|energ|dpe|ges|classe)/i.test(label)&&Boolean(energyGrade(value))}

const ENERGY_GRADES=["A","B","C","D","E","F","G"] as const;
function energyGrade(value:unknown){const v=String(value??"").trim().toUpperCase();return ENERGY_GRADES.includes(v as any)?v:null}
function EnergyScale({value,label,compact=false}:{value:unknown;label:string;compact?:boolean}){const current=energyGrade(value);if(!current)return <strong>{attributeToText(value)}</strong>;return <div className={`${styles.energyScale} ${compact?styles.energyScaleCompact:""}`} aria-label={`${label} classe ${current}`}><div className={styles.energyScaleLabel}><span>{label}</span><b>Classe {current}</b></div><div className={styles.energyBars}>{ENERGY_GRADES.map(g=><span key={g} className={`${styles[`energy${g}`]} ${g===current?styles.energyActive:""}`}>{g}</span>)}</div></div>}

function memberYear(value:string){const d=new Date(value);return Number.isNaN(d.getTime())?null:d.getFullYear()}
function historyDate(value:string|null|undefined){if(!value)return null;const d=new Date(value);return Number.isNaN(d.getTime())?null:new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"long",year:"numeric"}).format(d)}
function osmEmbedUrl(latitude:number,longitude:number){const latSpan=.025,lngSpan=.035;const bbox=[longitude-lngSpan,latitude-latSpan,longitude+lngSpan,latitude+latSpan].join(",");return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(`${latitude},${longitude}`)}`}
function directionsUrl(latitude:number|null,longitude:number|null,location:string){const destination=latitude!=null&&longitude!=null?`${latitude},${longitude}`:`${location}, France`;return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`}

async function geocodeForMap(city:string|null,postalCode:string|null){
 if(!city||!postalCode)return null;
 try{
  const q=encodeURIComponent(`${postalCode} ${city}`);
  const r=await fetch(`https://data.geopf.fr/geocodage/search?q=${q}&limit=1&autocomplete=0`,{next:{revalidate:86400},signal:AbortSignal.timeout(1200)});
  if(!r.ok)return null;
  const j=await r.json() as {features?:Array<{geometry?:{coordinates?:[number,number]}}>};
  const c=j.features?.[0]?.geometry?.coordinates;
  return c&&Number.isFinite(c[0])&&Number.isFinite(c[1])?{longitude:c[0],latitude:c[1]}:null;
 }catch{return null}
}

export async function generateMetadata({params}:Props):Promise<Metadata>{
 const{slug}=await params;
 try{
  const listing=await fetchPublicListing(slug);
  if(!listing)return{title:"Annonce introuvable | Petit Annonces"};
  const rawTitle=listing.title??listing.category.name;
  const title=rawTitle.length>62?`${rawTitle.slice(0,42).trim()}… ${rawTitle.slice(-15).trim()}`:rawTitle;
  const baseDescription=listing.description?.replace(/\s+/g," ").trim()??"";
  const context=[listing.category.name,listing.city].filter(Boolean).join(" à ");
  const description=(baseDescription.length>=105?baseDescription:`${baseDescription}${baseDescription?" ":""}Découvrez cette annonce ${context?context.toLowerCase():listing.category.name.toLowerCase()} sur Petit Annonces et contactez le vendeur en toute simplicité.`).slice(0,155);
  const coverMedia=listing.media.find(m=>m.isCover)??listing.media[0]??null;
  const image=coverMedia?.id?protectedMediaAbsolute(coverMedia.id):undefined;
  const indexable=listing.status==="PUBLISHED";
  return{title:{absolute:`${title} | Petit Annonces`},description,alternates:{canonical:`/annonce/${slug}`},robots:{index:indexable,follow:true,...(indexable?{googleBot:{index:true,follow:true,"max-image-preview":"large","max-snippet":-1,"max-video-preview":-1}}:{})},openGraph:{type:"website",url:`/annonce/${slug}`,title:rawTitle,description,...(image?{images:[{url:image,alt:coverMedia?.altText??rawTitle,...(coverMedia?.width?{width:coverMedia.width}:{}),...(coverMedia?.height?{height:coverMedia.height}:{})}]}:{})},twitter:{card:image?"summary_large_image":"summary",title:rawTitle,description,...(image?{images:[{url:image,alt:coverMedia?.altText??rawTitle}]}:{})}};
 }catch{return{title:"Petit Annonces"}}
}

function safeJsonLd(value:unknown){return JSON.stringify(value).replace(/</g,"\\u003c")}
function schemaDescriptionHtml(value:string){return `<p>${value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\r?\n+/g,"</p><p>")}</p>`}

function citySlug(value:string){return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")}

export default async function ListingPage({params}:Props){
 const{slug}=await params;
 const [listingResult,header]=await Promise.all([fetchPublicListing(slug).catch(()=>null),headerData()]);
 const listing=listingResult;if(!listing)notFound();
 const isVehicle=listing.category.domain==="VEHICLE",isProperty=listing.category.domain==="REAL_ESTATE",isJob=listing.category.domain==="JOB";
 const isVacation=listing.breadcrumb.some(item=>item.slug==="vacances")||listing.category.slug==="vacances";
 const isActive=listing.status==="PUBLISHED";
 const canBookAppointment=isActive&&listing.seller.kind==="PROFESSIONNEL"&&listing.seller.appointmentBookingEnabled===true&&(isVehicle||isProperty);
 const canCheckout=isActive&&!isVehicle&&!isProperty&&!isVacation&&listing.priceMinor!=null&&listing.commerce.securePaymentEnabled&&listing.commerce.shippingEnabled;
 const checkoutHref=`/checkout?listingId=${encodeURIComponent(listing.id)}`;
 const title=listing.title??listing.category.name;
 const canonical=`https://petitannonces.fr/annonce/${slug}`;
 const coverMedia=listing.media.find((m:any)=>m.isCover)??listing.media[0]??null;
 const cover=coverMedia?.id?protectedMediaPath(coverMedia.id):null;
 if(cover)preload(cover,{as:"image",fetchPriority:"high"});
 const breadcrumbJsonLd={"@context":"https://schema.org","@type":"BreadcrumbList",itemListElement:[{ "@type":"ListItem",position:1,name:"Accueil",item:"https://petitannonces.fr/"},...listing.breadcrumb.map((b:any,i:number)=>({"@type":"ListItem",position:i+2,name:b.name,item:`https://petitannonces.fr/categorie/${b.slug}`})),{"@type":"ListItem",position:listing.breadcrumb.length+2,name:title,item:canonical}]};
 const attributeValue=(...keys:string[])=>listing.attributes.find(attribute=>keys.includes(attribute.key))?.value;
 const textAttribute=(...keys:string[])=>{const value=attributeValue(...keys);return value==null?"":String(value).trim()};
 const productBrand=isVehicle&&listing.vehicle?.make?String(listing.vehicle.make).trim():textAttribute("brand","marque","brandName")||(listing.productSafety?.manufacturerName?.trim()??"");
 const rawGtin=(listing.productSafety?.ean??textAttribute("ean","gtin","barcode","codeBarres")).replace(/\D/g,"");
 const gtinProperty=([8,12,13,14].includes(rawGtin.length)&&rawGtin)?{[`gtin${rawGtin.length}`]:rawGtin}:{};
 const mpn=textAttribute("mpn","manufacturerPartNumber","referenceFabricant");
 const productIdentifier=listing.productSafety?.productIdentifier?.trim()??"";
 const returnPolicy=listing.consumerDisclosure?.sellerIsTrader&&listing.consumerDisclosure.withdrawalRightApplies===false?{
  "@type":"MerchantReturnPolicy",applicableCountry:"FR",returnPolicyCategory:"https://schema.org/MerchantReturnNotPermitted"
 }:listing.consumerDisclosure?.sellerIsTrader&&listing.consumerDisclosure.withdrawalRightApplies===true&&Number.isInteger(listing.consumerDisclosure.withdrawalPeriodDays)&&Number(listing.consumerDisclosure.withdrawalPeriodDays)>0?{
  "@type":"MerchantReturnPolicy",applicableCountry:"FR",returnPolicyCategory:"https://schema.org/MerchantReturnFiniteReturnWindow",merchantReturnDays:Number(listing.consumerDisclosure.withdrawalPeriodDays)
 }:null;
 const productJsonLd=!isVacation&&listing.priceMinor!=null&&listing.status!=="EXPIRED"&&!(["JOB","SERVICE","REAL_ESTATE"] as string[]).includes(listing.category.domain)?{
  "@context":"https://schema.org",
  "@type":isVehicle?["Product","Car"]:"Product",
  name:title,
  description:listing.description??undefined,
  image:listing.media.filter((m:any)=>Boolean(m.id)).map((m:any)=>protectedMediaAbsolute(m.id)).slice(0,8),
  category:listing.category.name,
  url:canonical,
  sku:listing.id,
  ...(productBrand?{brand:{"@type":"Brand",name:productBrand}}:{}),
  ...gtinProperty,
  ...(mpn?{mpn}:{}),
  ...(productIdentifier?{productID:productIdentifier}:{}),
  ...(listing.productSafety?.manufacturerName?{manufacturer:{"@type":"Organization",name:listing.productSafety.manufacturerName}}:{}),
  ...(!isVehicle&&listing.productSafety?.model?{model:listing.productSafety.model}:{}),
  itemCondition:"https://schema.org/UsedCondition",
  ...(isVehicle&&listing.vehicle?{
   ...(listing.vehicle.model?{model:String(listing.vehicle.model)}:{}),
   ...(listing.vehicle.modelYear?{vehicleModelDate:String(listing.vehicle.modelYear)}:{}),
   ...(listing.vehicle.mileageKm?{mileageFromOdometer:{"@type":"QuantitativeValue",value:Number(listing.vehicle.mileageKm),unitCode:"KMT"}}:{}),
   ...(listing.vehicle.fuel?{fuelType:String(listing.vehicle.fuel)}:{}),
   ...(listing.vehicle.transmission?{vehicleTransmission:String(listing.vehicle.transmission)}:{}),
   ...(listing.vehicle.color?{color:String(listing.vehicle.color)}:{})
  }:{}),
  offers:{"@type":"Offer",url:canonical,priceCurrency:listing.currency,price:(listing.priceMinor/100).toFixed(2),availability:listing.status==="SOLD"?"https://schema.org/SoldOut":"https://schema.org/InStock",seller:{"@type":listing.seller.kind==="PROFESSIONNEL"?"Organization":"Person",name:listing.seller.store?.name??listing.seller.name},...(listing.commerce.shippingEnabled?{shippingDetails:{"@type":"OfferShippingDetails",hasShippingService:{"@id":"https://petitannonces.fr/#shipping-france"}}}:{}),...(returnPolicy?{hasMerchantReturnPolicy:returnPolicy}:{})}
 }:null;
 const schedule=String(attributeValue("schedule","workSchedule")??"").toLowerCase();
 const contract=String(attributeValue("contract","contractType")??"").toLowerCase();
 const remote=String(attributeValue("remote","remoteWork")??"").toLowerCase();
 const employmentTypes=[
  ...(schedule.includes("plein")?["FULL_TIME"]:[]),
  ...(schedule.includes("partiel")?["PART_TIME"]:[]),
  ...(/stage|intern/.test(contract)?["INTERN"]:[]),
  ...(/intérim|interim|temporaire|cdd/.test(contract)?["TEMPORARY"]:[]),
  ...(/freelance|indépendant|independant|contractor/.test(contract)?["CONTRACTOR"]:[]),
 ].filter((value,index,array)=>array.indexOf(value)===index);
 const remoteOnly=/total|100%|complet/.test(remote);
 const hiringName=listing.seller.kind==="PROFESSIONNEL"?(listing.seller.store?.name??listing.seller.name):"confidential";
 const salaryAttribute=listing.attributes.find(attribute=>["salaryMin","salary","remuneration","rémunération"].includes(attribute.key));
 const salaryValue=typeof salaryAttribute?.value==="number"?salaryAttribute.value:Number(String(salaryAttribute?.value??"").replace(",", "."));
 const salaryUnitRaw=String(salaryAttribute?.unit??"").toLowerCase();
 const salaryUnitText=salaryUnitRaw.includes("mois")?"MONTH":salaryUnitRaw.includes("heure")||salaryUnitRaw.includes("/h")?"HOUR":salaryUnitRaw.includes("jour")?"DAY":salaryUnitRaw.includes("semaine")?"WEEK":"YEAR";
 const streetAddress=textAttribute("streetAddress","jobStreetAddress","workplaceAddress","adresseTravail");
 const fallbackValidThrough=listing.publishedAt?new Date(new Date(listing.publishedAt).getTime()+30*24*60*60*1000).toISOString():null;
 const jobJsonLd=isJob&&isActive&&Boolean(listing.publishedAt)&&Boolean(listing.description?.trim())&&Boolean(title.trim())&&(Boolean(listing.city)||remoteOnly)?{
  "@context":"https://schema.org",
  "@type":"JobPosting",
  title,
  description:schemaDescriptionHtml(listing.description!.trim()),
  identifier:{"@type":"PropertyValue",name:hiringName,value:listing.id},
  datePosted:listing.publishedAt,
  ...((listing.expiresAt??fallbackValidThrough)?{validThrough:listing.expiresAt??fallbackValidThrough}:{}),
  hiringOrganization:{"@type":"Organization",name:hiringName,...(listing.seller.store?.slug?{sameAs:`https://petitannonces.fr/boutique/${listing.seller.store.slug}`}:{}) ,...(listing.seller.store?.logoUrl?{logo:listing.seller.store.logoUrl}:{})},
  ...(employmentTypes.length?{employmentType:employmentTypes.length===1?employmentTypes[0]:employmentTypes}:{}),
  ...(Number.isFinite(salaryValue)&&salaryValue>0?{baseSalary:{"@type":"MonetaryAmount",currency:listing.currency||"EUR",value:{"@type":"QuantitativeValue",value:salaryValue,unitText:salaryUnitText}}}:{}),
  ...(remoteOnly?{jobLocationType:"TELECOMMUTE",applicantLocationRequirements:{"@type":"Country",name:"France"}}:{jobLocation:{"@type":"Place",address:{"@type":"PostalAddress",addressCountry:"FR",...(streetAddress?{streetAddress}:{}),...(listing.city?{addressLocality:listing.city}:{}),...(listing.region?{addressRegion:listing.region}:{}),...(listing.postalCode?{postalCode:listing.postalCode}:{})}}}),
  url:canonical
 }:null;
 const priceContext={domain:listing.category.domain,transactionType:typeof listing.property?.transactionType==="string"?listing.property.transactionType:null,isVacation};
 const price=formatListingPrice(listing.priceMinor,listing.currency,priceContext);
 const priceCopy=listingPriceCopy(priceContext);
 const location=[listing.city,listing.postalCode].filter(Boolean).join(" ")||listing.region||"France";
 const hasLocation=Boolean(listing.city&&listing.postalCode);
 const [similar,fallbackGeo]=await Promise.all([
  fetchSimilarListings(listing.category.slug,listing.id),
  listing.latitude==null||listing.longitude==null?geocodeForMap(listing.city,listing.postalCode):Promise.resolve(null),
 ]);
 const mapLatitude=listing.latitude??fallbackGeo?.latitude??null;
 const mapLongitude=listing.longitude??fallbackGeo?.longitude??null;
 const hasCoordinates=mapLatitude!=null&&mapLongitude!=null;
 const mapUrl=hasCoordinates?osmEmbedUrl(mapLatitude!,mapLongitude!):null;
 const routeUrl=hasLocation?directionsUrl(mapLatitude,mapLongitude,location):null;
 const showCredit=listing.priceMinor!=null&&listing.priceMinor>=100000&&!(isProperty&&listing.property?.transactionType==="RENTAL");
 const specs=isVehicle?vehicleSpecs(listing.vehicle,listing.attributes):isProperty?propertySpecs(listing.property,listing.attributes):genericSpecs(listing.attributes);
 const displayedSpecs=specs;
 const year=memberYear(listing.seller.memberSince),rating=listing.seller.reviews.average,vehicle=listing.vehicle??{};
 const baseSellerReputationBadges:ReputationBadgeView[]=listing.seller.reputation?.badges??[];const sellerPhoneBadge:ReputationBadgeView={code:"PHONE_VERIFIE",label:"Téléphone vérifié",shortLabel:"Téléphone",description:"Numéro de téléphone confirmé par code SMS.",icon:"phone",priority:89};const sellerProfileBadgeIndex=baseSellerReputationBadges.findIndex(b=>b.code==="PROFILE_VERIFIE");const sellerReputationBadges=listing.seller.phoneVerified&&!baseSellerReputationBadges.some(b=>b.code==="PHONE_VERIFIE")?[...baseSellerReputationBadges.slice(0,sellerProfileBadgeIndex>=0?sellerProfileBadgeIndex+1:baseSellerReputationBadges.length),sellerPhoneBadge,...baseSellerReputationBadges.slice(sellerProfileBadgeIndex>=0?sellerProfileBadgeIndex+1:baseSellerReputationBadges.length)]:baseSellerReputationBadges;
 const chips=isVehicle?[vehicle.fuel?String(vehicle.fuel):null,vehicle.mileageKm?`${Number(vehicle.mileageKm).toLocaleString("fr-FR")} km`:null,vehicle.transmission?String(vehicle.transmission):null].filter(Boolean) as string[]:[];
 const latestPriceChange=listing.priceHistory?.find(item=>item.oldPriceMinor!==item.newPriceMinor)??null;
 const priceChanged=Boolean(latestPriceChange);
 const priceDropped=Boolean(latestPriceChange&&latestPriceChange.newPriceMinor<latestPriceChange.oldPriceMinor);
 const priceDifferenceMinor=latestPriceChange?Math.abs(latestPriceChange.newPriceMinor-latestPriceChange.oldPriceMinor):0;
 const priceDifferencePercent=latestPriceChange&&latestPriceChange.oldPriceMinor>0?Math.round((priceDifferenceMinor/latestPriceChange.oldPriceMinor)*100):null;
 const vehicleHistory=listing.vehicleHistory;
 const vehicleHistoryItems=isVehicle&&vehicleHistory?[
  {label:"1re mise en circulation",value:historyDate(vehicleHistory.firstRegistrationDate),icon:"calendar" as AppIconName},
  {label:"Données vérifiées le",value:historyDate(vehicleHistory.checkedAt),icon:"circle-check" as AppIconName},
  {label:"Classe SRA",value:vehicleHistory.sraClass,icon:"shield" as AppIconName},
  {label:"Indice de risque vol SRA",value:vehicleHistory.theftRiskLevel,icon:"shield" as AppIconName},
  {label:"Valeur à neuf SRA",value:vehicleHistory.originalNewValueEuro!=null?new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR",maximumFractionDigits:0}).format(vehicleHistory.originalNewValueEuro):null,icon:"credit-card" as AppIconName},
  {label:"Changements de titulaire",value:vehicleHistory.ownerChanges!=null?String(vehicleHistory.ownerChanges):null,icon:"user" as AppIconName},
  {label:"Sinistres à réparation contrôlée",value:vehicleHistory.controlledDamageCount!=null?String(vehicleHistory.controlledDamageCount):null,icon:"tools" as AppIconName},
  {label:"Situation administrative",value:vehicleHistory.administrativeStatus,icon:"list" as AppIconName},
  {label:"Dernier contrôle technique",value:historyDate(vehicleHistory.technicalInspectionDate),icon:"circle-check" as AppIconName},
  {label:"Résultat du contrôle",value:vehicleHistory.technicalInspectionResult,icon:"info" as AppIconName},
  {label:"Kilométrage vérifié",value:vehicleHistory.mileageKm!=null?`${vehicleHistory.mileageKm.toLocaleString("fr-FR")} km`:null,icon:"gauge" as AppIconName},
 ].filter((item):item is {label:string;value:string;icon:AppIconName}=>Boolean(item.value)):[];
 const vehicleHistoryCard=isVehicle&&(vehicleHistoryItems.length>0||Boolean(vehicleHistory?.officialHistovecUrl))?<section className={styles.vehicleHistoryCard}><div className={styles.vehicleHistoryHead}><span><AppIcon name="shield"/></span><div><small>Vérification d’immatriculation</small><h2>Historique du véhicule</h2><p>Données disponibles récupérées automatiquement à partir de l’immatriculation, sans afficher la plaque.</p></div></div>{vehicleHistory?.officialHistovecUrl&&<div className={`${styles.histovecNotice} ${styles.histovecProvided}`}><AppIcon name="circle-check"/><div><strong>Rapport officiel HistoVec fourni par le vendeur</strong><p>Le vendeur a ajouté un lien de partage HistoVec officiel pour ce véhicule.</p><a href={vehicleHistory.officialHistovecUrl} target="_blank" rel="noreferrer">Consulter le rapport HistoVec <AppIcon name="arrow-right"/></a></div></div>}{vehicleHistoryItems.length>0&&<div className={styles.vehicleHistoryGrid}>{vehicleHistoryItems.map(item=><div key={item.label}><span><AppIcon name={item.icon}/></span><div><small>{item.label}</small><strong>{item.value}</strong></div></div>)}</div>}{!vehicleHistory?.officialHistovecUrl&&<div className={styles.histovecNotice}><AppIcon name="info"/><div><strong>Rapport officiel HistoVec</strong><p>Ce résumé ne remplace pas le rapport officiel HistoVec. Seul le titulaire du certificat d’immatriculation peut générer et partager ce rapport officiel.</p><a href="https://histovec.interieur.gouv.fr/histovec/acheteur" target="_blank" rel="noreferrer">Demander le rapport HistoVec officiel <AppIcon name="arrow-right"/></a></div></div>}</section>:null;
 return <div className={styles.page}><ListingViewTracker listingId={listing.id}/><script type="application/ld+json" dangerouslySetInnerHTML={{__html:safeJsonLd(breadcrumbJsonLd)}}/>{productJsonLd&&<script type="application/ld+json" dangerouslySetInnerHTML={{__html:safeJsonLd(productJsonLd)}}/>}{jobJsonLd&&<script type="application/ld+json" dangerouslySetInnerHTML={{__html:safeJsonLd(jobJsonLd)}}/>}<main className={styles.shell}>
  <nav className={styles.breadcrumb} aria-label="Fil d’Ariane"><a href="/">Petit Annonces</a>{listing.breadcrumb.map(item=><span key={item.slug}><AppIcon name="chevron-right"/><a href={`/categorie/${item.slug}`}>{item.name}</a></span>)}<span><AppIcon name="chevron-right"/>{title}</span></nav>
  <div className={styles.layout}><section className={styles.main}>
   {!isActive&&<section className={styles.lifecycleBanner}><AppIcon name="info"/><div><strong>{listing.status==="SOLD"?"Cette annonce a été vendue":"Cette annonce a expiré"}</strong><span>{listing.status==="SOLD"?"L’article n’est plus disponible. Consultez les annonces similaires ci-dessous.":"Cette annonce n’est plus active. Le vendeur peut la renouveler depuis son compte."}</span></div></section>}
   <ListingGallery media={listing.media.map((item:any)=>({...item,url:protectedMediaPath(item.id)}))} title={title} classes={styles} category={listing.category}/>
   <section className={styles.titleArea}><div className={styles.mobilePriceSummary}><div><small>{priceCopy.shortLabel}</small><strong>{price}</strong></div><span><AppIcon name="location"/>{location}</span></div>{canCheckout&&listing.priceMinor!=null&&<PayPalPayLaterBadge priceMinor={listing.priceMinor} currency={listing.currency} compact className={styles.mobilePaymentOptions}/>}<div className={styles.titleRow}><div><h1>{title}</h1><div className={styles.meta}><span><AppIcon name="location"/>{location}</span>{listing.publishedAt&&<span><AppIcon name="calendar"/>Mise en ligne le {new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"long",year:"numeric"}).format(new Date(listing.publishedAt))}</span>}<span><AppIcon name="list"/>Annonce n° {listing.id.slice(-8).toUpperCase()}</span></div></div><div className={styles.desktopActions}><FavoriteButton listingId={listing.id} className={styles.favoriteOverride}/><ShareListingButton title={title} listingId={listing.id} className={styles.shareButton}/></div></div>
    <div className={styles.chips}><span className={styles.viewChip}><AppIcon name="eye"/><strong>{Number(listing.viewCount??0).toLocaleString("fr-FR")}</strong><span>vue{Number(listing.viewCount??0)===1?"":"s"}</span></span><span className={styles.goodChip}><AppIcon name={isActive?"circle-check":"info"}/>{listing.status==="SOLD"?"Vendue":listing.status==="EXPIRED"?"Expirée":"En ligne"}</span>{listing.promotions.filter(p=>p.type==="URGENT").map(p=><span key={p.id} className={`${styles.promotionChip} ${styles.urgent}`}><AppIcon name="bolt"/>{promotionLabel(p.type)}</span>)}{listing.promotions.filter(p=>p.type==="FEATURED").map(p=><span key={p.id} className={`${styles.promotionChip} ${styles.featured}`}><AppIcon name="star"/>{promotionLabel(p.type)}</span>)}{listing.promotions.filter(p=>p.type!=="URGENT"&&p.type!=="FEATURED").map(p=><span key={p.id} className={`${styles.promotionChip} ${styles[promotionClass(p.type)]??""}`}><AppIcon name={p.type==="GALLERY"?"image":p.type==="SPONSORED"?"shield":"arrow-right"}/>{promotionLabel(p.type)}</span>)}{chips.map((chip,i)=><span key={chip} className={styles.chip}><AppIcon name={i===0?"fuel":i===1?"gauge":"gears"}/>{chip}</span>)}</div>
    <div className={styles.mobileUtilityActions} aria-label="Actions secondaires de l’annonce"><FavoriteButton listingId={listing.id} className={styles.mobileUtilityFavorite}/>{canBookAppointment&&<ListingAppointmentButton listingId={listing.id} domain={listing.category.domain} compact className={styles.mobileUtilityAppointment}/>}</div>
   </section>
   {isVacation&&isActive&&<VacationAvailabilityChecker listingId={listing.id} priceMinor={listing.priceMinor} currency={listing.currency}/>}
   {displayedSpecs.length>0&&<section className={styles.mobileSpecsCard}><div className={styles.featureHead}><div><span>Caractéristiques</span><h2>Toutes les informations</h2></div><em>{displayedSpecs.length} élément{displayedSpecs.length>1?"s":""}</em></div><div className={styles.specGrid}>{displayedSpecs.map((spec,index)=>{const energy=isEnergySpec(spec.label,spec.value);return <div className={`${styles.spec} ${energy?styles.energySpec:""}`} key={`mobile-${spec.label}-${index}`}><span className={styles.specIcon}><AppIcon name={spec.icon}/></span><div><small>{spec.label}</small>{energy?<EnergyScale value={spec.value} label={spec.label} compact/>:<strong>{spec.value}</strong>}</div></div>})}</div></section>}
   <section className={styles.mobileDescriptionCard}><h2>Description</h2><p>{listing.description??"Aucune description fournie."}</p></section>
   {vehicleHistoryCard&&<div className={styles.mobileVehicleHistory}>{vehicleHistoryCard}</div>}
   <section className={styles.detailsCard}>
    {displayedSpecs.length>0&&<div className={styles.featureSection}><div className={styles.featureHead}><div><span>Caractéristiques</span><h2>Toutes les informations de l’annonce</h2></div><em>{displayedSpecs.length} élément{displayedSpecs.length>1?"s":""}</em></div><div className={styles.specGrid}>{displayedSpecs.map((spec,index)=>{const energy=isEnergySpec(spec.label,spec.value);return <div className={`${styles.spec} ${energy?styles.energySpec:""}`} key={`${spec.label}-${index}`}><span className={styles.specIcon}><AppIcon name={spec.icon}/></span><div><small>{spec.label}</small>{energy?<EnergyScale value={spec.value} label={spec.label} compact/>:<strong>{spec.value}</strong>}</div></div>})}</div></div>}
    <div className={styles.descriptionBlock}><h2>Description</h2><p>{listing.description??"Aucune description fournie."}</p></div>
    <div className={styles.reassurance}>
     <div><span className={styles.safeIcon}><AppIcon name="shield"/></span><p><strong>Échange sécurisé</strong><small>Messagerie Petit Annonces</small></p></div>
     <div><span><AppIcon name="user-shield"/></span><p><strong>Profil vendeur</strong><small>Score de confiance visible</small></p></div>
     <div><span><AppIcon name="circle-check"/></span><p><strong>Annonce modérée</strong><small>Contrôles avant publication</small></p></div>
     <div><span><AppIcon name="comments"/></span><p><strong>Contact direct</strong><small>Échangez avec le vendeur</small></p></div>
    </div>
    {showCredit&&<CreditSimulator priceMinor={listing.priceMinor!} isRealEstate={isProperty}/>}
   </section>
   {vehicleHistoryCard&&<div className={styles.desktopVehicleHistory}>{vehicleHistoryCard}</div>}
   {isVacation&&isActive&&<VacationListingReviews listingId={listing.id}/>}
   {isProperty&&listing.energy&&<section className={`${styles.detailsCard} ${styles.energyCard}`}><div className={styles.energyCardHead}><span className={styles.energyCardIcon}><AppIcon name="bolt"/></span><div><h2>Performance énergétique</h2><p>Classe énergétique du logement et niveau d’émissions de gaz à effet de serre.</p></div></div><div className={styles.energyRow}><EnergyScale value={listing.energy.energyClass} label="DPE"/><EnergyScale value={listing.energy.climateClass} label="GES"/></div></section>}
   {similar.length>0&&<section className={styles.similarSection}><div className={styles.sectionTitle}><div><span>À découvrir aussi</span><h2>Annonces similaires</h2></div><a href={`/recherche?category=${encodeURIComponent(listing.category.slug)}`}>Voir toutes <AppIcon name="arrow-right"/></a></div><div className={styles.similarGrid}>{similar.map(item=><MarketplaceListingCard key={item.id} variant="similar" item={{...item,category:item.category??listing.category}}/>)}</div></section>}
  </section>
  <aside className={styles.sidebar}>
   <section className={styles.priceCard} id="contact-actions"><div className={styles.priceTop}><div><strong>{price}</strong><span>{priceCopy.label}</span></div>{listing.priceMinor!=null&&<em><AppIcon name="circle-check"/>Annonce active</em>}</div>{canCheckout&&listing.priceMinor!=null&&<PayPalPayLaterBadge priceMinor={listing.priceMinor} currency={listing.currency}/>} {canCheckout&&<a className={styles.buyButton} href={checkoutHref}><AppIcon name="shield"/>Acheter en toute sécurité</a>}{isActive?<><ListingContactActions listingId={listing.id} acceptsOffers={!isProperty&&!isVacation&&listing.commerce.acceptsOffers} classNameMessage={styles.contactButton} classNameOffer={styles.offerButton}/>{canBookAppointment&&<ListingAppointmentButton listingId={listing.id} domain={listing.category.domain}/>}</>:<a className={styles.contactButton} href={isVacation?"/vacances":`/categorie/${listing.category.slug}`}><AppIcon name="search"/>Voir des annonces similaires</a>}<a href={`/signaler-contenu-illicite?type=LISTING&id=${encodeURIComponent(listing.id)}&url=${encodeURIComponent(`https://petitannonces.fr/annonce/${listing.slug}`)}`} style={{display:"block",textAlign:"center",marginTop:10,fontSize:13,color:"#777887",textDecoration:"underline"}}>Signaler cette annonce</a><div className={styles.safePurchase}><span><AppIcon name={isVacation?"calendar":"shield"}/></span><div><strong>{isVacation?"Séjour à vérifier":canCheckout?"Achat protégé":"Échangez en toute sécurité"}</strong><small>{isVacation?"Contrôlez vos dates avant de contacter l’hôte":canCheckout?"Paiement et livraison disponibles":"Utilisez la messagerie Petit Annonces"}</small></div></div></section>
   {priceChanged&&latestPriceChange&&<section className={`${styles.priceHistoryCard} ${priceDropped?styles.priceHistoryDown:styles.priceHistoryUp}`}><div className={styles.priceHistoryHead}><span className={styles.priceHistoryIcon}><AppIcon name="chevron-down"/></span><div><small>Évolution du prix</small><h2>{priceDropped?"Prix en baisse":"Prix ajusté"}</h2></div><em>{priceDropped?"−":"+"} {formatMoney(priceDifferenceMinor,latestPriceChange.currency)}</em></div><div className={styles.priceHistoryPrices}><div><small>Ancien prix</small><del>{formatMoney(latestPriceChange.oldPriceMinor,latestPriceChange.currency)}</del></div><span><AppIcon name="chevron-right"/></span><div><small>Nouveau prix</small><strong>{formatMoney(latestPriceChange.newPriceMinor,latestPriceChange.currency)}</strong></div></div><div className={styles.priceHistoryFoot}><span>Modifié le {new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"short",year:"numeric"}).format(new Date(latestPriceChange.changedAt))}</span>{priceDifferencePercent!=null&&<b>{priceDropped?"−":"+"}{priceDifferencePercent}%</b>}{listing.priceHistory.length>1&&<small>{listing.priceHistory.length} changements enregistrés</small>}</div></section>}
   <section className={styles.sellerCard}><div className={styles.sellerHead}>{listing.seller.avatarUrl?<img className={styles.avatarImage} src={listing.seller.avatarUrl} alt={listing.seller.name} width={64} height={64} loading="lazy" decoding="async"/>:<div className={styles.avatar}>{listing.seller.name.slice(0,2).toUpperCase()}</div>}<div><div className={styles.sellerName}><strong>{listing.seller.name}</strong>{listing.seller.siretVerified&&<span><AppIcon name="shield"/>SIRET vérifié</span>}</div><div className={styles.rating}>{rating!=null?<><span className={styles.ratingStars} aria-label={`${rating.toFixed(1)} sur 5`}>{[0,1,2,3,4].map(i=><AppIcon name="star" key={i}/>)}</span><b>{rating.toFixed(1)} ({listing.seller.reviews.count} avis)</b></>:<span>Nouveau vendeur</span>}</div>{year&&<small>Membre depuis {year}</small>}</div></div>{sellerReputationBadges.length>0&&<ReputationBadges badges={sellerReputationBadges} metrics={listing.seller.reputation?.metrics} variant="seller"/>}<div className={styles.sellerStats}><div><small>Ventes finalisées</small><strong>{listing.seller.completedSales}</strong></div><div><small>Type de compte</small><strong>{listing.seller.kind==="PROFESSIONNEL"?"Professionnel":"Particulier"}</strong></div></div><a className={styles.profileButton} href={`/profil/${listing.seller.id}`}><AppIcon name="user"/>Voir le profil du vendeur</a>{listing.seller.store?.slug&&<a className={styles.storeButton} href={`/boutique/${listing.seller.store.slug}`}><AppIcon name="store"/>Voir la boutique</a>}<FollowButton targetType={listing.seller.store?.id?"STORE":"USER"} targetId={listing.seller.store?.id??listing.seller.id} sourceListingId={listing.id} label={listing.seller.store?.id?"Suivre la boutique":"Suivre le vendeur"} followingLabel={listing.seller.store?.id?"Boutique suivie":"Vendeur suivi"} fullWidth/></section>
   <section className={styles.mobileSecurityCard}><div className={styles.mobileSecurityHead}><span><AppIcon name="shield"/></span><div><small>Petit Annonces</small><h2>Sécurité & services</h2></div></div><div className={styles.mobileSecurityGrid}><div><span><AppIcon name="comments"/></span><strong>Messagerie sécurisée</strong></div>{listing.seller.phoneVerified&&<div><span><AppIcon name="phone"/></span><strong>Téléphone vérifié</strong></div>}<div><span><AppIcon name={listing.seller.verified||listing.seller.siretVerified?"circle-check":"user"}/></span><strong>{listing.seller.verified||listing.seller.siretVerified?"Vendeur vérifié":"Profil vendeur"}</strong></div>{listing.commerce.securePaymentEnabled&&<div><span><AppIcon name="shield"/></span><strong>Paiement protégé</strong></div>}{listing.commerce.shippingEnabled&&<div><span><AppIcon name="truck"/></span><strong>Livraison possible</strong></div>}</div></section>
   {listing.seller.reviews.recent.length>0&&<section className={styles.reviewCard}><div className={styles.reviewCardHead}><div><span>Avis récents</span><h2>Ce que disent les acheteurs</h2></div><a href={`/profil/${listing.seller.id}`}>Voir tous</a></div><div className={styles.reviewList}>{listing.seller.reviews.recent.map(review=><article key={review.id}><div className={styles.reviewTop}><strong>{review.reviewerName}</strong><span>{'★'.repeat(Math.max(1,Math.min(5,review.rating)))}</span></div><p>{review.comment}</p><small>{new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"short",year:"numeric"}).format(new Date(review.createdAt))}</small></article>)}</div></section>}
   <section className={styles.trustCard}><div className={styles.trustTitle}><h2>Score de confiance</h2><span>{listing.seller.trust.level==="TRUSTED"?"Très bon":listing.seller.trust.level==="ESTABLISHED"?"Établi":"Nouveau"}</span></div><div className={styles.trustScore}><strong>{listing.seller.trust.score}</strong><span>/100</span></div><div className={styles.progress}><i style={{width:`${listing.seller.trust.score}%`}}/></div><ul><li><AppIcon name="check"/>Historique du compte analysé</li>{listing.seller.phoneVerified&&<li><AppIcon name="check"/>Numéro de téléphone vérifié</li>}{listing.seller.siretVerified&&<li><AppIcon name="check"/>SIRET vérifié auprès du registre public</li>}{!listing.seller.siretVerified&&listing.seller.verified&&<li><AppIcon name="check"/>Profil professionnel vérifié</li>}<li><AppIcon name="check"/>Avis après transaction</li></ul></section>
   {!isVacation&&<section className={styles.deliveryCard}><div className={styles.deliveryHead}><span><AppIcon name="shield"/></span><div><small>Paiement & livraison</small><h2>{canCheckout?"Achat protégé disponible":"Transaction à organiser avec le vendeur"}</h2></div></div><div className={styles.deliveryRows}><div><AppIcon name="credit-card"/><div><strong>Paiement sécurisé</strong><small>{canCheckout?"Paiement protégé par Petit Annonces":"Disponible lorsque l’annonce et le vendeur sont éligibles"}</small></div></div><div><AppIcon name="truck"/><div><strong>Livraison possible</strong><small>{listing.commerce.shippingEnabled?"Frais calculés au paiement selon l’adresse et le transporteur":"Remise en main propre ou modalités à convenir"}</small></div></div><div><AppIcon name="shield"/><div><strong>Protection acheteur</strong><small>{canCheckout?"Suivi, litige et remboursement liés à la commande":"Privilégiez la messagerie Petit Annonces"}</small></div></div></div></section>}
   <section className={styles.locationCard}><div className={styles.locationHead}><div><h2><AppIcon name="location"/>Localisation</h2><p>{location}</p></div><span>Position approximative</span></div>{mapUrl?<><div className={styles.realMap}><iframe className={styles.cleanMapFrame} src={mapUrl} title={`Carte de ${listing.city??"l’annonce"}`} loading="lazy" referrerPolicy="no-referrer-when-downgrade"/></div><small className={styles.mapAttribution}>© OpenStreetMap contributors</small></>:<div className={styles.mapUnavailable}><AppIcon name="map"/><span>Localisation non renseignée pour cette annonce. La carte apparaîtra dès que le vendeur aura ajouté une ville et un code postal.</span></div>}{hasLocation&&<div className={styles.locationActions}>{routeUrl&&<a className={styles.routeButton} href={routeUrl} target="_blank" rel="noreferrer"><AppIcon name="map"/>Obtenir l’itinéraire</a>}<a className={styles.nearbyButton} href={listing.city?`/ville/${citySlug(listing.city)}`:"/recherche"}><AppIcon name="search"/>{listing.city?`Voir les annonces à ${listing.city}`:"Annonces à proximité"}</a></div>}<small className={styles.locationPrivacy}>Pour protéger le vendeur, Petit Annonces affiche le secteur de la ville et non une adresse personnelle précise.</small></section>
  </aside></div>
 </main><div className={`${styles.mobileBar} ${canCheckout?styles.mobileBarCheckout:""}`} aria-label="Actions principales de l’annonce"><div className={styles.mobileBarActions}><ShareListingButton title={title} listingId={listing.id} className={styles.mobileActionShare} iconOnly/>{isActive?<ListingContactActions listingId={listing.id} acceptsOffers={false} messageOnly messageLabel="Contacter" messageIconOnly wrapperClassName={styles.mobileContactWrap} classNameMessage={styles.mobileContactButton}/>:<a className={styles.mobileSimilarButton} href={`/categorie/${listing.category.slug}`}><AppIcon name="search"/>Voir similaires</a>}{canCheckout&&<a className={styles.mobileBuyButton} href={checkoutHref}><AppIcon name="shield"/>Acheter</a>}</div></div></div>;
}